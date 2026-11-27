// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The OAuth consent page's HTTP API (`agentAccess`): `GetAgentClient` and `AuthorizeAgent` on the
 * app's `HazelApiClient`. Provided with the page in `root/native-pages.ts`.
 */
import { AuthorizeAgentRequest } from "@hazel/domain/http"
import {
	AuthorizeAgent,
	GetAgentClient,
	OAuthAuthorizeMessage,
} from "@hazel/shared-screens/auth/pages/oauth/authorize/OAuthAuthorizePage"
import { Effect, Layer } from "effect"
import { commonReasonOf } from "~/lib/error-messages"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

const getAgentClient = GetAgentClient.toLayer(
	Effect.map(
		Effect.service(HazelApiClient),
		(client) =>
			({ clientId, redirectUri }) =>
				client.agentAccess
					.getAgentClient({ params: { clientId }, query: { redirect_uri: redirectUri } })
					.pipe(
						Effect.map((agent) => ({
							id: agent.id,
							name: agent.name,
							clientUri: agent.clientUri,
							logoUri: agent.logoUri,
							redirectHost: agent.redirectHost,
						})),
						Effect.catchTags({ AgentClientInvalidError: () => Effect.fail("Invalid" as const) }),
						Effect.mapError((error) => (error === "Invalid" ? error : commonReasonOf(error))),
					),
	),
)

/** Approve or deny; either way the backend answers with the client's redirect, which the page loads. */
const authorizeAgent = AuthorizeAgent.toLayer(
	Effect.map(Effect.service(HazelApiClient), (client) => ({ request, approve }) => {
		// The payload is a `Schema.Class`: a plain object fails to encode before the request is sent.
		const payload = new AuthorizeAgentRequest({
			clientId: request.clientId,
			redirectUri: request.redirectUri,
			codeChallenge: request.codeChallenge,
			codeChallengeMethod: request.codeChallengeMethod,
			scope: request.scope ?? undefined,
			state: request.state ?? undefined,
			approve,
		})
		return client.agentAccess.authorizeAgent({ payload }).pipe(
			Effect.map(({ redirectTo }) => OAuthAuthorizeMessage.SucceededAuthorize({ redirectTo })),
			Effect.catchTags({
				AgentClientInvalidError: () =>
					Effect.succeed(OAuthAuthorizeMessage.FailedAuthorize({ reason: "Invalid" })),
			}),
			Effect.catch((error) =>
				Effect.succeed(OAuthAuthorizeMessage.FailedAuthorize({ reason: commonReasonOf(error) })),
			),
		)
	}),
)

export const AgentAccessLive = Layer.mergeAll(getAgentClient, authorizeAgent).pipe(
	Layer.provide(HazelApiClientLive),
)
