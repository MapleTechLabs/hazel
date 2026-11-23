/**
 * A customer install (alchemy stage `customer-<name>`, `docs/self-hosting.md`): its hostnames, the
 * env file `bun run customer:install` writes (`.env.customer-<name>`), and the checks
 * `bun run customer:check` runs on it. Pure: the commands in `../commands/customer.ts` do the I/O.
 */
import { Option, Schema } from "effect"

export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/
/** The stack's own check on `HAZEL_ZONE` (`alchemy.run.ts`). */
export const ZONE_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export const ORG_CREATION_MODES = ["anyone", "admins"] as const

export const stageOf = (name: string) => `customer-${name}`
export const envFileName = (name: string) => `.env.customer-${name}`

/** `zone` as the stack normalizes it: lower case, no trailing dot. */
export const normalizeZone = (zone: string) => zone.trim().toLowerCase().replace(/\.$/, "")

/** The install's hostnames (`customerDomains` in `packages/infra/src/cloudflare/stage.ts`). */
export const customerHosts = (zone: string) => ({
	web: `app.${zone}`,
	api: `api.${zone}`,
	linkPreview: `link-preview.${zone}`,
	botGateway: `bot-gateway.${zone}`,
	cdn: `cdn.${zone}`,
	mail: `mail.${zone}`,
	inbound: `inbound.${zone}`,
})

/**
 * The sign-in providers' redirect URLs: `@yielded/auth` serves `/auth/<provider>/callback` on the
 * api origin (`packages/auth/src/yielded/server.ts`).
 */
export const oauthCallbackUrls = (zone: string) => {
	const api = `https://${customerHosts(zone).api}`
	return {
		github: `${api}/auth/github/callback`,
		google: `${api}/auth/google/callback`,
	}
}

/**
 * Generated once per install and never rotated by the installer: new auth keys sign everyone out
 * and void pending sign-ins, and a new `INTEGRATION_ENCRYPTION_KEY` makes every stored integration
 * token unreadable (rotation goes through `INTEGRATION_ENCRYPTION_KEY_PREV`).
 */
export const GENERATED_KEYS = [
	"INTEGRATION_ENCRYPTION_KEY",
	"AUTH_BINDING_KEY",
	"AUTH_TRANSACTION_KEY",
	"AUTH_ACCESS_TOKEN_KID",
	"AUTH_ACCESS_TOKEN_PRIVATE_JWK",
] as const

export type GeneratedSecrets = Record<(typeof GENERATED_KEYS)[number], string>

export interface OAuthApp {
	readonly clientId: string
	readonly clientSecret: string
}

/** Sign-in needs an OAuth app: GitHub, Google or both (`apps/backend/src/services/hazel-auth.ts`). */
export const hasSignInProvider = (input: Pick<CustomerInput, "github" | "google">): boolean =>
	[input.github, input.google].some(
		(app) => app !== undefined && app.clientId !== "" && app.clientSecret !== "",
	)

export interface CustomerInput {
	readonly name: string
	readonly zone: string
	readonly cloudflareAccountId: string
	readonly cloudflareApiToken: string
	/** Sign-in providers: at least one of the two (`hasSignInProvider`). */
	readonly github?: OAuthApp | undefined
	readonly google?: OAuthApp | undefined
	readonly allowedEmailDomains?: string | undefined
	readonly instanceAdminEmails?: string | undefined
	readonly orgCreation?: (typeof ORG_CREATION_MODES)[number] | undefined
}

/** Keys the installer writes; anything else already in the file is kept as is. */
const MANAGED_KEYS = [
	"HAZEL_ZONE",
	"CLOUDFLARE_ACCOUNT_ID",
	"CLOUDFLARE_API_TOKEN",
	"COOKIE_DOMAIN",
	"AUTH_GITHUB_CLIENT_ID",
	"AUTH_GITHUB_CLIENT_SECRET",
	"AUTH_GOOGLE_CLIENT_ID",
	"AUTH_GOOGLE_CLIENT_SECRET",
	"ALLOWED_EMAIL_DOMAINS",
	"INSTANCE_ADMIN_EMAILS",
	"ORG_CREATION",
	...GENERATED_KEYS,
] as const

/** Parses a dotenv file: `KEY=value`, optionally single or double quoted; `#` lines are comments. */
export const parseEnv = (content: string): Record<string, string> => {
	const result: Record<string, string> = {}
	for (const line of content.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) continue
		const eq = trimmed.indexOf("=")
		if (eq === -1) continue
		const key = trimmed
			.slice(0, eq)
			.replace(/^export\s+/, "")
			.trim()
		let value = trimmed.slice(eq + 1).trim()
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1)
		}
		result[key] = value
	}
	return result
}

/** Single-quotes what a dotenv parser would otherwise split or truncate (JSON, spaces, `#`). */
const formatValue = (value: string) =>
	/[\s#"'{}]/.test(value) && !value.includes("'") ? `'${value}'` : value

const line = (key: string, value: string | undefined) =>
	value ? `${key}=${formatValue(value)}` : `# ${key}=`

/**
 * The env file's content. `extra` holds keys an operator added by hand (integrations, Maple, ...);
 * they are kept below the managed ones.
 */
export const renderCustomerEnv = (
	input: CustomerInput,
	secrets: GeneratedSecrets,
	extra: Record<string, string> = {},
	generatedAt = new Date().toISOString().slice(0, 10),
): string => {
	const zone = normalizeZone(input.zone)
	const hosts = customerHosts(zone)
	const extraKeys = Object.keys(extra).filter(
		(key) => !(MANAGED_KEYS as ReadonlyArray<string>).includes(key),
	)
	return [
		`# Hazel customer install: stage ${stageOf(input.name)} (bun run customer:install, ${generatedAt}).`,
		`# Holds production secrets: keep it out of git and in a password manager or secret store.`,
		`# Check: bun run customer:check ${input.name}   Deploy: bun run customer:deploy ${input.name}`,
		"",
		`# Every hostname hangs off this zone: ${hosts.web}, ${hosts.api}, ${hosts.cdn}, ...`,
		line("HAZEL_ZONE", zone),
		"",
		"# Cloudflare account the install deploys into (alchemy reads these).",
		line("CLOUDFLARE_ACCOUNT_ID", input.cloudflareAccountId),
		line("CLOUDFLARE_API_TOKEN", input.cloudflareApiToken),
		"",
		"# Integration OAuth cookies, shared by the app and api hosts.",
		line("COOKIE_DOMAIN", `.${zone}`),
		"",
		"# Sign-in. Callback URLs:",
		`#   GitHub: ${oauthCallbackUrls(zone).github}`,
		`#   Google: ${oauthCallbackUrls(zone).google}`,
		line("AUTH_GITHUB_CLIENT_ID", input.github?.clientId),
		line("AUTH_GITHUB_CLIENT_SECRET", input.github?.clientSecret),
		line("AUTH_GOOGLE_CLIENT_ID", input.google?.clientId),
		line("AUTH_GOOGLE_CLIENT_SECRET", input.google?.clientSecret),
		"",
		"# Access: sign-in limited to these email domains (comma separated; unset: anyone), the",
		"# instance admins (comma-separated emails), who may create organizations (anyone | admins).",
		line("ALLOWED_EMAIL_DOMAINS", input.allowedEmailDomains),
		line("INSTANCE_ADMIN_EMAILS", input.instanceAdminEmails),
		line("ORG_CREATION", input.orgCreation),
		"",
		"# Generated by the installer. NEVER change or lose these: new auth keys sign everyone out,",
		"# a new INTEGRATION_ENCRYPTION_KEY makes every connected integration unreadable.",
		...GENERATED_KEYS.map((key) => line(key, secrets[key])),
		...(extraKeys.length > 0
			? ["", "# Added by hand", ...extraKeys.map((key) => line(key, extra[key]))]
			: []),
		"",
	].join("\n")
}

export interface Check {
	readonly name: string
	readonly status: "ok" | "warn" | "fail"
	readonly message: string
}

const ok = (name: string, message: string): Check => ({ name, status: "ok", message })
const warn = (name: string, message: string): Check => ({ name, status: "warn", message })
const fail = (name: string, message: string): Check => ({ name, status: "fail", message })

const decodedLength = (value: string, encoding: "base64" | "base64url") => {
	const bytes = Buffer.from(value, encoding)
	// Buffer skips characters outside the alphabet; a round trip catches them.
	const roundTrip = bytes.toString(encoding).replace(/=+$/, "")
	return roundTrip === value.replace(/=+$/, "") ? bytes.length : -1
}

const list = (value: string | undefined) =>
	(value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item !== "")

/** Static checks of a customer env file (`bun run customer:check`); no network. */
export const checkCustomerEnv = (name: string, env: Record<string, string | undefined>): Array<Check> => {
	const checks: Array<Check> = []
	const present = (key: string) => (env[key] ?? "").trim() !== ""

	checks.push(
		NAME_RE.test(name)
			? ok("Stage", stageOf(name))
			: fail("Stage", `"${name}" must match ${NAME_RE.source}`),
	)

	const zone = normalizeZone(env.HAZEL_ZONE ?? "")
	checks.push(
		ZONE_RE.test(zone)
			? ok("HAZEL_ZONE", `${zone} (app.${zone}, api.${zone}, ...)`)
			: fail("HAZEL_ZONE", zone ? `"${zone}" is not a DNS zone` : "missing"),
	)

	checks.push(
		ACCOUNT_ID_RE.test(env.CLOUDFLARE_ACCOUNT_ID ?? "")
			? ok("CLOUDFLARE_ACCOUNT_ID", "set")
			: fail("CLOUDFLARE_ACCOUNT_ID", "missing, or not a 32-character hex account id"),
	)
	checks.push(
		present("CLOUDFLARE_API_TOKEN")
			? ok("CLOUDFLARE_API_TOKEN", "set")
			: fail("CLOUDFLARE_API_TOKEN", "missing"),
	)

	const encryptionKey = env.INTEGRATION_ENCRYPTION_KEY ?? ""
	checks.push(
		decodedLength(encryptionKey, "base64") === 32
			? ok("INTEGRATION_ENCRYPTION_KEY", "32 bytes")
			: fail("INTEGRATION_ENCRYPTION_KEY", "missing, or not 32 bytes of base64"),
	)
	for (const key of ["AUTH_BINDING_KEY", "AUTH_TRANSACTION_KEY"]) {
		checks.push(
			decodedLength(env[key] ?? "", "base64url") === 32
				? ok(key, "32 bytes")
				: fail(key, "missing, or not 32 bytes of base64url"),
		)
	}
	checks.push(
		present("AUTH_ACCESS_TOKEN_KID")
			? ok("AUTH_ACCESS_TOKEN_KID", env.AUTH_ACCESS_TOKEN_KID ?? "")
			: fail("AUTH_ACCESS_TOKEN_KID", "missing"),
	)
	checks.push(checkJwk(env.AUTH_ACCESS_TOKEN_PRIVATE_JWK))

	// `apps/backend/src/services/hazel-auth.ts` turns sign-in on with a GitHub or a Google client.
	const providers = [
		{ name: "GitHub sign-in", id: "AUTH_GITHUB_CLIENT_ID", secret: "AUTH_GITHUB_CLIENT_SECRET" },
		{ name: "Google sign-in", id: "AUTH_GOOGLE_CLIENT_ID", secret: "AUTH_GOOGLE_CLIENT_SECRET" },
	] as const
	for (const provider of providers) {
		checks.push(
			present(provider.id) !== present(provider.secret)
				? fail(provider.name, `set both ${provider.id} and ${provider.secret}, or neither`)
				: ok(provider.name, present(provider.id) ? "configured" : "off"),
		)
	}
	if (!providers.some((provider) => present(provider.id) && present(provider.secret))) {
		checks.push(
			fail(
				"Sign-in",
				"no OAuth app: set AUTH_GITHUB_CLIENT_ID/SECRET or AUTH_GOOGLE_CLIENT_ID/SECRET, or nobody could sign in",
			),
		)
	}

	const domains = list(env.ALLOWED_EMAIL_DOMAINS)
	// The backend lowercases them and drops a leading `@` (`packages/auth/src/yielded/instance-access.ts`).
	const badDomains = domains.filter((domain) => !DOMAIN_RE.test(domain.toLowerCase().replace(/^@+/, "")))
	checks.push(
		badDomains.length > 0
			? fail("ALLOWED_EMAIL_DOMAINS", `not domains: ${badDomains.join(", ")}`)
			: ok(
					"ALLOWED_EMAIL_DOMAINS",
					domains.length > 0 ? domains.join(", ") : "unset (anyone may sign in)",
				),
	)
	const admins = list(env.INSTANCE_ADMIN_EMAILS)
	const badAdmins = admins.filter((email) => !EMAIL_RE.test(email))
	checks.push(
		badAdmins.length > 0
			? fail("INSTANCE_ADMIN_EMAILS", `not emails: ${badAdmins.join(", ")}`)
			: admins.length > 0
				? ok("INSTANCE_ADMIN_EMAILS", admins.join(", "))
				: warn("INSTANCE_ADMIN_EMAILS", "unset: the install has no instance admin"),
	)
	if (domains.length > 0) {
		const allowed = domains.map((domain) => domain.toLowerCase().replace(/^@+/, ""))
		const outside = admins.filter(
			(email) =>
				EMAIL_RE.test(email) &&
				!allowed.includes(email.slice(email.lastIndexOf("@") + 1).toLowerCase()),
		)
		if (outside.length > 0) {
			checks.push(
				warn(
					"Admins' domains",
					`outside ALLOWED_EMAIL_DOMAINS, so they cannot sign in: ${outside.join(", ")}`,
				),
			)
		}
	}
	// The backend reads anything but `admins` as `anyone`, so a typo would silently open it up.
	const orgCreation = (env.ORG_CREATION ?? "").trim().toLowerCase()
	if (orgCreation === "") {
		checks.push(ok("ORG_CREATION", "unset (anyone)"))
	} else if (!(ORG_CREATION_MODES as ReadonlyArray<string>).includes(orgCreation)) {
		checks.push(fail("ORG_CREATION", `"${orgCreation}": expected ${ORG_CREATION_MODES.join(" | ")}`))
	} else if (orgCreation === "admins" && admins.length === 0) {
		checks.push(
			fail("ORG_CREATION", "admins, but INSTANCE_ADMIN_EMAILS is unset: nobody could create one"),
		)
	} else {
		checks.push(ok("ORG_CREATION", orgCreation))
	}

	if (zone && present("COOKIE_DOMAIN") && env.COOKIE_DOMAIN !== `.${zone}`) {
		checks.push(warn("COOKIE_DOMAIN", `${env.COOKIE_DOMAIN}; expected .${zone}`))
	}
	const ignored = [
		"S3_BUCKET",
		"S3_ENDPOINT",
		"S3_ACCESS_KEY_ID",
		"S3_SECRET_ACCESS_KEY",
		"DEV_SIGNIN_SECRET",
	].filter(present)
	if (ignored.length > 0) {
		checks.push(
			warn(
				"Unused keys",
				`${ignored.join(", ")}: a customer install creates its own uploads bucket and never runs the dev sign-in`,
			),
		)
	}
	return checks
}

/** The private half of an ES256 key, as `generate-keys` writes it. */
const PrivateEs256Jwk = Schema.fromJsonString(
	Schema.Struct({ kty: Schema.Literal("EC"), crv: Schema.Literal("P-256"), d: Schema.String }),
)

const checkJwk = (value: string | undefined): Check => {
	const name = "AUTH_ACCESS_TOKEN_PRIVATE_JWK"
	if (!value) return fail(name, "missing")
	return Option.isSome(Schema.decodeOption(PrivateEs256Jwk)(value))
		? ok(name, "ES256 private key")
		: fail(name, "not JSON of an ES256 (EC P-256) private JWK")
}
