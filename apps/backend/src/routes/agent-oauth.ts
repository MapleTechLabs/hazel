/**
 * Hazel as the OAuth 2.1 authorization server of its MCP server (`routes/mcp.ts`), the routes the
 * MCP authorization spec asks for:
 *
 * - `GET /.well-known/oauth-protected-resource[/mcp]` (RFC 9728): the resource and its server;
 * - `GET /.well-known/oauth-authorization-server` (RFC 8414): the endpoints below;
 * - `POST /oauth/register` (RFC 7591): public clients register themselves (no secret, PKCE);
 * - `GET /oauth/authorize`: sends the browser to the web app's consent page, which answers through
 *   `agentAccess.authorizeAgent` (`agent-access.http.ts`) with the code;
 * - `POST /oauth/token`: `authorization_code` (PKCE S256) and `refresh_token` grants.
 *
 * The token endpoint answers RFC 6749 errors as JSON; nothing here reads a cookie.
 */
import { Config, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { AgentClientId } from "@hazel/schema"
import { AgentAccess, isAllowedRedirectUri, OAuthProtocolError } from "../services/agent-access"
import { DEFAULT_AGENT_SCOPES } from "@hazel/domain/http"

const originOf = (url: string) => new URL(url).origin

/** The api's public origin and the web app's, as the metadata and redirects name them. */
export const agentOAuthConfig = Effect.gen(function* () {
	return {
		apiOrigin: originOf(yield* Config.String("API_BASE_URL")),
		frontendUrl: (yield* Config.String("FRONTEND_URL")).replace(/\/$/, ""),
	}
})

/** The MCP server's URL: the resource tokens are issued for. */
export const mcpResourceUrl = (apiOrigin: string) => `${apiOrigin}/mcp`

/** Where a 401 from `/mcp` points clients (`WWW-Authenticate: Bearer resource_metadata=…`). */
export const protectedResourceMetadataUrl = (apiOrigin: string) =>
	`${apiOrigin}/.well-known/oauth-protected-resource`

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" }
/** Metadata and registration are read by clients from any origin. */
const OPEN_CORS = { "Access-Control-Allow-Origin": "*" }

const oauthError = (error: string, description: string, status = 400) =>
	HttpServerResponse.jsonUnsafe(
		{ error, error_description: description },
		{ status, headers: { ...NO_STORE, ...OPEN_CORS } },
	)

const decodeClientId = Schema.decodeUnknownOption(AgentClientId)
/** A JSON token request's string fields (other values are not OAuth parameters); none if not JSON. */
const decodeJsonParams = Schema.decodeOption(
	Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
)
/** A body parsed as JSON, or none when it is not JSON. */
const parseJson = Schema.decodeOption(Schema.fromJsonString(Schema.Unknown))

const RegistrationRequest = Schema.Struct({
	client_name: Schema.optional(Schema.String),
	redirect_uris: Schema.Array(Schema.String),
	client_uri: Schema.optional(Schema.String),
	logo_uri: Schema.optional(Schema.String),
	token_endpoint_auth_method: Schema.optional(Schema.String),
	grant_types: Schema.optional(Schema.Array(Schema.String)),
	response_types: Schema.optional(Schema.Array(Schema.String)),
	scope: Schema.optional(Schema.String),
})
const decodeRegistration = Schema.decodeUnknownOption(RegistrationRequest)

/** At most this many redirect URIs per client, and this long a name (it is shown in chat). */
const MAX_REDIRECT_URIS = 10
const MAX_CLIENT_NAME = 80

const httpsOrNull = (value: string | undefined) => {
	if (value === undefined) return null
	try {
		return new URL(value).protocol === "https:" ? value : null
	} catch {
		return null
	}
}

const readBody = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	return yield* request.text.pipe(Effect.orElseSucceed(() => ""))
})

/** A form body (`application/x-www-form-urlencoded`), or JSON for lenient clients. */
const readParams = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const body = yield* readBody
	if ((request.headers["content-type"] ?? "").includes("application/json")) {
		return new Map(
			Option.match(decodeJsonParams(body), {
				onNone: () => [],
				onSome: (params) => Object.entries(params),
			}),
		)
	}
	return new Map(new URLSearchParams(body))
})

export const AgentOAuthRoutes = HttpRouter.use((router) =>
	Effect.gen(function* () {
		const access = yield* AgentAccess
		const { apiOrigin, frontendUrl } = yield* agentOAuthConfig

		const resourceMetadata = HttpServerResponse.jsonUnsafe(
			{
				resource: mcpResourceUrl(apiOrigin),
				authorization_servers: [apiOrigin],
				// The MCP server's own scopes: clients request what the resource lists (MCP authorization),
				// and Customers access is for clients that ask for it by name.
				scopes_supported: DEFAULT_AGENT_SCOPES,
				bearer_methods_supported: ["header"],
				resource_name: "Hazel",
			},
			{ headers: { ...OPEN_CORS, "Cache-Control": "public, max-age=3600" } },
		)
		yield* router.add("GET", "/.well-known/oauth-protected-resource", Effect.succeed(resourceMetadata))
		yield* router.add(
			"GET",
			"/.well-known/oauth-protected-resource/mcp",
			Effect.succeed(resourceMetadata),
		)

		yield* router.add(
			"GET",
			"/.well-known/oauth-authorization-server",
			Effect.succeed(
				HttpServerResponse.jsonUnsafe(
					{
						issuer: apiOrigin,
						authorization_endpoint: `${apiOrigin}/oauth/authorize`,
						token_endpoint: `${apiOrigin}/oauth/token`,
						registration_endpoint: `${apiOrigin}/oauth/register`,
						response_types_supported: ["code"],
						grant_types_supported: ["authorization_code", "refresh_token"],
						code_challenge_methods_supported: ["S256"],
						token_endpoint_auth_methods_supported: ["none"],
						// As the resource's: `customers:read` is for clients that ask for it by name.
						scopes_supported: DEFAULT_AGENT_SCOPES,
					},
					{ headers: { ...OPEN_CORS, "Cache-Control": "public, max-age=3600" } },
				),
			),
		)

		yield* router.add(
			"POST",
			"/oauth/register",
			Effect.gen(function* () {
				const json = parseJson(yield* readBody)
				if (Option.isNone(json)) return oauthError("invalid_client_metadata", "The body is not JSON")
				const registration = decodeRegistration(json.value)
				if (Option.isNone(registration))
					return oauthError("invalid_client_metadata", "redirect_uris is required")
				const meta = registration.value
				if (meta.redirect_uris.length === 0 || meta.redirect_uris.length > MAX_REDIRECT_URIS)
					return oauthError(
						"invalid_redirect_uri",
						`Register 1 to ${MAX_REDIRECT_URIS} redirect URIs`,
					)
				const bad = meta.redirect_uris.find((uri) => !isAllowedRedirectUri(uri))
				if (bad !== undefined)
					return oauthError("invalid_redirect_uri", `Not an allowed redirect URI: ${bad}`)
				if (
					meta.token_endpoint_auth_method !== undefined &&
					meta.token_endpoint_auth_method !== "none"
				)
					return oauthError(
						"invalid_client_metadata",
						"Only public clients (token_endpoint_auth_method=none, PKCE) are supported",
					)
				const clientName = (meta.client_name ?? "").trim().slice(0, MAX_CLIENT_NAME) || "MCP client"
				const created = yield* access.registerClient({
					clientName,
					redirectUris: meta.redirect_uris,
					clientUri: httpsOrNull(meta.client_uri),
					logoUri: httpsOrNull(meta.logo_uri),
				})
				return HttpServerResponse.jsonUnsafe(
					{
						client_id: created.id,
						client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
						client_name: clientName,
						redirect_uris: meta.redirect_uris,
						token_endpoint_auth_method: "none",
						grant_types: ["authorization_code", "refresh_token"],
						response_types: ["code"],
					},
					{ status: 201, headers: { ...NO_STORE, ...OPEN_CORS } },
				)
			}).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.logError("Agent client registration failed", { error: error.message }).pipe(
						Effect.as(oauthError("server_error", "Registration is unavailable", 503)),
					),
				),
				Effect.withSpan("AgentOAuth.register"),
			),
		)

		// The consent page lives in the web app; it checks the client and redirect URI itself
		// (`getAgentClient`), so a bad request is shown there, never redirected to.
		yield* router.add(
			"GET",
			"/oauth/authorize",
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const search = new URL(request.url, apiOrigin).search
				return HttpServerResponse.redirect(`${frontendUrl}/oauth/authorize${search}`, {
					status: 302,
					headers: { "Cache-Control": "no-store" },
				})
			}),
		)

		yield* router.add(
			"POST",
			"/oauth/token",
			Effect.gen(function* () {
				const params = yield* readParams
				const grantType = params.get("grant_type")
				const clientId = params.get("client_id") ?? ""
				if (Option.isNone(decodeClientId(clientId)))
					return oauthError("invalid_client", "client_id is missing or unknown", 401)
				const tokens =
					grantType === "authorization_code"
						? yield* access.exchangeCode({
								code: params.get("code") ?? "",
								clientId,
								redirectUri: params.get("redirect_uri") ?? "",
								codeVerifier: params.get("code_verifier") ?? "",
							})
						: grantType === "refresh_token"
							? yield* access.refresh({
									refreshToken: params.get("refresh_token") ?? "",
									clientId,
								})
							: yield* new OAuthProtocolError({
									error: "unsupported_grant_type",
									description: "Use authorization_code or refresh_token",
								})
				return HttpServerResponse.jsonUnsafe(
					{
						access_token: tokens.accessToken,
						token_type: "Bearer",
						expires_in: tokens.expiresInSeconds,
						refresh_token: tokens.refreshToken,
						scope: tokens.scopes.join(" "),
					},
					{ headers: { ...NO_STORE, ...OPEN_CORS } },
				)
			}).pipe(
				Effect.catchTags({
					OAuthProtocolError: (error) => Effect.succeed(oauthError(error.error, error.description)),
					DatabaseError: (error) =>
						Effect.logError("Agent token exchange failed", { error: error.message }).pipe(
							Effect.as(oauthError("server_error", "The token endpoint is unavailable", 503)),
						),
				}),
				Effect.withSpan("AgentOAuth.token"),
			),
		)
	}),
)
