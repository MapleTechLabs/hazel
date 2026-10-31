/**
 * T3 Code links (`@hazel/domain/http` `T3CodeGroup`). Connecting runs the environment's MCP OAuth:
 * Hazel registers itself as a public client, sends the member to T3's sign-in page, and the
 * callback exchanges the code with the PKCE verifier. The verifier and state ride in an httpOnly
 * cookie bound to the member who started, and the callback also requires that member's session,
 * so a callback cannot link an environment to anyone else. The link itself is the org's row
 * (`../worker/objects/org/t3code.ts`).
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import {
	InvalidOAuthStateError,
	T3CodeAccessResponse,
	T3CodeConnection,
	T3CodeConnectionResponse,
	T3CodeEnvironmentError,
	T3CodeNotConnectedError,
	type T3CodeSharing,
} from "@hazel/domain/http"
import {
	normalizeEnvironmentUrl,
	pkceChallenge,
	randomToken,
	T3CodeOAuthClient,
} from "@hazel/integrations/t3code"
import type { OrganizationId } from "@hazel/schema"
import { OrganizationId as OrganizationIdSchema, UserId } from "@hazel/schema"
import { Config, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
import { Cookies, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { HazelApi } from "../api"
import { Directory } from "../services/directory"
import { IntegrationEncryption } from "../services/integration-encryption"
import { callObject } from "../worker/objects/calls"
import { orgTarget } from "../worker/objects/kinds"
import { ConnectIntegrationCall, DisconnectIntegrationCall } from "../worker/objects/org/integrations"
import {
	MarkT3CodeExpiredCall,
	T3CodeAccessCall,
	T3CodeLinkCall,
	type T3CodeMetadata,
	UpdateT3CodeSharingCall,
} from "../worker/objects/org/t3code"
import { validateBotToken } from "./bot-commands.http"
import { requireMember } from "./integration-resources.http"

/** The seeded T3 Code bot's directory user (`IntegrationBotService`); the only caller of `getT3CodeAccess`. */
export const T3CODE_BOT_EXTERNAL_ID = "internal-bot-t3code"

const PENDING_COOKIE = "t3code_oauth"
const PENDING_MAX_AGE = Duration.minutes(15)

/** A sign-in in flight, in its httpOnly cookie. */
const Pending = Schema.Struct({
	state: Schema.String,
	codeVerifier: Schema.String,
	clientId: Schema.String,
	tokenEndpoint: Schema.String,
	issuer: Schema.String,
	environmentUrl: Schema.String,
	environmentId: Schema.String,
	environmentLabel: Schema.String,
	organizationId: OrganizationIdSchema,
	userId: UserId,
	returnTo: Schema.String,
	createdAt: Schema.Number,
})
const PendingJson = Schema.fromJsonString(Pending)

/**
 * The cookie is sealed (AES-GCM with the integration key): the callback trusts its org, endpoints
 * and return URL, so a member must not be able to write their own.
 */
export const sealPending = (pending: typeof Pending.Type) =>
	Effect.gen(function* () {
		const encryption = yield* IntegrationEncryption
		const sealed = yield* encryption.encrypt(Schema.encodeSync(PendingJson)(pending))
		return encodeURIComponent(`${sealed.keyVersion}.${sealed.iv}.${sealed.ciphertext}`)
	})

const decodeCookie = Option.liftThrowable(decodeURIComponent)

export const openPending = (raw: string) =>
	Effect.gen(function* () {
		// A cookie mangled elsewhere (a stray `%`) is no sign-in, not a 500.
		const decoded = decodeCookie(raw)
		if (Option.isNone(decoded)) return Option.none()
		const [version, iv, ciphertext] = decoded.value.split(".")
		const keyVersion = Number(version)
		if (iv === undefined || ciphertext === undefined || !Number.isInteger(keyVersion))
			return Option.none()
		const encryption = yield* IntegrationEncryption
		const json = yield* encryption.decrypt({ iv, ciphertext, keyVersion })
		return Schema.decodeUnknownOption(PendingJson)(json)
	}).pipe(
		Effect.catchTags({
			IntegrationEncryptionError: () => Effect.succeedNone,
			KeyVersionNotFoundError: () => Effect.succeedNone,
		}),
	)

const environmentConfig = Effect.gen(function* () {
	const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("production"))
	return {
		development: nodeEnv === "development",
		apiBaseUrl: yield* Config.String("API_BASE_URL"),
		frontendUrl: yield* Config.String("FRONTEND_URL"),
		cookieDomain: yield* Config.String("COOKIE_DOMAIN"),
	}
})

const redirectUriOf = (apiBaseUrl: string) => `${new URL(apiBaseUrl).origin}/integrations/t3code/callback`

/** The caller, once they are an active member of `orgId` (sessions carry no organization). */
const requireOrg = (orgId: OrganizationId) => requireMember(orgId).pipe(Effect.andThen(CurrentUser.Context))

const toDateTime = (value: Date | DateTime.Utc) =>
	DateTime.isDateTime(value) ? value : DateTime.fromDateUnsafe(value)

const connectionOf = (link: typeof T3CodeLinkCall.success.Type) =>
	link === null
		? null
		: new T3CodeConnection({
				environmentLabel: link.metadata.environmentLabel,
				environmentUrl: link.metadata.environmentUrl,
				status: link.status,
				expiresAt:
					link.metadata.expiresAt === null
						? null
						: DateTime.fromDateUnsafe(new Date(link.metadata.expiresAt)),
				connectedAt: toDateTime(link.connection.createdAt),
				sharing: link.sharing,
			})

const unavailable = (error: unknown) =>
	Effect.fail(new InternalServerError({ message: "The organization is unavailable", cause: error }))

const handleStartConnect = Effect.fn("t3code.startConnect")(function* (
	orgId: OrganizationId,
	environmentUrl: string,
) {
	const currentUser = yield* requireOrg(orgId)
	const config = yield* environmentConfig
	const oauth = yield* T3CodeOAuthClient
	const asEnvironmentError = Effect.mapError(
		(error: { readonly message: string }) => new T3CodeEnvironmentError({ message: error.message }),
	)

	const origin = yield* normalizeEnvironmentUrl(environmentUrl, {
		allowLoopbackHttp: config.development,
	}).pipe(asEnvironmentError)
	const [environment, server] = yield* Effect.all(
		[oauth.environmentInfo(origin), oauth.authorizationServer(origin)],
		{ concurrency: 2 },
	).pipe(asEnvironmentError)
	const redirectUri = redirectUriOf(config.apiBaseUrl)
	const clientId = yield* oauth.register(server, { redirectUri }).pipe(asEnvironmentError)

	const org = yield* (yield* Directory)
		.org(orgId)
		.pipe(
			Effect.mapError(
				(cause) => new InternalServerError({ message: "Failed to fetch organization", cause }),
			),
		)
	const slug = Option.match(org, { onNone: () => null, onSome: (row) => row.slug })
	const pending: typeof Pending.Type = {
		state: randomToken(),
		codeVerifier: randomToken(48),
		clientId,
		tokenEndpoint: server.token_endpoint,
		issuer: server.issuer,
		environmentUrl: origin,
		environmentId: environment.environmentId,
		environmentLabel: environment.label,
		organizationId: orgId,
		userId: currentUser.id,
		returnTo:
			slug === null ? config.frontendUrl : `${config.frontendUrl}/${slug}/settings/integrations/t3code`,
		createdAt: Date.now(),
	}
	const authorizationUrl = oauth.authorizationUrl(server, {
		clientId,
		redirectUri,
		state: pending.state,
		codeChallenge: yield* pkceChallenge(pending.codeVerifier),
		resource: `${origin}/mcp`,
	})

	const sealed = yield* sealPending(pending).pipe(
		Effect.mapError((cause) => new InternalServerError({ message: "Failed to seal the sign-in", cause })),
	)
	const cookie = yield* Effect.try({
		try: () =>
			Cookies.makeCookieUnsafe(PENDING_COOKIE, sealed, {
				domain: config.cookieDomain,
				path: "/integrations/t3code",
				httpOnly: true,
				secure: !config.development,
				sameSite: "lax",
				maxAge: PENDING_MAX_AGE,
			}),
		catch: (cause) => new InternalServerError({ message: "Failed to create the sign-in cookie", cause }),
	})
	yield* Effect.logInfo("T3 Code sign-in started", {
		event: "t3code_connect_started",
		organizationId: orgId,
		userId: currentUser.id,
		environmentHost: new URL(origin).host,
	})
	return yield* HttpServerResponse.json(
		{ authorizationUrl: authorizationUrl.toString() },
		{ cookies: Cookies.fromIterable([cookie]) },
	).pipe(
		Effect.catchTag("HttpBodyError", (cause) =>
			Effect.fail(new InternalServerError({ message: "Failed to serialize response", cause })),
		),
	)
})

type CallbackError = "denied" | "invalid_state" | "token_exchange_failed" | "db_error"

/**
 * Whether a callback may finish the sign-in in `flow`: the member who started it, the state it
 * sent, T3 as the issuer (RFC 9207), its own token endpoint, and a code rather than a refusal.
 */
export const checkCallback = (
	flow: {
		readonly userId: UserId
		readonly state: string
		readonly issuer: string
		readonly tokenEndpoint: string
		readonly environmentUrl: string
	},
	query: {
		readonly code?: string | undefined
		readonly state?: string | undefined
		readonly iss?: string | undefined
		readonly error?: string | undefined
	},
	currentUserId: UserId,
):
	| { readonly _tag: "ok"; readonly code: string }
	| { readonly _tag: "refused"; readonly error: CallbackError } => {
	if (
		currentUserId !== flow.userId ||
		query.state !== flow.state ||
		// T3 always sends `iss` (it advertises RFC 9207 support): a code from elsewhere is a mix-up.
		query.iss !== flow.issuer ||
		!URL.canParse(flow.tokenEndpoint) ||
		new URL(flow.tokenEndpoint).origin !== flow.environmentUrl
	) {
		return { _tag: "refused", error: "invalid_state" }
	}
	if (query.error !== undefined || query.code === undefined) return { _tag: "refused", error: "denied" }
	return { _tag: "ok", code: query.code }
}

const handleCallback = Effect.fn("t3code.callback")(function* (query: {
	readonly code?: string | undefined
	readonly state?: string | undefined
	readonly iss?: string | undefined
	readonly error?: string | undefined
}) {
	const config = yield* environmentConfig
	const request = yield* HttpServerRequest.HttpServerRequest
	const raw = request.cookies[PENDING_COOKIE]
	const pending = raw === undefined ? Option.none() : yield* openPending(raw)
	if (Option.isNone(pending) || Date.now() - pending.value.createdAt > Duration.toMillis(PENDING_MAX_AGE)) {
		return yield* new InvalidOAuthStateError({ message: "The T3 Code sign-in expired. Start it again." })
	}
	const flow = pending.value
	const finish = (outcome: { readonly error: CallbackError } | "success") => {
		const url = new URL(flow.returnTo)
		url.searchParams.set("provider", "t3code")
		url.searchParams.set("connection_status", outcome === "success" ? "success" : "error")
		if (outcome !== "success") url.searchParams.set("error_code", outcome.error)
		return HttpServerResponse.redirect(url.toString(), { status: 302 }).pipe(
			HttpServerResponse.expireCookieUnsafe(PENDING_COOKIE, {
				domain: config.cookieDomain,
				path: "/integrations/t3code",
				httpOnly: true,
				secure: !config.development,
				sameSite: "lax",
			}),
		)
	}

	// The cookie names who started; only that member's own session may finish.
	const currentUser = yield* CurrentUser.Context
	const checked = checkCallback(flow, query, currentUser.id)
	if (checked._tag === "refused") {
		yield* Effect.logWarning("T3 Code callback refused", {
			event: "t3code_callback_refused",
			error: checked.error,
			sameUser: currentUser.id === flow.userId,
			stateMatches: query.state === flow.state,
		})
		return finish({ error: checked.error })
	}

	const oauth = yield* T3CodeOAuthClient
	const tokens = yield* oauth
		.exchangeCode({
			tokenEndpoint: flow.tokenEndpoint,
			clientId: flow.clientId,
			redirectUri: redirectUriOf(config.apiBaseUrl),
			code: checked.code,
			codeVerifier: flow.codeVerifier,
			resource: `${flow.environmentUrl}/mcp`,
		})
		.pipe(Effect.result)
	if (tokens._tag === "Failure") {
		yield* Effect.logError("T3 Code token exchange failed", {
			event: "t3code_token_exchange_failed",
			error: tokens.failure.message,
		})
		return finish({ error: "token_exchange_failed" })
	}

	const metadata: T3CodeMetadata = {
		environmentUrl: flow.environmentUrl,
		mcpUrl: `${flow.environmentUrl}/mcp`,
		environmentId: flow.environmentId,
		environmentLabel: flow.environmentLabel,
		expiresAt: tokens.success.expiresAt?.toISOString() ?? null,
	}
	// Reconnecting keeps the member's sharing choice.
	const existing = yield* callObject(T3CodeLinkCall, orgTarget(flow.organizationId), {
		userId: flow.userId,
	})
	const sharing: T3CodeSharing = existing?.sharing ?? { mode: "private", userIds: [] }
	const saved = yield* callObject(ConnectIntegrationCall, orgTarget(flow.organizationId), {
		provider: "t3code",
		userId: flow.userId,
		connectedBy: flow.userId,
		externalAccountId: flow.environmentId,
		externalAccountName: flow.environmentLabel,
		settings: { ...sharing },
		metadata: { ...metadata },
		tokens: {
			accessToken: tokens.success.accessToken,
			refreshToken: null,
			// No refresh exists: the lapse is the link's (`metadata.expiresAt`), so the token
			// service never tries to refresh it.
			expiresAt: null,
			scope: tokens.success.scope,
		},
	}).pipe(Effect.result)
	if (saved._tag === "Failure") {
		yield* Effect.logError("T3 Code link save failed", {
			event: "t3code_connect_failed",
			cause: saved.failure,
		})
		return finish({ error: "db_error" })
	}
	yield* Effect.logInfo("AUDIT: T3 Code linked", {
		event: "t3code_connected",
		organizationId: flow.organizationId,
		userId: flow.userId,
		environmentId: flow.environmentId,
		connectionId: saved.success.connectionId,
		botInstalled: saved.success.botInstalled,
	})
	return finish("success")
})

/** Only the seeded T3 Code bot may read an owner's credential; a member's own bot never can. */
export const requireT3CodeBot = Effect.gen(function* () {
	const bot = yield* validateBotToken.pipe(
		Effect.catchTag("DatabaseError", (cause) =>
			Effect.fail(new InternalServerError({ message: "Failed to check the bot token", cause })),
		),
	)
	const directory = yield* Directory
	const user = yield* directory.db
		.first(
			SQLite.from(schema.usersTable)
				.select("externalId")
				.where(($) => [$.id.eq(bot.userId)])
				.limit(1),
		)
		.pipe(
			Effect.mapError((cause) => new InternalServerError({ message: "Failed to load the bot", cause })),
		)
	if (Option.isNone(user) || user.value.externalId !== T3CODE_BOT_EXTERNAL_ID) {
		return yield* new UnauthorizedError({
			message: "Only the T3 Code bot may use this endpoint",
			detail: `botId=${bot.id}`,
		})
	}
	return bot
})

export const HttpT3CodeLive = HttpApiBuilder.group(HazelApi, "t3code", (handlers) =>
	handlers
		.handle("getT3CodeConnection", ({ params }) =>
			Effect.gen(function* () {
				const currentUser = yield* requireOrg(params.orgId)
				const link = yield* callObject(T3CodeLinkCall, orgTarget(params.orgId), {
					userId: currentUser.id,
				})
				return new T3CodeConnectionResponse({ connection: connectionOf(link) })
			}).pipe(Effect.catchTag("ObjectCallError", unavailable)),
		)
		.handle("startT3CodeConnect", ({ params, payload }) =>
			handleStartConnect(params.orgId, payload.environmentUrl).pipe(
				Effect.catchTag("ConfigError", (cause) =>
					Effect.fail(new InternalServerError({ message: "Missing configuration", cause })),
				),
			),
		)
		.handle("t3CodeCallback", ({ query }) =>
			handleCallback(query).pipe(
				Effect.catchTags({
					ConfigError: (cause) =>
						Effect.fail(new InternalServerError({ message: "Missing configuration", cause })),
					ObjectCallError: unavailable,
				}),
			),
		)
		.handle("updateT3CodeSharing", ({ params, payload }) =>
			Effect.gen(function* () {
				const currentUser = yield* requireOrg(params.orgId)
				const link = yield* callObject(UpdateT3CodeSharingCall, orgTarget(params.orgId), {
					userId: currentUser.id,
					sharing: payload,
				})
				yield* Effect.logInfo("AUDIT: T3 Code sharing changed", {
					event: "t3code_sharing_updated",
					organizationId: params.orgId,
					userId: currentUser.id,
					mode: link.sharing.mode,
					userCount: link.sharing.userIds.length,
				})
				return new T3CodeConnectionResponse({ connection: connectionOf(link) })
			}).pipe(Effect.catchTag("ObjectCallError", unavailable)),
		)
		.handle("disconnectT3Code", ({ params }) =>
			Effect.gen(function* () {
				const currentUser = yield* requireOrg(params.orgId)
				yield* callObject(DisconnectIntegrationCall, orgTarget(params.orgId), {
					provider: "t3code",
					userId: currentUser.id,
				}).pipe(
					Effect.catchTag("IntegrationNotConnectedError", () =>
						Effect.fail(new T3CodeNotConnectedError({ ownerId: currentUser.id })),
					),
				)
			}).pipe(Effect.catchTag("ObjectCallError", unavailable)),
		)
		.handle("reportT3CodeExpired", ({ payload }) =>
			Effect.gen(function* () {
				yield* requireT3CodeBot
				yield* callObject(MarkT3CodeExpiredCall, orgTarget(payload.organizationId), {
					ownerId: payload.ownerId,
				})
				yield* Effect.logInfo("T3 Code link expired: T3 refused its credential", {
					event: "t3code_credential_refused",
					organizationId: payload.organizationId,
					ownerId: payload.ownerId,
				})
			}).pipe(Effect.catchTag("ObjectCallError", unavailable)),
		)
		.handle("getT3CodeAccess", ({ payload }) =>
			Effect.gen(function* () {
				yield* requireT3CodeBot
				const access = yield* callObject(T3CodeAccessCall, orgTarget(payload.organizationId), {
					ownerId: payload.ownerId,
					actorId: payload.actorId,
				})
				return new T3CodeAccessResponse({
					mcpUrl: access.metadata.mcpUrl,
					environmentUrl: access.metadata.environmentUrl,
					environmentLabel: access.metadata.environmentLabel,
					accessToken: access.accessToken,
					expiresAt:
						access.metadata.expiresAt === null
							? null
							: DateTime.fromDateUnsafe(new Date(access.metadata.expiresAt)),
				})
			}).pipe(
				Effect.withSpan("t3code.getAccess", {
					attributes: { "t3code.owner_id": payload.ownerId, "t3code.actor_id": payload.actorId },
				}),
				Effect.catchTag("ObjectCallError", unavailable),
			),
		),
).pipe(Layer.provide([T3CodeOAuthClient.layer, IntegrationEncryption.layer]))
