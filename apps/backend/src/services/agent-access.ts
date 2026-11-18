/**
 * Agent access over the directory (D1): Hazel as an OAuth 2.1 authorization server for MCP clients
 * (dynamic registration, PKCE S256 authorization codes, rotating refresh tokens), personal access
 * tokens, and resolving a bearer token to the user and grant it acts for (`routes/mcp.ts`, and for
 * `customers:read` the RPC middleware and the customers sync socket).
 *
 * Only SHA-256 hashes of codes and tokens are stored. D1 has no transactions, so each step is one
 * statement and a code is claimed (`redeemedAt`) before anything is issued for it: a replayed code
 * finds it claimed. A half-finished exchange leaves at most a grant without tokens, which the user
 * sees and can revoke.
 */
import { SQLite, schema } from "@hazel/db"
import { type AgentScope, storedAgentScopes } from "@hazel/domain/http"
import type { ApiScope } from "@hazel/domain/scopes"
import type { AgentClientId, AgentGrantId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { Directory } from "./directory"

/** How long an access token lives; clients refresh after. */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
/** How long a refresh token lives unused; each refresh issues a new one. */
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How long an authorization code may wait for its exchange. */
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000
/** Throttle for `lastUsedAt` writes: at most one per grant per this interval. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000

const PREFIX = { access: "hzl_oat_", refresh: "hzl_ort_", personal: "hzl_pat_", code: "hzl_code_" } as const

const randomSecret = () => {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return Base64Url.encode(bytes)
}

export const sha256Hex = (value: string) =>
	Effect.promise(async () => {
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		return Hex.encode(new Uint8Array(digest))
	})

const sha256Base64Url = (value: string) =>
	Effect.promise(async () => {
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		return Base64Url.encode(new Uint8Array(digest))
	})

const newSecret = (kind: keyof typeof PREFIX) =>
	Effect.gen(function* () {
		const value = `${PREFIX[kind]}${randomSecret()}`
		return { value, hash: yield* sha256Hex(value) }
	})

/** An agent token is one of ours by its prefix (others go to the session/bot paths). */
export const isAgentToken = (token: string) =>
	token.startsWith(PREFIX.access) || token.startsWith(PREFIX.personal)

/** An OAuth error for the token endpoint (RFC 6749 §5.2). */
export class OAuthProtocolError extends Schema.TaggedError<OAuthProtocolError>()("OAuthProtocolError", {
	error: Schema.String,
	description: Schema.String,
}) {}

const invalidGrant = (description: string) => new OAuthProtocolError({ error: "invalid_grant", description })

const isLoopback = (url: URL) =>
	url.protocol === "http:" &&
	(url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost")

const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "vbscript:"])

/**
 * A redirect URI a client may register: https, http on loopback (CLI clients), or a native app's
 * private-use scheme (`cursor://…`), never a script scheme, never a fragment.
 */
export const isAllowedRedirectUri = (uri: string) => {
	try {
		const url = new URL(uri)
		if (url.hash !== "") return false
		if (url.protocol === "https:") return true
		if (url.protocol === "http:") return isLoopback(url)
		return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !FORBIDDEN_SCHEMES.has(url.protocol)
	} catch {
		return false
	}
}

/** RFC 8252 §7.3: a loopback redirect matches whatever port the client opened. */
export const redirectMatches = (registered: string, given: string) => {
	if (registered === given) return true
	try {
		const a = new URL(registered)
		const b = new URL(given)
		return (
			isLoopback(a) &&
			isLoopback(b) &&
			a.hostname === b.hostname &&
			a.pathname === b.pathname &&
			a.search === b.search
		)
	} catch {
		return false
	}
}

export interface IssuedTokens {
	readonly accessToken: string
	readonly refreshToken: string
	readonly expiresInSeconds: number
	readonly scopes: ReadonlyArray<AgentScope>
}

/** Who a verified agent token acts for. */
export interface AgentPrincipal {
	readonly userId: UserId
	readonly grantId: AgentGrantId
	readonly name: string
	readonly scopes: ReadonlyArray<AgentScope>
	/** When the token stops authenticating (epoch ms); `null` for a personal token without expiry. */
	readonly expiresAt: number | null
}

/**
 * The RPC scopes each agent scope grants on `/rpc`. The messages scopes are the MCP server's alone
 * (its tools run the handlers themselves); `customers:read` reaches the Customers read RPCs.
 */
const AGENT_RPC_SCOPES = {
	"messages:read": [],
	"messages:write": [],
	"customers:read": ["customers:read"],
} as const satisfies Record<AgentScope, ReadonlyArray<ApiScope>>

/** An agent may call an RPC when it requires scopes, and the agent's scopes grant each one. */
export const agentMayCallRpc = (
	agentScopes: ReadonlyArray<AgentScope>,
	required: ReadonlyArray<ApiScope>,
): boolean => {
	const granted = new Set<ApiScope>(agentScopes.flatMap((scope) => AGENT_RPC_SCOPES[scope]))
	return required.length > 0 && required.every((scope) => granted.has(scope))
}

/** The row an `INSERT … RETURNING` wrote; none is a broken invariant. */
const returnedRow = <A>(rows: ReadonlyArray<A>) => {
	const row = rows[0]
	return row === undefined
		? Effect.die(new Error("INSERT … RETURNING returned no row"))
		: Effect.succeed(row)
}

export class AgentAccess extends Context.Service<AgentAccess>()("@hazel/backend/AgentAccess", {
	make: Effect.gen(function* () {
		const directory = yield* Directory
		const db = directory.db

		const client = (clientId: AgentClientId) =>
			db.first(
				SQLite.from(schema.agentClientsTable)
					.select()
					.where(($) => [$.id.eq(clientId)]),
			)

		/** The client, when `redirectUri` is one it registered. */
		const clientFor = (clientId: AgentClientId, redirectUri: string) =>
			client(clientId).pipe(
				Effect.map(
					Option.filter((row) => row.redirectUris.some((uri) => redirectMatches(uri, redirectUri))),
				),
			)

		const registerClient = (input: {
			readonly clientName: string
			readonly redirectUris: ReadonlyArray<string>
			readonly clientUri: string | null
			readonly logoUri: string | null
		}) =>
			db
				.run(
					SQLite.insertInto(schema.agentClientsTable)
						.values({
							clientName: input.clientName,
							redirectUris: [...input.redirectUris],
							clientUri: input.clientUri,
							logoUri: input.logoUri,
						})
						.returning("id", "createdAt"),
				)
				.pipe(Effect.flatMap(returnedRow))

		const createCode = (input: {
			readonly clientId: AgentClientId
			readonly userId: UserId
			readonly redirectUri: string
			readonly codeChallenge: string
			readonly scopes: ReadonlyArray<AgentScope>
		}) =>
			Effect.gen(function* () {
				const code = yield* newSecret("code")
				yield* db.run(
					SQLite.insertInto(schema.agentAuthCodesTable).values({
						codeHash: code.hash,
						clientId: input.clientId,
						userId: input.userId,
						redirectUri: input.redirectUri,
						codeChallenge: input.codeChallenge,
						scopes: [...input.scopes],
						expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
					}),
				)
				return code.value
			})

		const issueTokens = (grantId: AgentGrantId, scopes: ReadonlyArray<AgentScope>) =>
			Effect.gen(function* () {
				const access = yield* newSecret("access")
				const refresh = yield* newSecret("refresh")
				const now = Date.now()
				yield* db.run(
					SQLite.insertInto(schema.agentTokensTable).values({
						tokenHash: access.hash,
						grantId,
						kind: "access",
						expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
					}),
				)
				yield* db.run(
					SQLite.insertInto(schema.agentTokensTable).values({
						tokenHash: refresh.hash,
						grantId,
						kind: "refresh",
						expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
					}),
				)
				return {
					accessToken: access.value,
					refreshToken: refresh.value,
					expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000,
					scopes,
				} satisfies IssuedTokens
			})

		/** `grant_type=authorization_code`: claim the code, check it, open a grant and issue tokens. */
		const exchangeCode = (input: {
			readonly code: string
			readonly clientId: string
			readonly redirectUri: string
			readonly codeVerifier: string
		}) =>
			Effect.gen(function* () {
				const codeHash = yield* sha256Hex(input.code)
				const claimed = yield* db.first(
					SQLite.update(schema.agentAuthCodesTable)
						.set({ redeemedAt: new Date() })
						.where(($) => [
							$.codeHash.eq(codeHash),
							$.redeemedAt.isNull(),
							$.expiresAt.gt(new Date()),
						])
						.returning("clientId", "userId", "redirectUri", "codeChallenge", "scopes"),
				)
				if (Option.isNone(claimed)) return yield* invalidGrant("The code is invalid, expired or used")
				const code = claimed.value
				if (code.clientId !== input.clientId)
					return yield* invalidGrant("The code belongs to another client")
				if (code.redirectUri !== input.redirectUri)
					return yield* invalidGrant("redirect_uri does not match")
				if ((yield* sha256Base64Url(input.codeVerifier)) !== code.codeChallenge)
					return yield* invalidGrant("code_verifier does not match")

				const registered = yield* client(code.clientId)
				if (Option.isNone(registered)) return yield* invalidGrant("The client is gone")
				const scopes = storedAgentScopes(code.scopes)
				const grant = yield* db
					.run(
						SQLite.insertInto(schema.agentGrantsTable)
							.values({
								userId: code.userId,
								kind: "oauth",
								clientId: code.clientId,
								name: registered.value.clientName,
								scopes: [...scopes],
							})
							.returning("id"),
					)
					.pipe(Effect.flatMap(returnedRow))
				return yield* issueTokens(grant.id, scopes)
			}).pipe(Effect.withSpan("AgentAccess.exchangeCode"))

		const liveGrant = (grantId: AgentGrantId) =>
			db.first(
				SQLite.from(schema.agentGrantsTable)
					.select()
					.where(($) => [$.id.eq(grantId), $.revokedAt.isNull()]),
			)

		/** End a grant: no new tokens, and every token it issued stops working. */
		const endGrant = (grantId: AgentGrantId) =>
			Effect.gen(function* () {
				yield* db.run(
					SQLite.update(schema.agentGrantsTable)
						.set({ revokedAt: new Date() })
						.where(($) => [$.id.eq(grantId), $.revokedAt.isNull()]),
				)
				yield* db.run(
					SQLite.deleteFrom(schema.agentTokensTable).where(($) => [$.grantId.eq(grantId)]),
				)
			})

		/**
		 * `grant_type=refresh_token`: rotate. The old refresh token is kept as `spent`; presenting it
		 * again means it leaked (whoever refreshed first holds the live chain), so the grant ends.
		 *
		 * D1 has no transactions, so the claim is the last write: the new tokens are issued first, and
		 * a failure before the claim leaves the presented token usable for a retry. Losing the claim
		 * to a concurrent refresh of the same token drops the tokens just issued.
		 */
		const refresh = (input: { readonly refreshToken: string; readonly clientId: string }) =>
			Effect.gen(function* () {
				const tokenHash = yield* sha256Hex(input.refreshToken)
				const presented = yield* db.first(
					SQLite.from(schema.agentTokensTable)
						.select("grantId", "kind", "expiresAt")
						.where(($) => [$.tokenHash.eq(tokenHash)]),
				)
				if (Option.isSome(presented) && presented.value.kind === "spent") {
					yield* Effect.logWarning("Agent refresh token reused; ending its grant", {
						grantId: presented.value.grantId,
					})
					yield* endGrant(presented.value.grantId)
					return yield* invalidGrant("The refresh token was already used; sign in again")
				}
				if (
					Option.isNone(presented) ||
					presented.value.kind !== "refresh" ||
					presented.value.expiresAt === null ||
					presented.value.expiresAt.getTime() <= Date.now()
				)
					return yield* invalidGrant("The refresh token is invalid or expired")
				const grant = yield* liveGrant(presented.value.grantId)
				if (Option.isNone(grant) || grant.value.clientId !== input.clientId)
					return yield* invalidGrant("The grant was revoked")

				const issued = yield* issueTokens(grant.value.id, storedAgentScopes(grant.value.scopes))
				const claimed = yield* db.run(
					SQLite.update(schema.agentTokensTable)
						.set({ kind: "spent" })
						.where(($) => [$.tokenHash.eq(tokenHash), $.kind.eq("refresh")])
						.returning("tokenHash"),
				)
				if (claimed.length === 0) {
					// Two refreshes of one token at once: the same reuse, decided by timing. End the grant
					// (the winner's tokens with it), as a sequential reuse does.
					yield* Effect.logWarning("Agent refresh token used concurrently; ending its grant", {
						grantId: grant.value.id,
					})
					yield* endGrant(grant.value.id)
					return yield* invalidGrant("The refresh token was already used; sign in again")
				}
				return issued
			}).pipe(Effect.withSpan("AgentAccess.refresh"))

		/** The user and grant a bearer token acts for: a live access or personal token of a live grant. */
		const authenticate = (token: string) =>
			Effect.gen(function* () {
				if (!isAgentToken(token)) return Option.none<AgentPrincipal>()
				const tokenHash = yield* sha256Hex(token)
				const row = yield* db.first(
					SQLite.from(schema.agentTokensTable)
						.select()
						.where(($) => [$.tokenHash.eq(tokenHash)]),
				)
				// Only access and personal tokens authenticate (never a refresh or spent one).
				if (Option.isNone(row) || (row.value.kind !== "access" && row.value.kind !== "personal"))
					return Option.none<AgentPrincipal>()
				if (row.value.expiresAt !== null && row.value.expiresAt.getTime() <= Date.now())
					return Option.none<AgentPrincipal>()
				const grant = yield* liveGrant(row.value.grantId)
				if (Option.isNone(grant)) return Option.none<AgentPrincipal>()
				const lastUsed = grant.value.lastUsedAt?.getTime() ?? 0
				if (Date.now() - lastUsed > LAST_USED_RESOLUTION_MS) {
					yield* db
						.run(
							SQLite.update(schema.agentGrantsTable)
								.set({ lastUsedAt: new Date() })
								.where(($) => [$.id.eq(grant.value.id)]),
						)
						.pipe(Effect.ignore)
				}
				return Option.some<AgentPrincipal>({
					userId: grant.value.userId,
					grantId: grant.value.id,
					name: grant.value.name,
					scopes: storedAgentScopes(grant.value.scopes),
					expiresAt: row.value.expiresAt?.getTime() ?? null,
				})
			}).pipe(Effect.withSpan("AgentAccess.authenticate"))

		const listGrants = (userId: UserId) =>
			db.run(
				SQLite.from(schema.agentGrantsTable)
					.select()
					.where(($) => [$.userId.eq(userId), $.revokedAt.isNull()])
					.orderBy(($) => [[$.createdAt, "desc"]]),
			)

		/** Revoke the user's grant and drop its tokens; false when it is not theirs or already gone. */
		const revokeGrant = (userId: UserId, grantId: AgentGrantId) =>
			Effect.gen(function* () {
				const revoked = yield* db.run(
					SQLite.update(schema.agentGrantsTable)
						.set({ revokedAt: new Date() })
						.where(($) => [$.id.eq(grantId), $.userId.eq(userId), $.revokedAt.isNull()])
						.returning("id"),
				)
				if (revoked.length === 0) return false
				yield* db.run(
					SQLite.deleteFrom(schema.agentTokensTable).where(($) => [$.grantId.eq(grantId)]),
				)
				return true
			})

		const createPersonalToken = (input: {
			readonly userId: UserId
			readonly name: string
			readonly scopes: ReadonlyArray<AgentScope>
		}) =>
			Effect.gen(function* () {
				const grant = yield* db
					.run(
						SQLite.insertInto(schema.agentGrantsTable)
							.values({
								userId: input.userId,
								kind: "token",
								clientId: null,
								name: input.name,
								scopes: [...input.scopes],
							})
							.returning(),
					)
					.pipe(Effect.flatMap(returnedRow))
				const secret = yield* newSecret("personal")
				yield* db.run(
					SQLite.insertInto(schema.agentTokensTable).values({
						tokenHash: secret.hash,
						grantId: grant.id,
						kind: "personal",
						expiresAt: null,
					}),
				)
				return { grant, token: secret.value }
			})

		return {
			client,
			clientFor,
			registerClient,
			createCode,
			exchangeCode,
			refresh,
			authenticate,
			listGrants,
			revokeGrant,
			createPersonalToken,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
