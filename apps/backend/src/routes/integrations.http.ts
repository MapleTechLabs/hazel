import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest, HttpServerResponse, Cookies } from "effect/http"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import type { OrganizationId, UserId } from "@hazel/schema"
import {
	ConnectApiKeyResponse,
	ConnectionStatusResponse,
	IntegrationUnavailableError,
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
import { Cause, Config, DateTime, Effect, Layer, Option, Schedule, Schema, SchemaGetter } from "effect"
import * as Duration from "effect/Duration"
import { HazelApi } from "../api"
import { Directory } from "../services/directory"
import { OAuthProviderRegistry } from "../services/oauth"
import { callObject } from "../worker/objects/calls"
import { orgTarget } from "../worker/objects/kinds"
import {
	ConnectIntegrationCall,
	DisconnectIntegrationCall,
	IntegrationConnectionCall,
} from "../worker/objects/org/integrations"

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

/** Rate limits, 5xx and transport failures are Craft being unavailable; other 4xx mean a bad key. */
export const mapCraftConnectApiKeyError = (
	error: CraftConnectApiKeyError,
): InvalidApiKeyError | IntegrationUnavailableError => {
	const unavailable = () =>
		new IntegrationUnavailableError({ message: "Craft API is temporarily unavailable" })
	switch (error._tag) {
		case "CraftNotFoundError":
			return invalidCraftCredentialsError()
		case "CraftRateLimitError":
			return unavailable()
		case "CraftApiError": {
			const status = error.status
			return status !== undefined && status >= 400 && status < 500 && status !== 429
				? invalidCraftCredentialsError()
				: unavailable()
		}
	}
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

const decodeOAuthState = Schema.decodeUnknownOption(Schema.fromJsonString(OAuthState))
const decodeUriComponent = Option.liftThrowable(decodeURIComponent)

/**
 * Parse OAuth state from callback query param.
 * Supports raw JSON, single-encoded JSON, and legacy double-encoded JSON.
 */
export const parseOAuthStateParam = (rawState: string): Option.Option<typeof OAuthState.Type> =>
	Option.firstSomeOf(getOAuthStateCandidates(rawState).map((candidate) => decodeOAuthState(candidate)))

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
				cause: error,
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
					cause: error,
				}),
		),
	)

	const frontendUrl = yield* Config.String("FRONTEND_URL")
	const cookieDomain = yield* Config.String("COOKIE_DOMAIN")

	// Get org slug for redirect URL (the directory's `org_index`)
	const orgOption = yield* (yield* Directory).org(orgId).pipe(
		Effect.mapError(
			(error) =>
				new InternalServerError({
					message: "Failed to fetch organization",
					cause: error,
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
			Effect.fail(new InternalServerError({ message: "Failed to serialize response", cause: e })),
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
		const stateResult = parseOAuthStateParam(encodedState)

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

		const sessionResult = Option.flatMap(decodeUriComponent(sessionCookie), (json) =>
			Schema.decodeUnknownOption(Schema.fromJsonString(OAuthSessionState))(json),
		)

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
		const directory = yield* Directory
		const frontendUrl = yield* Config.String("FRONTEND_URL")

		yield* Effect.logInfo("GitHub update callback - looking up by installation ID", {
			event: "integration_callback_installation_lookup",
			installationId: installation_id,
		})

		// The installation's org, from the directory's `integration_index`.
		const indexed = yield* directory
			.integration("github", installation_id)
			.pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.logWarning(
						"GitHub update callback: installation lookup failed",
						Cause.fail(error),
					).pipe(Effect.as(Option.none())),
				),
			)

		if (Option.isNone(indexed)) {
			yield* Effect.logWarning("GitHub update callback for unknown installation", {
				event: "integration_callback_update_unknown",
				installationId: installation_id,
			})
			return buildRedirectWithCookieClear(frontendUrl)
		}

		const connection = indexed.value

		// The redirect below still works without the slug; don't fail the callback over it.
		const orgOption = yield* directory
			.org(connection.organizationId)
			.pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.logWarning(
						"GitHub update callback: organization lookup failed",
						Cause.fail(error),
					).pipe(Effect.as(Option.none())),
				),
			)

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

	// Save the connection, its tokens and the org's integration bot in the org's `OrgObject`.
	const organizationId = parsedState.organizationId as OrganizationId
	const userId = parsedState.userId as UserId
	const connectResult = yield* callObject(ConnectIntegrationCall, orgTarget(organizationId), {
		provider,
		userId: parsedState.level === "user" ? userId : null,
		connectedBy: userId,
		externalAccountId: accountInfo.externalAccountId,
		externalAccountName: accountInfo.externalAccountName,
		settings: null,
		metadata,
		tokens: {
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken ?? null,
			expiresAt: tokens.expiresAt ?? null,
			scope: tokens.scope ?? null,
		},
	}).pipe(Effect.result)

	if (connectResult._tag === "Failure") {
		const error = connectResult.failure
		yield* Effect.logError("OAuth connection save failed", {
			event: "integration_connect_failed",
			provider,
			error: error.message,
		})
		return redirectWithError(error._tag === "IntegrationConnectFailedError" ? error.stage : "db_error")
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
		connectionId: connectResult.success.connectionId,
		botInstalled: connectResult.success.botInstalled,
	})

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

	// Save the connection (settings carry the base URL) and the API key in the org's object.
	const connected = yield* callObject(ConnectIntegrationCall, orgTarget(orgId), {
		provider,
		userId: null,
		connectedBy: currentUser.id,
		externalAccountId: null,
		externalAccountName,
		settings: { baseUrl: validatedBaseUrl },
		metadata: null,
		tokens: { accessToken: token, refreshToken: null, expiresAt: null, scope: null },
	})

	yield* Effect.logInfo("AUDIT: Integration connected via API key", {
		event: "integration_api_key_connected",
		provider,
		organizationId: orgId,
		userId: currentUser.id,
		level: "organization",
		externalAccountName,
		connectionId: connected.connectionId,
	})

	return new ConnectApiKeyResponse({
		connected: true,
		provider,
		externalAccountName,
	})
})

const toDateTime = (value: Date | DateTime.Utc) =>
	DateTime.isDateTime(value) ? value : DateTime.fromDateUnsafe(value)

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
	const level = query.level ?? "organization"

	if (!currentUser.organizationId || currentUser.organizationId !== orgId) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "You are not authorized to access this organization",
				detail: `organizationId=${orgId}`,
			}),
		)
	}

	const connectionOption = Option.fromNullishOr(
		yield* callObject(IntegrationConnectionCall, orgTarget(orgId), {
			provider,
			userId: level === "user" ? currentUser.id : null,
		}),
	)

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
		connectedAt: connection.createdAt ? toDateTime(connection.createdAt) : null,
		lastUsedAt: connection.lastUsedAt ? toDateTime(connection.lastUsedAt) : null,
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
	const level = query.level ?? "organization"

	if (!currentUser.organizationId || currentUser.organizationId !== orgId) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "You are not authorized to access this organization",
				detail: `organizationId=${orgId}`,
			}),
		)
	}

	// Tokens, the connection and (for a user link) re-attribution, in the org's object.
	const connection = yield* callObject(DisconnectIntegrationCall, orgTarget(orgId), {
		provider,
		userId: level === "user" ? currentUser.id : null,
	})

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

const objectErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchTags({
			ObjectCallError: (error: unknown) =>
				Effect.fail(
					new InternalServerError({ message: "The organization is unavailable", cause: error }),
				),
		}),
	)

export const HttpIntegrationLive = HttpApiBuilder.group(HazelApi, "integrations", (handlers) =>
	handlers
		.handle("getOAuthUrl", ({ params, query }) =>
			handleGetOAuthUrl(params, query).pipe(
				Effect.catchTag("ConfigError", (err) =>
					Effect.fail(new InternalServerError({ message: "Missing configuration", cause: err })),
				),
			),
		)
		.handle("oauthCallback", ({ params, query }) =>
			handleOAuthCallback(params, query).pipe(
				Effect.catchTag("ConfigError", (err) =>
					Effect.fail(new InternalServerError({ message: "Missing configuration", cause: err })),
				),
			),
		)
		.handle("connectApiKey", ({ params, payload }) =>
			handleConnectApiKey(params, payload).pipe(
				objectErrors,
				Effect.catchTag("IntegrationConnectFailedError", (error) =>
					Effect.fail(
						new InternalServerError({ message: "Failed to save the connection", cause: error }),
					),
				),
			),
		)
		.handle("getConnectionStatus", ({ params, query }) =>
			handleGetConnectionStatus(params, query).pipe(objectErrors),
		)
		.handle("disconnect", ({ params, query }) => handleDisconnect(params, query).pipe(objectErrors)),
).pipe(Layer.provide(CraftApiClient.layer))
