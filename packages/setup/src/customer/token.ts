/**
 * What a customer install's Cloudflare API token must be allowed to do, and the checks
 * `bun run customer:check` runs on it. Pure: `cloudflare.ts` reads the token and runs the probes.
 *
 * Every entry is something the deploy really calls: the stack's resources (`alchemy.run.ts`,
 * `apps/backend/src/worker.ts`) and alchemy's own state store (`Cloudflare.state()`), which deploys
 * a Worker that keeps its keys in the account's Secrets Store.
 */
import type { Check } from "./install.ts"

export type PermissionScope = "account" | "zone"

export interface Permission {
	/** The permission group's name, as the dashboard and the API show it. */
	readonly group: string
	readonly scope: PermissionScope
	/** What the deploy needs it for. */
	readonly why: string
	/** A recommended one only warns when missing. */
	readonly required: boolean
	/**
	 * A read-only API path that answers 2xx only with this permission (or its Write twin), used
	 * when the token cannot read its own policies. `{account}` and `{zone}` are filled in.
	 */
	readonly probe?: string
}

export const TOKEN_PERMISSIONS: ReadonlyArray<Permission> = [
	{
		group: "Workers Scripts Write",
		scope: "account",
		why: "the Workers, their Durable Objects, crons and custom domains",
		required: true,
		probe: "/accounts/{account}/workers/scripts",
	},
	{
		group: "Workers KV Storage Write",
		scope: "account",
		why: "the KV namespaces (api cache, link previews)",
		required: true,
		probe: "/accounts/{account}/storage/kv/namespaces",
	},
	{
		group: "D1 Write",
		scope: "account",
		why: "the directory database",
		required: true,
		probe: "/accounts/{account}/d1/database",
	},
	{
		group: "Workers R2 Storage Write",
		scope: "account",
		why: "the uploads, export and HTML render buckets",
		required: true,
		probe: "/accounts/{account}/r2/buckets",
	},
	{
		group: "Secrets Store Write",
		scope: "account",
		why: "alchemy's state store keeps its keys in the account's Secrets Store",
		required: true,
		probe: "/accounts/{account}/secrets_store/stores",
	},
	{
		group: "Account API Tokens Write",
		scope: "account",
		why: "the uploads bucket's S3 credentials are a bucket-scoped token the deploy mints",
		required: true,
		probe: "/accounts/{account}/tokens",
	},
	{
		group: "Zone Read",
		scope: "zone",
		why: "finding the zone",
		required: true,
		probe: "/zones/{zone}",
	},
	{
		group: "DNS Write",
		scope: "zone",
		why: "the custom domains' DNS records",
		required: true,
		probe: "/zones/{zone}/dns_records",
	},
	{
		group: "Workers Routes Write",
		scope: "zone",
		why: "the custom domains (app., api., cdn., ...)",
		required: true,
		probe: "/zones/{zone}/workers/routes",
	},
	{
		group: "SSL and Certificates Write",
		scope: "zone",
		why: "edge certificates for the custom domains",
		required: false,
		probe: "/zones/{zone}/ssl/certificate_packs",
	},
	{
		group: "Account Settings Read",
		scope: "account",
		why: "reading the account (part of Cloudflare's Edit Cloudflare Workers template)",
		required: false,
		probe: "/accounts/{account}",
	},
]

/** One policy of a token, as `GET /user/tokens/:id` or `GET /accounts/:id/tokens/:id` return it. */
export interface TokenPolicy {
	readonly effect?: string | undefined
	readonly resources?: Readonly<Record<string, unknown>> | undefined
	readonly permission_groups?: ReadonlyArray<{ readonly id?: string; readonly name?: string }> | undefined
}

const ACCOUNT_ANY = "com.cloudflare.api.account.*"
const ZONE_ANY = "com.cloudflare.api.account.zone.*"

const isAccountKey = (key: string, accountId: string) =>
	key === ACCOUNT_ANY || key === `com.cloudflare.api.account.${accountId}`
const isZoneKey = (key: string, zoneId: string | undefined) =>
	key === ZONE_ANY || (zoneId !== undefined && key === `com.cloudflare.api.account.zone.${zoneId}`)

/**
 * Whether a policy's resources reach the account (account permissions) or the zone (zone
 * permissions). Zones are named directly (`…zone.<id>`, `…zone.*`) or nested under an account
 * ("all zones from an account": `{ "…account.<id>": { "…zone.*": "*" } }`). Without the zone's id
 * (Zone:Read missing) only "all zones" counts.
 */
export const policyCovers = (
	resources: Readonly<Record<string, unknown>>,
	scope: PermissionScope,
	ids: { readonly accountId: string; readonly zoneId?: string | undefined },
): boolean =>
	Object.entries(resources).some(([key, value]) => {
		if (scope === "account") return isAccountKey(key, ids.accountId)
		if (isZoneKey(key, ids.zoneId)) return true
		if (!isAccountKey(key, ids.accountId)) return false
		if (value === "*") return true
		return (
			typeof value === "object" &&
			value !== null &&
			Object.keys(value).some((nested) => isZoneKey(nested, ids.zoneId))
		)
	})

/**
 * The permissions `policies` lack for this account and zone: a group counts when an allow policy
 * grants it on them and no deny policy takes it back. The Write group of a pair also grants its
 * Read (`Zone Read` is met by `Zone Write`, and so on).
 */
export const missingPermissions = (
	policies: ReadonlyArray<TokenPolicy>,
	ids: { readonly accountId: string; readonly zoneId?: string | undefined },
	permissions: ReadonlyArray<Permission> = TOKEN_PERMISSIONS,
): Array<Permission> => {
	const grants = (effect: string, permission: Permission) =>
		policies.some(
			(policy) =>
				(policy.effect ?? "allow") === effect &&
				policyCovers(policy.resources ?? {}, permission.scope, ids) &&
				(policy.permission_groups ?? []).some((group) =>
					satisfies(group.name ?? "", permission.group),
				),
		)
	return permissions.filter((permission) => !grants("allow", permission) || grants("deny", permission))
}

/** `held` grants `wanted`: the same group, or its Write twin for a Read one. */
const satisfies = (held: string, wanted: string) =>
	held === wanted || (wanted.endsWith(" Read") && held === `${wanted.slice(0, -" Read".length)} Write`)

const describe = (permissions: ReadonlyArray<Permission>) =>
	permissions.map((p) => `${p.group} (${p.scope}: ${p.why})`).join("; ")

/** The checks for a token whose own policies could be read. */
export const policyChecks = (missing: ReadonlyArray<Permission>): Array<Check> => {
	const required = missing.filter((p) => p.required)
	const recommended = missing.filter((p) => !p.required)
	const checks: Array<Check> = [
		required.length === 0
			? {
					name: "Token permissions",
					status: "ok",
					message: "everything the deploy needs, on this account and zone",
				}
			: { name: "Token permissions", status: "fail", message: `missing ${describe(required)}` },
	]
	if (recommended.length > 0) {
		checks.push({
			name: "Token permissions",
			status: "warn",
			message: `recommended, missing: ${describe(recommended)}`,
		})
	}
	return checks
}

export interface ProbeResult {
	readonly permission: Permission
	/** The HTTP status of its probe. */
	readonly status: number
}

/**
 * The checks for a token that cannot read its own policies (a user token without "API Tokens
 * Read"): each permission's read-only probe. A 2xx proves read access, not write, so the result
 * says so; a 401/403 proves the permission is missing.
 */
export const probeChecks = (results: ReadonlyArray<ProbeResult>): Array<Check> => {
	const denied = results.filter((r) => r.status === 401 || r.status === 403).map((r) => r.permission)
	const required = denied.filter((p) => p.required)
	const recommended = denied.filter((p) => !p.required)
	const unclear = results.filter(
		(r) => !(r.status >= 200 && r.status < 300) && r.status !== 401 && r.status !== 403,
	)
	const checks: Array<Check> = [
		required.length > 0
			? { name: "Token permissions", status: "fail", message: `missing ${describe(required)}` }
			: {
					name: "Token permissions",
					status: "warn",
					message:
						"the token can read everything the deploy touches, but cannot read its own policies, so its " +
						"Write permissions are unverified. An account-owned token (or one with API Tokens Read) is checked in full.",
				},
	]
	if (recommended.length > 0) {
		checks.push({
			name: "Token permissions",
			status: "warn",
			message: `recommended, missing: ${describe(recommended)}`,
		})
	}
	if (unclear.length > 0) {
		checks.push({
			name: "Token permissions",
			status: "warn",
			message: `could not check ${unclear.map((r) => `${r.permission.group} (HTTP ${r.status})`).join(", ")}`,
		})
	}
	return checks
}

/** A probe's path for this account and zone; undefined when it needs the zone's id and there is none. */
export const probePath = (
	permission: Permission,
	ids: { readonly accountId: string; readonly zoneId?: string | undefined },
): string | undefined => {
	if (permission.probe === undefined) return undefined
	if (permission.probe.includes("{zone}") && ids.zoneId === undefined) return undefined
	return permission.probe.replace("{account}", ids.accountId).replace("{zone}", ids.zoneId ?? "")
}
