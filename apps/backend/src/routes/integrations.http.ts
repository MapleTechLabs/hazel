import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest, HttpServerResponse, Cookies } from "effect/http"
import { IntegrationConnectionRepo, OrganizationRepo } from "@hazel/backend-core"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import type { OrganizationId, UserId } from "@hazel/schema"
import {
	ConnectApiKeyResponse,
	ConnectionStatusResponse,
	IntegrationNotConnectedError,
	InvalidApiKeyError,
	InvalidOAuthStateError,
	UnsupportedProviderError,
} from "@hazel/domain/http"
import {
	CraftApiClient,
	CraftApiError,
	CraftNotFoundError,
	CraftRateLimitError,
} from "@hazel/integrations/craft"
import type { IntegrationConnection } from "@hazel/domain/models"
import { Config, DateTime, Effect, Layer, Option, Schedule, Schema, SchemaGetter } from "effect"
import * as Duration from "effect/Duration"
import { HazelApi } from "../api"
import { ChatSyncAttributionReconciler } from "../services/chat-sync/chat-sync-attribution-reconciler"
import { IntegrationTokenService } from "../services/integration-token-service"
import { IntegrationBotService } from "../services/integrations/integration-bot-service"
import { OAuthProviderRegistry } from "../services/oauth"

/**
 * OAuth state schema - encoded in the state parameter during OAuth flow.
 * Contains context needed to complete the flow after callback.
 */
const OAuthState = Schema.Struct({
	organizationId: Schema.String,
	userId: Schema.String,
	level: Schema.optional(Schema.Literals(["organization", "user"])).pipe(
		Schema.decodeTo(Schema.toType(Schema.Literals(["organization", "user"])), {
			decode: SchemaGetter.withDefault(Effect.succeed<"organization" | "user">("organization")),
			encode: SchemaGetter.required(),
		}),
	),
	/** Full URL to redirect after OAuth completes (e.g., http://localhost:3000/org/settings/integrations/github) */
	returnTo: Schema.String,
	/** Environment that initiated the OAuth flow. Used to redirect back to localhost for local dev. */
	environment: Schema.optionalKey(Schema.Literals(["local", "production"])),
})

/**
 * Retry schedule for OAuth operations.
 * Retries up to 3 times with exponential backoff (100ms, 200ms, 400ms)
 */
const oauthRetrySchedule = Schedule.max([Schedule.exponential("100 millis"), Schedule.recurs(3)])

const CRAFT_ALLOWED_HOST = "connect.craft.do"
const CRAFT_BASE_URL_PATH_PATTERN = /^\/links\/[^/]+\/api\/v1$/

const invalidCraftBaseUrlError = () =>
	new InvalidApiKeyError({
		message: "Invalid Craft base URL. Use the link URL from Craft Connect.",
	})

const invalidCraftCredentialsError = () =>
	new InvalidApiKeyError({
		message: "Invalid Craft API token or base URL",
	})

export const validateCraftBaseUrl = (rawBaseUrl: string) =>
	Effect.gen(function* () {
		const parsed = yield* Effect.try({
			try: () => new URL(rawBaseUrl),
			catch: () => invalidCraftBaseUrlError(),
		})

		const normalizedPath = parsed.pathname.replace(/\/+$/, "")
		const isValid =
			parsed.protocol === "https:" &&
			parsed.hostname.toLowerCase() === CRAFT_ALLOWED_HOST &&
			CRAFT_BASE_URL_PATH_PATTERN.test(normalizedPath) &&
			parsed.username.length === 0 &&
			parsed.password.length === 0 &&
			parsed.port.length === 0 &&
			parsed.search.length === 0 &&
			parsed.hash.length === 0

		if (!isValid) {
			return yield* Effect.fail(invalidCraftBaseUrlError())
		}

		return `${parsed.origin}${normalizedPath}`
	})

type CraftConnectApiKeyError = CraftApiError | CraftNotFoundError | CraftRateLimitError

export const mapCraftConnectApiKeyError = (
	error: CraftConnectApiKeyError,
): InvalidApiKeyError | InternalServerError => {
	if (error._tag === "CraftNotFoundError") {
		return invalidCraftCredentialsError()
	}

	if (error._tag === "CraftRateLimitError") {
		return new InternalServerError({
			message: "Craft API is temporarily unavailable",
			detail: error.message,
		})
	}

	const status = error.status
	if (status === undefined || status === 429 || status >= 500) {
		return new InternalServerError({
			message: "Craft API is temporarily unavailable",
			detail: error.message,
		})
	}

	if (status >= 400 && status < 500) {
		return invalidCraftCredentialsError()
	}

	return new InternalServerError({
		message: "Craft API is temporarily unavailable",
		detail: error.message,
	})
}

const craftConnectApiKeyErrorLogFields = (error: CraftConnectApiKeyError): Record<string, unknown> => {
	switch (error._tag) {
		case "CraftApiError":
			return {
				errorTag: error._tag,
				errorMessage: error.message,
				errorStatus: error.status ?? null,
			}
		case "CraftNotFoundError":
			return {
				errorTag: error._tag,
				resourceType: error.resourceType,
				resourceId: error.resourceId,
			}
		case "CraftRateLimitError":
			return {
				errorTag: error._tag,
				errorMessage: error.message,
				retryAfter: error.retryAfter ?? null,
			}
	}
}

/**
 * Error codes for OAuth callback failures (used in redirect URL params)
 */
type OAuthErrorCode =
	| "token_exchange_failed"
	| "account_info_failed"
	| "db_error"
	| "encryption_error"
	| "invalid_state"

/**
 * Check if an error is retryable (network error, rate limit, or server error)
 */
const isRetryableError = (error: { message: string; cause?: unknown }): boolean => {
	const message = error.message.toLowerCase()
	if (message.includes("network error") || message.includes("timeout")) {
		return true
	}
	// Check for status code in cause
	const cause = error.cause as { status?: number } | undefined
	if (cause?.status) {
		return cause.status === 429 || cause.status >= 500
	}
	return false
}

/**
 * Build redirect URL with connection status query params
 */
const buildRedirectUrl = (
	returnTo: string,
	provider: string,
	status: "success" | "error",
	errorCode?: OAuthErrorCode,
): string => {
	const url = new URL(returnTo)
	url.searchParams.set("connection_status", status)
	url.searchParams.set("provider", provider)
	if (errorCode) {
		url.searchParams.set("error_code", errorCode)
	}
	return url.toString()
}

/**
 * OAuth session cookie name prefix - combined with provider for uniqueness
 */
const OAUTH_SESSION_COOKIE_PREFIX = "oauth_session_"

/**
 * OAuth session cookie max age in seconds (15 minutes)
 */
const OAUTH_SESSION_COOKIE_MAX_AGE = 15 * 60

const CHAT_SYNC_ATTRIBUTION_PROVIDERS = new Set<IntegrationConnection.IntegrationProvider>(["discord"])

const getOAuthStateCandidates = (rawState: string): ReadonlyArray<string> => {
	const candidates: Array<string> = [rawState]
	let current = rawState
	for (let i = 0; i < 2; i++) {
		try {
			const decoded = decodeURIComponent(current)
			if (decoded === current) {
				break
			}
			candidates.push(decoded)
			current = decoded
		} catch {
			break
		}
	}
	return candidates
}

/**
 * Parse OAuth state from callback query param.
 * Supports raw JSON, single-encoded JSON, and legacy double-encoded JSON.
 */
export const parseOAuthStateParam = (rawState: string): typeof OAuthState.Type => {
	const candidates = getOAuthStateCandidates(rawState)
	let lastError: unknown = null

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate)
			return Schema.decodeUnknownSync(OAuthState)(parsed)
		} catch (error) {
			lastError = error
		}
	}

	throw lastError ?? new Error("Failed to parse OAuth state")
}

const makeOAuthSessionCookie = (
	name: string,
	value: string,
	options: {
		cookieDomain: string
		secure: boolean
		maxAgeSeconds: number
	},
) =>
	Effect.try({
		try: () =>
			Cookies.makeCookieUnsafe(name, value, {
				domain: options.cookieDomain,
				path: "/",
				httpOnly: true,
				secure: options.secure,
				sameSite: "lax",
				maxAge: Duration.seconds(options.maxAgeSeconds),
			}),
		catch: (error) =>
			new InternalServerError({
				message: "Failed to create OAuth session cookie",
				detail: String(error),
			}),
	})

const expireOAuthSessionCookie = (name: string, options: { cookieDomain: string; secure: boolean }) =>
	HttpServerResponse.expireCookieUnsafe(name, {
		domain: options.cookieDomain,
		path: "/",
		httpOnly: true,
		secure: options.secure,
		sameSite: "lax",
	})

/**
 * Initiate OAuth flow for a provider.
 * Sets a session cookie with context and redirects to the provider's OAuth consent page.
 */
const handleGetOAuthUrl = Effect.fn("integrations.getOAuthUrl")(function* (
	path: {
		orgId: OrganizationId
		provider: IntegrationConnection.IntegrationProvider
	},
	query: { level?: IntegrationConnection.ConnectionLevel },
) {
	const currentUser = yield* CurrentUser.Context
	const { orgId, provider } = path
	const level = query.level ?? "organization"

	if (!currentUser.organizationId || currentUser.organizationId !== orgId) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "You are not authorized to access this organization",
				detail: `organizationId=${orgId}`,
			}),
		)
	}

	// Get the OAuth provider from registry
	const registry = yield* OAuthProviderRegistry
	const oauthProvider = yield* registry.getProvider(provider).pipe(
		Effect.mapError(
			(error) =>
				new InternalServerError({
					message: `Provider not available: ${error._tag}`,
					detail: String(error),
				}),
		),
	)

	const frontendUrl = yield* Config.String("FRONTEND_URL")
	const cookieDomain = yield* Config.String("COOKIE_DOMAIN")

	// Get org slug for redirect URL
	const orgRepo = yield* OrganizationRepo
	const orgOption = yield* orgRepo.findById(orgId).pipe(
		Effect.mapError(
			(error) =>
				new InternalServerError({
					message: "Failed to fetch organization",
					detail: String(error),
				}),
		),
	)
	const org = yield* Option.match(orgOption, {
		onNone: () =>
			Effect.fail(
				new UnauthorizedError({
					message: "Organization not found",
					detail: `Could not find organization ${orgId}`,
				}),
			),
		onSome: Effect.succeed,
	})

	// Determine environment from NODE_ENV config
	// Local dev uses "local" so production can redirect callbacks back to localhost
	const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("production"))
	const environment = nodeEnv === "development" ? "local" : "production"
	const cookieSecure = nodeEnv !== "development"

	// Build state object for OAuth flow
	const stateData = {
		organizationId: orgId,
		userId: currentUser.id,
		level,
		returnTo:
			level === "user"
				? `${frontendUrl}/${org.slug}/my-settings/linked-accounts`
				: `${frontendUrl}/${org.slug}/settings/integrations/${provider}`,
		environment,
	}

	// Keep state as raw JSON; URLSearchParams will apply encoding.
	const state = JSON.stringify(stateData)

	// Build authorization URL using the provider
	const authorizationUrl = yield* oauthProvider.buildAuthorizationUrl(state).pipe(
		Effect.map((url) => {
			// User-level Discord linking only needs identity; org-level keeps guild/bot scopes.
			if (provider === "discord" && level === "user") {
				url.searchParams.set("scope", "identify")
				url.searchParams.delete("permissions")
			}
			return url
		}),
	)

	yield* Effect.logInfo("OAuth flow initiated", {
		event: "oauth_flow_initiated",
		provider,
		organizationId: orgId,
		userId: currentUser.id,
		level,
	})

	// Build session cookie with OAuth context
	// This cookie is used as a fallback when GitHub drops the state parameter
	// (e.g., when setup_action=update for already-installed apps)
	const sessionCookieValue = encodeURIComponent(
		JSON.stringify({
			...stateData,
			createdAt: Date.now(),
		}),
	)
	const sessionCookieName = `${OAUTH_SESSION_COOKIE_PREFIX}${provider}`

	// Build cookie for session state recovery during callback (e.g. when GitHub drops state)
	const sessionCookie = yield* makeOAuthSessionCookie(sessionCookieName, sessionCookieValue, {
		cookieDomain,
		secure: cookieSecure,
		maxAgeSeconds: OAUTH_SESSION_COOKIE_MAX_AGE,
	})

	// Return JSON response with authorization URL and session cookie
	return yield* HttpServerResponse.json(
		{ authorizationUrl: authorizationUrl.toString() },
		{
			cookies: Cookies.fromIterable([sessionCookie]),
		},
	).pipe(
		Effect.catchTag("HttpBodyError", (e) =>
			Effect.fail(
				new InternalServerError({ message: "Failed to serialize response", detail: String(e) }),
			),
		),
	)
})

/**
 * OAuth session state schema - stored in session cookie
 * Includes createdAt for expiration checking
 */
const OAuthSessionState = Schema.Struct({
	organizationId: Schema.String,
	userId: Schema.String,
	level: Schema.optional(Schema.Literals(["organization", "user"])).pipe(
		Schema.decodeTo(Schema.toType(Schema.Literals(["organization", "user"])), {
			decode: SchemaGetter.withDefault(Effect.succeed<"organization" | "user">("organization")),
			encode: SchemaGetter.required(),
		}),
	),
	returnTo: Schema.String,
	environment: Schema.optionalKey(Schema.Literals(["local", "production"])),
	createdAt: Schema.Number,
})

/**
 * Handle OAuth callback from provider.
 * Exchanges authorization code for tokens and stores the connection.
 *
 * For GitHub App: Receives `installation_id` instead of `code`.
 * For standard OAuth: Receives `code` authorization code.
 *
 * State recovery priority:
 * 1. URL state parameter (standard OAuth flow)
 * 2. Session cookie (fallback for GitHub App updates when state is dropped)
 * 3. Installation ID lookup (GitHub-initiated callbacks, not user-initiated)
 */
const handleOAuthCallback = Effect.fn("integrations.oauthCallback")(function* (
	path: { provider: IntegrationConnection.IntegrationProvider },
	query: {
		code?: string
		state?: string
		guild_id?: string
		permissions?: string
		installation_id?: string
		setup_action?: string
	},
) {
	const { provider } = path
	const { code, state: encodedState, installation_id, setup_action, guild_id, permissions } = query

	// Get request to read cookies
	const request = yield* HttpServerRequest.HttpServerRequest
	const sessionCookieName = `${OAUTH_SESSION_COOKIE_PREFIX}${provider}`
	const sessionCookie = request.cookies[sessionCookieName]
	const cookieDomain = yield* Config.String("COOKIE_DOMAIN")
	const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("production"))
	const cookieSecure = nodeEnv !== "development"

	yield* Effect.logInfo("OAuth callback received", {
		event: "integration_callback_start",
		provider,
		hasState: !!encodedState,
		hasSessionCookie: !!sessionCookie,
		hasInstallationId: !!installation_id,
		hasCode: !!code,
		hasGuildId: !!guild_id,
		setupAction: setup_action,
	})

	// Helper to build redirect with cookie clearing
	const buildRedirectWithCookieClear = (url: string) =>
		HttpServerResponse.redirect(url, { status: 302 }).pipe(
			expireOAuthSessionCookie(sessionCookieName, { cookieDomain, secure: cookieSecure }),
		)

	// Try to get state from URL parameter first
	let parsedState: typeof OAuthState.Type | null = null
	let stateSource: "url" | "cookie" | "installation_lookup" = "url"

	if (encodedState) {
		// Priority 1: State from URL parameter
		const stateResult = yield* Effect.try({
			try: () => parseOAuthStateParam(encodedState),
			catch: (e) => new InvalidOAuthStateError({ message: `Invalid state: ${e}` }),
		}).pipe(Effect.option)

		if (Option.isSome(stateResult)) {
			parsedState = stateResult.value
			stateSource = "url"
		}
	}

	// Priority 2: Try session cookie if state is missing or invalid
	if (!parsedState && sessionCookie) {
		yield* Effect.logDebug("Attempting to recover state from session cookie", {
			event: "integration_callback_cookie_fallback",
			provider,
		})

		const sessionResult = yield* Effect.try({
			try: () =>
				Schema.decodeUnknownSync(OAuthSessionState)(JSON.parse(decodeURIComponent(sessionCookie))),
			catch: (e) => new InvalidOAuthStateError({ message: `Invalid session cookie: ${e}` }),
		}).pipe(Effect.option)

		if (Option.isSome(sessionResult)) {
			const session = sessionResult.value
			// Check if cookie has expired (15 minutes)
			const cookieAge = Date.now() - session.createdAt
			const maxAge = OAUTH_SESSION_COOKIE_MAX_AGE * 1000 // Convert to milliseconds

			if (cookieAge <= maxAge) {
				parsedState = {
					organizationId: session.organizationId,
					userId: session.userId,
					level: session.level,
					returnTo: session.returnTo,
					environment: session.environment,
				}
				stateSource = "cookie"

				yield* Effect.logInfo("OAuth state recovered from session cookie", {
					event: "integration_callback_cookie_recovery",
					provider,
					organizationId: session.organizationId,
					cookieAgeSeconds: Math.round(cookieAge / 1000),
				})
			} else {
				yield* Effect.logWarning("OAuth session cookie expired", {
					event: "integration_callback_cookie_expired",
					provider,
					cookieAgeSeconds: Math.round(cookieAge / 1000),
				})
			}
		}
	}

	// Priority 3: For GitHub update callbacks without state or cookie,
	// fall back to installation ID lookup (GitHub-initiated, not user-initiated)
	if (!parsedState && installation_id && setup_action === "update") {
		const connectionRepo = yield* IntegrationConnectionRepo
		const orgRepo = yield* OrganizationRepo
		const frontendUrl = yield* Config.String("FRONTEND_URL")

		yield* Effect.logInfo("GitHub update callback - looking up by installation ID", {
			event: "integration_callback_installation_lookup",
			installationId: installation_id,
		})

		// Look up all connections by installation ID
		const connections = yield* connectionRepo.findAllByGitHubInstallationId(installation_id)

		if (connections.length === 0) {
			// No connection found - redirect to root
			yield* Effect.logWarning("GitHub update callback for unknown installation", {
				event: "integration_callback_update_unknown",
				installationId: installation_id,
			})
			return buildRedirectWithCookieClear(frontendUrl)
		}

		if (connections.length > 1) {
			yield* Effect.logWarning("GitHub update callback for shared installation (ambiguous org)", {
				event: "integration_callback_update_ambiguous",
				installationId: installation_id,
				connectionCount: connections.length,
			})
			return buildRedirectWithCookieClear(frontendUrl)
		}

		const connection = connections[0]!

		// Get the organization to find its slug
		const orgOption = yield* orgRepo
			.findById(connection.organizationId)
			.pipe(Effect.catchTag("DatabaseError", () => Effect.succeed(Option.none())))

		if (Option.isNone(orgOption)) {
			yield* Effect.logWarning("GitHub update callback: organization not found", {
				event: "integration_callback_update_org_not_found",
				organizationId: connection.organizationId,
			})
			return buildRedirectWithCookieClear(frontendUrl)
		}

		const org = orgOption.value

		yield* Effect.logInfo("GitHub update callback processed (installation lookup)", {
			event: "integration_callback_update_success",
			installationId: installation_id,
			organizationId: connection.organizationId,
		})

		// Redirect to the organization's GitHub integration settings with success status
		return buildRedirectWithCookieClear(
			buildRedirectUrl(`${frontendUrl}/${org.slug}/settings/integrations/github`, provider, "success"),
		)
	}

	// If we still don't have state, fail
	if (!parsedState) {
		yield* Effect.logError("OAuth callback missing state and no valid session cookie", {
			event: "integration_callback_missing_state",
			provider,
			hasSessionCookie: !!sessionCookie,
		})
		return yield* Effect.fail(new InvalidOAuthStateError({ message: "Missing OAuth state" }))
	}

	yield* Effect.logDebug("OAuth callback state resolved", {
		event: "integration_callback_state_resolved",
		provider,
		stateSource,
		organizationId: parsedState.organizationId,
		level: parsedState.level,
	})

	yield* Effect.logDebug("OAuth callback state parsed", {
		event: "integration_callback_state_parsed",
		provider,
		organizationId: parsedState.organizationId,
		environment: parsedState.environment,
	})

	// Helper to redirect with error (clears session cookie)
	const redirectWithError = (errorCode: OAuthErrorCode) =>
		buildRedirectWithCookieClear(buildRedirectUrl(parsedState.returnTo, provider, "error", errorCode))

	// Check if we need to redirect to local environment
	// This happens when production receives a callback for a local dev flow
	const isProduction = nodeEnv !== "development"

	if (isProduction && parsedState.environment === "local") {
		yield* Effect.logDebug("OAuth callback redirecting to local environment", {
			event: "integration_callback_local_redirect",
			provider,
			stateSource,
		})
		// Redirect to localhost with all params preserved
		const localUrl = new URL(`http://localhost:3003/integrations/${provider}/callback`)
		if (installation_id) localUrl.searchParams.set("installation_id", installation_id)
		if (code) localUrl.searchParams.set("code", code)

		// Always pass normalized JSON state so local callback parsing is consistent.
		const stateToPass = JSON.stringify({
			organizationId: parsedState.organizationId,
			userId: parsedState.userId,
			level: parsedState.level,
			returnTo: parsedState.returnTo,
			environment: parsedState.environment,
		})
		if (stateToPass) {
			localUrl.searchParams.set("state", stateToPass)
		}

		// Clear the cookie since we're forwarding to local
		return buildRedirectWithCookieClear(localUrl.toString())
	}

	// Get the OAuth provider from registry
	const registry = yield* OAuthProviderRegistry
	const oauthProvider = yield* registry.getProvider(provider).pipe(
		Effect.tapError((error) =>
			Effect.logError("OAuth provider not available", {
				event: "integration_callback_provider_unavailable",
				provider,
				error: error._tag,
			}),
		),
		Effect.mapError(
			(error) =>
				new InvalidOAuthStateError({
					message: `Provider not available: ${error._tag}`,
				}),
		),
	)

	const connectionRepo = yield* IntegrationConnectionRepo
	const tokenService = yield* IntegrationTokenService
	const chatSyncAttributionReconciler = yield* ChatSyncAttributionReconciler

	// Determine if this is a GitHub App installation callback
	// GitHub App callbacks have `installation_id` instead of `code`
	const isGitHubAppCallback = provider === "github" && installation_id

	// Use installation_id as "code" for GitHub App (the provider handles this)
	const authCode = isGitHubAppCallback ? installation_id : code

	if (!authCode) {
		yield* Effect.logError("OAuth callback missing auth code", {
			event: "integration_callback_missing_code",
			provider,
			isGitHubApp: isGitHubAppCallback,
		})
		return redirectWithError("invalid_state")
	}

	// Exchange code for tokens using the provider (with retry for transient failures)
	yield* Effect.logDebug("OAuth token exchange starting", {
		event: "integration_token_exchange_attempt",
		provider,
		isGitHubApp: isGitHubAppCallback,
	})

	const tokensResult = yield* oauthProvider.exchangeCodeForTokens(authCode).pipe(
		Effect.retry({
			schedule: oauthRetrySchedule,
			while: isRetryableError,
		}),
		Effect.result,
	)

	if (tokensResult._tag === "Failure") {
		const error = tokensResult.failure
		yield* Effect.logError("OAuth token exchange failed", {
			event: "integration_token_exchange_failed",
			provider,
			error: error.message,
			isGitHubApp: isGitHubAppCallback,
		})
		return redirectWithError("token_exchange_failed")
	}

	const tokens = tokensResult.success
	yield* Effect.logInfo("OAuth token exchange succeeded", {
		event: "integration_token_exchange_success",
		provider,
		hasRefreshToken: !!tokens.refreshToken,
		expiresAt: tokens.expiresAt?.toISOString(),
	})

	// Get account info from provider (with retry for transient failures)
	yield* Effect.logDebug("OAuth account info fetch starting", {
		event: "integration_account_info_attempt",
		provider,
	})

	const accountInfoResult = yield* oauthProvider.getAccountInfo(tokens.accessToken).pipe(
		Effect.retry({
			schedule: oauthRetrySchedule,
			while: isRetryableError,
		}),
		Effect.result,
	)

	if (accountInfoResult._tag === "Failure") {
		const error = accountInfoResult.failure
		yield* Effect.logError("OAuth account info fetch failed", {
			event: "integration_account_info_failed",
			provider,
			error: error.message,
		})
		return redirectWithError("account_info_failed")
	}

	const accountInfo = accountInfoResult.success
	yield* Effect.logDebug("OAuth account info fetch succeeded", {
		event: "integration_account_info_success",
		provider,
		externalAccountId: accountInfo.externalAccountId,
		externalAccountName: accountInfo.externalAccountName,
	})

	// Prepare connection metadata
	// For GitHub App, store the installation ID for token regeneration
	const metadata = isGitHubAppCallback
		? { installationId: installation_id }
		: provider === "discord" && parsedState.level === "organization"
			? {
					guildId: guild_id ?? null,
					permissions: permissions ?? null,
				}
			: null

	// Create or update connection
	yield* Effect.logDebug("OAuth database upsert starting", {
		event: "integration_db_upsert_attempt",
		provider,
		organizationId: parsedState.organizationId,
		level: parsedState.level,
	})

	const connectionResult = yield* (
		parsedState.level === "user"
			? connectionRepo.upsertByUserAndProvider({
					provider,
					organizationId: parsedState.organizationId as OrganizationId,
					userId: parsedState.userId as UserId,
					level: "user",
					status: "active",
					externalAccountId: accountInfo.externalAccountId,
					externalAccountName: accountInfo.externalAccountName,
					connectedBy: parsedState.userId as UserId,
					settings: null,
					metadata,
					errorMessage: null,
					lastUsedAt: null,
					deletedAt: null,
				})
			: connectionRepo.upsertByOrgAndProvider({
					provider,
					organizationId: parsedState.organizationId as OrganizationId,
					userId: null,
					level: "organization",
					status: "active",
					externalAccountId: accountInfo.externalAccountId,
					externalAccountName: accountInfo.externalAccountName,
					connectedBy: parsedState.userId as UserId,
					settings: null,
					metadata,
					errorMessage: null,
					lastUsedAt: null,
					deletedAt: null,
				})
	).pipe(Effect.result)

	if (connectionResult._tag === "Failure") {
		yield* Effect.logError("OAuth database upsert failed", {
			event: "integration_db_upsert_failed",
			provider,
			error: String(connectionResult.failure),
		})
		return redirectWithError("db_error")
	}

	const connection = connectionResult.success
	yield* Effect.logDebug("OAuth database upsert succeeded", {
		event: "integration_db_upsert_success",
		provider,
		connectionId: connection.id,
	})

	// Store encrypted tokens
	yield* Effect.logDebug("OAuth token storage starting", {
		event: "integration_token_storage_attempt",
		provider,
		connectionId: connection.id,
	})

	const storeResult = yield* tokenService
		.storeTokens(connection.id, {
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresAt: tokens.expiresAt,
			scope: tokens.scope,
		})
		.pipe(Effect.result)

	if (storeResult._tag === "Failure") {
		yield* Effect.logError("OAuth token storage failed", {
			event: "integration_token_storage_failed",
			provider,
			connectionId: connection.id,
			error: String(storeResult.failure),
		})
		return redirectWithError("encryption_error")
	}

	yield* Effect.logDebug("OAuth token storage succeeded", {
		event: "integration_token_storage_success",
		provider,
		connectionId: connection.id,
	})

	if (
		parsedState.level === "user" &&
		CHAT_SYNC_ATTRIBUTION_PROVIDERS.has(provider) &&
		typeof accountInfo.externalAccountId === "string" &&
		accountInfo.externalAccountId.length > 0
	) {
		const reconcileResult = yield* chatSyncAttributionReconciler
			.relinkHistoricalProviderMessages({
				organizationId: parsedState.organizationId as OrganizationId,
				provider,
				userId: parsedState.userId as UserId,
				externalAccountId: accountInfo.externalAccountId,
				externalAccountName: accountInfo.externalAccountName,
			})
			.pipe(Effect.result)

		if (reconcileResult._tag === "Failure") {
			yield* Effect.logWarning(
				"Failed to re-attribute historical external messages after account link",
				{
					event: "chat_sync_attribution_relink_failed",
					provider,
					organizationId: parsedState.organizationId,
					userId: parsedState.userId,
					externalAccountId: accountInfo.externalAccountId,
					error: String(reconcileResult.failure),
				},
			)
		}
	}

	yield* Effect.logInfo("AUDIT: Integration connected", {
		event: "integration_connected",
		provider,
		organizationId: parsedState.organizationId,
		userId: parsedState.userId,
		level: parsedState.level,
		externalAccountId: accountInfo.externalAccountId,
		externalAccountName: accountInfo.externalAccountName,
		isGitHubApp: isGitHubAppCallback,
		connectionId: connection.id,
	})

	if (parsedState.level === "organization") {
		// Add seeded bot to org for org-level OAuth integration providers.
		const integrationBotService = yield* IntegrationBotService
		yield* integrationBotService.addBotToOrg(provider, parsedState.organizationId as OrganizationId).pipe(
			Effect.tap((result) =>
				Option.isSome(result)
					? Effect.logInfo("Integration bot added to organization", {
							event: "integration_bot_added_to_org",
							provider,
							organizationId: parsedState.organizationId,
						})
					: Effect.logWarning("Integration bot not found - run seed script", {
							event: "integration_bot_not_seeded",
							provider,
							organizationId: parsedState.organizationId,
						}),
			),
			// Note: catchAll is intentional here - this is a best-effort operation
			// after OAuth success. We catch all errors to prevent disrupting the flow.
			Effect.catch((error) =>
				Effect.logWarning("Failed to add integration bot to org (non-critical)", {
					event: "integration_bot_add_failed",
					provider,
					organizationId: parsedState.organizationId,
					error: String(error),
				}),
			),
		)
	}

	// Redirect back to the settings page with success status (clears session cookie)
	const successUrl = buildRedirectUrl(parsedState.returnTo, provider, "success")
	yield* Effect.logDebug("OAuth callback redirecting with success", {
		event: "integration_callback_redirect",
		provider,
		status: "success",
		stateSource,
		redirectUrl: successUrl,
	})

	return buildRedirectWithCookieClear(successUrl)
})

/**
 * Connect an integration using an API key (non-OAuth providers like Craft).
 * Validates the token by calling the provider's API, then stores the connection.
 */
const handleConnectApiKey = Effect.fn("integrations.connectApiKey")(function* (
	path: {
		orgId: OrganizationId
		provider: IntegrationConnection.IntegrationProvider
	},
	payload: { token: string; baseUrl: string },
) {
	const currentUser = yield* CurrentUser.Context
	const { orgId, provider } = path
	const { token, baseUrl } = payload

	// Validate credentials by calling the provider's API
	let externalAccountName: string | null = null
	let validatedBaseUrl = baseUrl

	if (provider === "craft") {
		validatedBaseUrl = yield* validateCraftBaseUrl(baseUrl)
		const parsedBaseUrl = new URL(validatedBaseUrl)
		const craftApiClient = yield* CraftApiClient
		const spaceInfo = yield* craftApiClient.getSpaceInfo(validatedBaseUrl, token).pipe(
			Effect.catchTags({
				CraftApiError: (error: CraftApiError) =>
					Effect.logWarning("Craft API key validation failed", {
						event: "craft_api_key_validation_failed",
						provider,
						organizationId: orgId,
						baseUrlHost: parsedBaseUrl.hostname,
						baseUrlPath: parsedBaseUrl.pathname,
						...craftConnectApiKeyErrorLogFields(error),
					}).pipe(Effect.andThen(Effect.fail(mapCraftConnectApiKeyError(error)))),
				CraftNotFoundError: (error: CraftNotFoundError) =>
					Effect.logWarning("Craft API key validation failed", {
						event: "craft_api_key_validation_failed",
						provider,
						organizationId: orgId,
						baseUrlHost: parsedBaseUrl.hostname,
						baseUrlPath: parsedBaseUrl.pathname,
						...craftConnectApiKeyErrorLogFields(error),
					}).pipe(Effect.andThen(Effect.fail(mapCraftConnectApiKeyError(error)))),
				CraftRateLimitError: (error: CraftRateLimitError) =>
					Effect.logWarning("Craft API key validation failed", {
						event: "craft_api_key_validation_failed",
						provider,
						organizationId: orgId,
						baseUrlHost: parsedBaseUrl.hostname,
						baseUrlPath: parsedBaseUrl.pathname,
						...craftConnectApiKeyErrorLogFields(error),
					}).pipe(Effect.andThen(Effect.fail(mapCraftConnectApiKeyError(error)))),
			}),
		)
		externalAccountName = spaceInfo.name ?? "Craft Space"
	} else {
		return yield* Effect.fail(new UnsupportedProviderError({ provider }))
	}

	const connectionRepo = yield* IntegrationConnectionRepo

	// Upsert connection with settings containing the base URL
	const connection = yield* connectionRepo.upsertByOrgAndProvider({
		provider,
		organizationId: orgId,
		userId: null,
		level: "organization",
		status: "active",
		externalAccountId: null,
		externalAccountName,
		connectedBy: currentUser.id,
		settings: { baseUrl: validatedBaseUrl },
		metadata: null,
		errorMessage: null,
		lastUsedAt: null,
		deletedAt: null,
	})

	// Store the encrypted token (no refresh token, no expiry for API keys)
	const tokenService = yield* IntegrationTokenService
	yield* tokenService.storeTokens(connection.id, {
		accessToken: token,
	})

	yield* Effect.logInfo("AUDIT: Integration connected via API key", {
		event: "integration_api_key_connected",
		provider,
		organizationId: orgId,
		userId: currentUser.id,
		level: "organization",
		externalAccountName,
		connectionId: connection.id,
	})

	// Best-effort: add integration bot to org
	const integrationBotService = yield* IntegrationBotService
	yield* integrationBotService.addBotToOrg(provider, orgId).pipe(
		Effect.catch((error) =>
			Effect.logWarning("Failed to add integration bot to org (non-critical)", {
				event: "integration_bot_add_failed",
				provider,
				organizationId: orgId,
				error: String(error),
			}),
		),
	)

	return new ConnectApiKeyResponse({
		connected: true,
		provider,
		externalAccountName,
	})
})

/**
 * Get connection status for a provider.
 */
const handleGetConnectionStatus = Effect.fn("integrations.getConnectionStatus")(function* (
	path: {
		orgId: OrganizationId
		provider: IntegrationConnection.IntegrationProvider
	},
	query: { level?: IntegrationConnection.ConnectionLevel },
) {
	const { orgId, provider } = path
	const currentUser = yield* CurrentUser.Context
	const connectionRepo = yield* IntegrationConnectionRepo
	const level = query.level ?? "organization"

	if (!currentUser.organizationId || currentUser.organizationId !== orgId) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "You are not authorized to access this organization",
				detail: `organizationId=${orgId}`,
			}),
		)
	}

	const connectionOption = yield* level === "user"
		? connectionRepo.findUserConnection(orgId, currentUser.id, provider)
		: connectionRepo.findByOrgAndProvider(orgId, provider)

	if (Option.isNone(connectionOption)) {
		return new ConnectionStatusResponse({
			connected: false,
			provider,
			externalAccountName: null,
			status: null,
			connectedAt: null,
			lastUsedAt: null,
		})
	}

	const connection = connectionOption.value
	return new ConnectionStatusResponse({
		connected: connection.status === "active",
		provider,
		externalAccountName: connection.externalAccountName,
		status: connection.status,
		connectedAt: connection.createdAt ? DateTime.fromDateUnsafe(connection.createdAt) : null,
		lastUsedAt: connection.lastUsedAt ? DateTime.fromDateUnsafe(connection.lastUsedAt) : null,
	})
})

/**
 * Disconnect an integration and revoke tokens.
 */
const handleDisconnect = Effect.fn("integrations.disconnect")(function* (
	path: {
		orgId: OrganizationId
		provider: IntegrationConnection.IntegrationProvider
	},
	query: { level?: IntegrationConnection.ConnectionLevel },
) {
	const { orgId, provider } = path
	const currentUser = yield* CurrentUser.Context
	const connectionRepo = yield* IntegrationConnectionRepo
	const tokenService = yield* IntegrationTokenService
	const chatSyncAttributionReconciler = yield* ChatSyncAttributionReconciler
	const level = query.level ?? "organization"

	if (!currentUser.organizationId || currentUser.organizationId !== orgId) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "You are not authorized to access this organization",
				detail: `organizationId=${orgId}`,
			}),
		)
	}

	const connectionOption = yield* level === "user"
		? connectionRepo.findUserConnection(orgId, currentUser.id, provider)
		: connectionRepo.findByOrgAndProvider(orgId, provider)

	if (Option.isNone(connectionOption)) {
		return yield* Effect.fail(new IntegrationNotConnectedError({ provider }))
	}

	const connection = connectionOption.value
	const externalAccountId = connection.externalAccountId

	if (
		level === "user" &&
		CHAT_SYNC_ATTRIBUTION_PROVIDERS.has(provider) &&
		typeof externalAccountId === "string" &&
		externalAccountId.length > 0
	) {
		const reconcileResult = yield* chatSyncAttributionReconciler
			.unlinkHistoricalProviderMessages({
				organizationId: orgId,
				provider,
				userId: currentUser.id,
				externalAccountId,
				externalAccountName: connection.externalAccountName,
			})
			.pipe(Effect.result)

		if (reconcileResult._tag === "Failure") {
			yield* Effect.logWarning(
				"Failed to re-attribute historical external messages after account unlink",
				{
					event: "chat_sync_attribution_unlink_failed",
					provider,
					organizationId: orgId,
					userId: currentUser.id,
					externalAccountId,
					error: String(reconcileResult.failure),
				},
			)
		}
	}

	// Delete tokens first
	yield* tokenService.deleteTokens(connection.id)

	// Soft delete the connection
	yield* connectionRepo.softDelete(connection.id)

	yield* Effect.logInfo("AUDIT: Integration disconnected", {
		event: "integration_disconnected",
		provider,
		organizationId: orgId,
		level,
		userId: level === "user" ? currentUser.id : null,
		connectionId: connection.id,
		externalAccountId: connection.externalAccountId,
		externalAccountName: connection.externalAccountName,
	})
})

export const HttpIntegrationLive = HttpApiBuilder.group(HazelApi, "integrations", (handlers) =>
	handlers
		.handle("getOAuthUrl", ({ params, query }) =>
			handleGetOAuthUrl(params, query).pipe(
				Effect.catchTag("ConfigError", (err) =>
					Effect.fail(
						new InternalServerError({ message: "Missing configuration", detail: String(err) }),
					),
				),
			),
		)
		.handle("oauthCallback", ({ params, query }) =>
			handleOAuthCallback(params, query).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Database error during OAuth callback",
							detail: String(error),
						}),
					),
				),
				Effect.catchTag("ConfigError", (err) =>
					Effect.fail(
						new InternalServerError({ message: "Missing configuration", detail: String(err) }),
					),
				),
			),
		)
		.handle("connectApiKey", ({ params, payload }) =>
			handleConnectApiKey(params, payload).pipe(
				Effect.catchTags({
					DatabaseError: (error: { readonly _tag: "DatabaseError"; readonly message?: string }) =>
						Effect.fail(
							new InternalServerError({
								message: "Database error during API key connection",
								detail: String(error),
							}),
						),
					SchemaError: (error: { readonly _tag: "SchemaError"; readonly message?: string }) =>
						Effect.fail(
							new InternalServerError({
								message: "Failed to parse API response",
								detail: String(error),
							}),
						),
					IntegrationEncryptionError: (error: {
						readonly _tag: "IntegrationEncryptionError"
						readonly message?: string
					}) =>
						Effect.fail(
							new InternalServerError({
								message: "Failed to encrypt token",
								detail: String(error),
							}),
						),
				}),
			),
		)
		.handle("getConnectionStatus", ({ params, query }) =>
			handleGetConnectionStatus(params, query).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Failed to get connection status",
							detail: String(error),
						}),
					),
				),
			),
		)
		.handle("disconnect", ({ params, query }) =>
			handleDisconnect(params, query).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Failed to disconnect integration",
							detail: String(error),
						}),
					),
				),
			),
		),
).pipe(Layer.provide(CraftApiClient.layer), Layer.provide(IntegrationBotService.layer))
