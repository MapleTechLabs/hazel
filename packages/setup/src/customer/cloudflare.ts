/**
 * The online checks of a customer install (`bun run customer:check`): the Cloudflare token is
 * live and allowed to deploy (`token.ts`), the zone is active in the account, and the account has
 * a workers.dev subdomain (alchemy's state store Worker is served from it).
 */
import { Effect } from "effect"
import type { Check } from "./install.ts"
import { normalizeZone } from "./install.ts"
import {
	missingPermissions,
	policyChecks,
	type ProbeResult,
	probeChecks,
	probePath,
	TOKEN_PERMISSIONS,
	type TokenPolicy,
} from "./token.ts"

interface CloudflareBody {
	readonly success?: boolean
	readonly result?: unknown
	readonly errors?: ReadonlyArray<{ readonly code?: number; readonly message?: string }>
}

const cloudflareGet = (path: string, token: string) =>
	Effect.tryPromise(async () => {
		const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
			headers: { authorization: `Bearer ${token}` },
		})
		return {
			status: response.status,
			body: (await response.json().catch(() => ({}))) as CloudflareBody,
		}
	})

const resultObject = (body: CloudflareBody) =>
	typeof body.result === "object" && body.result !== null && !Array.isArray(body.result)
		? (body.result as Record<string, unknown>)
		: undefined

/**
 * The token's policies, read through the token itself: an account-owned token reads them on its
 * account (it needs Account API Tokens Read, which the deploy's Write grants), a user token on
 * /user/tokens (only with API Tokens Read). Undefined when neither answers.
 */
const readOwnPolicies = (token: string, tokenId: string, accountId: string, owner: "user" | "account") =>
	Effect.gen(function* () {
		const path =
			owner === "account" ? `/accounts/${accountId}/tokens/${tokenId}` : `/user/tokens/${tokenId}`
		const response = yield* cloudflareGet(path, token)
		const policies = resultObject(response.body)?.policies
		return response.body.success === true && Array.isArray(policies)
			? (policies as ReadonlyArray<TokenPolicy>)
			: undefined
	})

const permissionChecks = (
	token: string,
	tokenId: string | undefined,
	owner: "user" | "account",
	ids: {
		readonly accountId: string
		readonly zoneId?: string | undefined
	},
) =>
	Effect.gen(function* () {
		const policies =
			tokenId === undefined ? undefined : yield* readOwnPolicies(token, tokenId, ids.accountId, owner)
		if (policies !== undefined) return policyChecks(missingPermissions(policies, ids))
		const results: Array<ProbeResult> = []
		for (const permission of TOKEN_PERMISSIONS) {
			const path = probePath(permission, ids)
			if (path === undefined) continue
			results.push({ permission, status: (yield* cloudflareGet(path, token)).status })
		}
		return probeChecks(results)
	})

/** No workers.dev subdomain: Cloudflare answers 404 / error 10007 until one is claimed. */
const subdomainCheck = (token: string, accountId: string) =>
	Effect.gen(function* () {
		const response = yield* cloudflareGet(`/accounts/${accountId}/workers/subdomain`, token)
		const subdomain = resultObject(response.body)?.subdomain
		if (response.body.success === true && typeof subdomain === "string" && subdomain !== "") {
			return {
				name: "workers.dev subdomain",
				status: "ok",
				message: `${subdomain}.workers.dev`,
			} as Check
		}
		if (response.status === 401 || response.status === 403) return undefined
		return {
			name: "workers.dev subdomain",
			status: "fail",
			message:
				"the account has none: open Workers & Pages in the Cloudflare dashboard once to claim it " +
				"(alchemy's state store Worker is served from it)",
		} as Check
	})

/**
 * R2 must be activated once per account (a separate subscription, even on Workers Paid); until
 * then the bucket API answers "Please enable R2 through the Cloudflare Dashboard" (10042).
 */
const r2Check = (token: string, accountId: string) =>
	Effect.gen(function* () {
		const response = yield* cloudflareGet(`/accounts/${accountId}/r2/buckets`, token)
		if (response.body.success === true) return { name: "R2", status: "ok", message: "enabled" } as Check
		const notEnabled = (response.body.errors ?? []).some(
			(error) => error.code === 10042 || /enable R2/i.test(error.message ?? ""),
		)
		if (!notEnabled) return undefined
		return {
			name: "R2",
			status: "fail",
			message: "not enabled on the account: activate it once under R2 in the Cloudflare dashboard",
		} as Check
	})

/**
 * The token is live and allowed to deploy, the zone is active in the account, R2 and workers.dev
 * are set up. A request that fails midway keeps the checks already made (a failure among them
 * still blocks the deploy) and adds a warning for the rest.
 */
export const onlineChecks = (env: Record<string, string>): Effect.Effect<Array<Check>> => {
	const checks: Array<Check> = []
	return Effect.gen(function* () {
		const token = env.CLOUDFLARE_API_TOKEN ?? ""
		const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? ""
		const zone = normalizeZone(env.HAZEL_ZONE ?? "")
		if (!token || !accountId) return checks

		// User tokens verify on /user/tokens, account-owned ones on the account.
		const user = yield* cloudflareGet("/user/tokens/verify", token)
		const account =
			user.body.success === true
				? undefined
				: yield* cloudflareGet(`/accounts/${accountId}/tokens/verify`, token)
		const verified =
			user.body.success === true ? user : account?.body.success === true ? account : undefined
		if (verified === undefined) {
			checks.push({
				name: "Cloudflare token",
				status: "fail",
				message: "Cloudflare rejects it (expired, revoked or mistyped)",
			})
			return checks
		}
		const owner = verified === user ? "user" : "account"
		const tokenId = resultObject(verified.body)?.id
		checks.push({ name: "Cloudflare token", status: "ok", message: `active (${owner} token)` })

		let zoneId: string | undefined
		if (zone) {
			const zones = yield* cloudflareGet(
				`/zones?${new URLSearchParams({ name: zone, "account.id": accountId })}`,
				token,
			)
			const result = Array.isArray(zones.body.result)
				? (zones.body.result as Array<{ id?: string; status?: string }>)
				: []
			zoneId = result[0]?.id
			checks.push(
				!zones.body.success
					? {
							name: "Zone",
							// Refused: Zone Read is missing, and without the zone's id no zone permission
							// below could be checked. Anything else is Cloudflare's own trouble.
							status: zones.status === 401 || zones.status === 403 ? "fail" : "warn",
							message: `could not list zones (${zones.body.errors?.[0]?.message ?? zones.status}); the token needs Zone Read`,
						}
					: result.length === 0
						? {
								name: "Zone",
								status: "fail",
								message: `${zone} is not a zone in account ${accountId}`,
							}
						: result[0]?.status === "active"
							? { name: "Zone", status: "ok", message: `${zone} is active` }
							: {
									name: "Zone",
									status: "warn",
									message: `${zone} is ${result[0]?.status ?? "not active"}: point its nameservers at Cloudflare first`,
								},
			)
		}

		checks.push(
			...(yield* permissionChecks(token, typeof tokenId === "string" ? tokenId : undefined, owner, {
				accountId,
				zoneId,
			})),
		)
		const r2 = yield* r2Check(token, accountId)
		if (r2 !== undefined) checks.push(r2)
		const subdomain = yield* subdomainCheck(token, accountId)
		if (subdomain !== undefined) checks.push(subdomain)
		return checks
	}).pipe(
		Effect.orElseSucceed((): Array<Check> => [
			...checks,
			{
				name: "Cloudflare",
				status: "warn",
				message: "could not reach api.cloudflare.com; skipped the remaining online checks",
			},
		]),
	)
}
