/**
 * Agent access for the signed-in user (`@hazel/domain/http` `AgentAccessGroup`): the OAuth consent
 * page's lookups and answer, and the settings page's grants and personal tokens. The OAuth protocol
 * endpoints are raw routes (`./agent-oauth.ts`).
 */
import { HttpApiBuilder } from "effect/http-api"
import { CurrentUser, InternalServerError } from "@hazel/domain"
import {
	AgentClientInfo,
	AgentClientInvalidError,
	AgentGrantInfo,
	AgentGrantNotFoundError,
	AgentGrantsResponse,
	AuthorizeAgentResponse,
	CreateAgentTokenResponse,
	parseAgentScopes,
	storedAgentScopes,
} from "@hazel/domain/http"
import type { schema } from "@hazel/db"
import { DateTime, Effect, Option } from "effect"
import { HazelApi } from "../api"
import { AgentAccess } from "../services/agent-access"
import { agentOAuthConfig, mcpResourceUrl } from "./agent-oauth"

const internal = (message: string) => (cause: unknown) =>
	Effect.logError(message, { cause }).pipe(
		Effect.andThen(Effect.fail(new InternalServerError({ message }))),
	)

const toGrantInfo = (grant: schema.AgentGrant) =>
	new AgentGrantInfo({
		id: grant.id,
		kind: grant.kind,
		name: grant.name,
		scopes: storedAgentScopes(grant.scopes),
		createdAt: DateTime.fromDateUnsafe(grant.createdAt),
		lastUsedAt: grant.lastUsedAt === null ? null : DateTime.fromDateUnsafe(grant.lastUsedAt),
	})

const invalidClient = () =>
	new AgentClientInvalidError({ message: "This sign-in link is invalid or its app is unknown" })

/** Appends `params` to a redirect URI, keeping its own query. */
const withParams = (uri: string, params: Record<string, string | undefined>) => {
	const url = new URL(uri)
	for (const [key, value] of Object.entries(params))
		if (value !== undefined) url.searchParams.set(key, value)
	return url.toString()
}

export const HttpAgentAccessLive = HttpApiBuilder.group(HazelApi, "agentAccess", (handlers) =>
	Effect.gen(function* () {
		const access = yield* AgentAccess
		const { apiOrigin } = yield* agentOAuthConfig.pipe(Effect.orDie)

		return handlers
			.handle("getAgentClient", ({ params, query }) =>
				Effect.gen(function* () {
					const client = yield* access.clientFor(params.clientId, query.redirect_uri)
					if (Option.isNone(client)) return yield* invalidClient()
					return new AgentClientInfo({
						id: client.value.id,
						name: client.value.clientName,
						clientUri: client.value.clientUri,
						logoUri: client.value.logoUri,
						redirectHost: new URL(query.redirect_uri).host || query.redirect_uri,
					})
				}).pipe(Effect.catchTag("DatabaseError", internal("Could not load the agent client"))),
			)
			.handle("authorizeAgent", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const client = yield* access.clientFor(payload.clientId, payload.redirectUri)
					if (Option.isNone(client)) return yield* invalidClient()
					// From here the client's redirect URI is trusted: errors go back to it (RFC 6749 §4.1.2.1).
					const back = (params: Record<string, string | undefined>) =>
						new AuthorizeAgentResponse({
							redirectTo: withParams(payload.redirectUri, {
								...params,
								state: payload.state,
								iss: apiOrigin,
							}),
						})
					if (!payload.approve) return back({ error: "access_denied" })
					if (payload.codeChallengeMethod !== "S256" || payload.codeChallenge.length < 43)
						return back({
							error: "invalid_request",
							error_description: "PKCE with S256 is required",
						})
					const code = yield* access.createCode({
						clientId: client.value.id,
						userId: user.id,
						redirectUri: payload.redirectUri,
						codeChallenge: payload.codeChallenge,
						scopes: parseAgentScopes(payload.scope),
					})
					yield* Effect.annotateCurrentSpan({ "agent.client_id": client.value.id })
					return back({ code })
				}).pipe(Effect.catchTag("DatabaseError", internal("Could not authorize the agent"))),
			)
			.handle("listAgentGrants", () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const grants = yield* access.listGrants(user.id)
					return new AgentGrantsResponse({
						grants: grants.map(toGrantInfo),
						mcpUrl: mcpResourceUrl(apiOrigin),
					})
				}).pipe(Effect.catchTag("DatabaseError", internal("Could not list agent grants"))),
			)
			.handle("revokeAgentGrant", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const revoked = yield* access.revokeGrant(user.id, params.grantId)
					if (!revoked) return yield* new AgentGrantNotFoundError({ grantId: params.grantId })
				}).pipe(Effect.catchTag("DatabaseError", internal("Could not revoke the agent grant"))),
			)
			.handle("createAgentToken", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const created = yield* access.createPersonalToken({
						userId: user.id,
						name: payload.name.trim(),
						scopes: payload.scopes,
					})
					return new CreateAgentTokenResponse({
						grant: toGrantInfo(created.grant),
						token: created.token,
					})
				}).pipe(Effect.catchTag("DatabaseError", internal("Could not create the token"))),
			)
	}),
)
