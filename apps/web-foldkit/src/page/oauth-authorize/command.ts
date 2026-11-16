import { AuthorizeAgentRequest } from "@hazel/domain/http"
import { AgentClientId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { catchCommon } from "../../data/actions"
import { signInHref } from "../../route"
import { HazelApiClient } from "../../rpc"
import { Message } from "./message"

export const FetchAgentClient = Command.define("FetchAgentClient", {
	args: { clientId: AgentClientId, redirectUri: Schema.String },
	messages: [Message.SucceededFetchClient, Message.FoundInvalidRequest, Message.FailedFetchClient],
	execute: ({ clientId, redirectUri }) =>
		HazelApiClient.use((client) =>
			client.agentAccess.getAgentClient({ params: { clientId }, query: { redirect_uri: redirectUri } }),
		).pipe(
			Effect.map((client) =>
				Message.SucceededFetchClient({
					client: {
						id: client.id,
						name: client.name,
						clientUri: client.clientUri,
						logoUri: client.logoUri,
						redirectHost: client.redirectHost,
					},
				}),
			),
			Effect.catchTags({
				AgentClientInvalidError: () => Effect.succeed(Message.FoundInvalidRequest()),
			}),
			catchCommon((reason) => Message.FailedFetchClient({ reason })),
		),
})

/** Approve or deny; either way the backend answers with the client's redirect, which the browser loads. */
export const AuthorizeAgent = Command.define("AuthorizeAgent", {
	args: {
		clientId: AgentClientId,
		redirectUri: Schema.String,
		codeChallenge: Schema.String,
		codeChallengeMethod: Schema.String,
		scope: Schema.NullOr(Schema.String),
		state: Schema.NullOr(Schema.String),
		approve: Schema.Boolean,
	},
	messages: [Message.LeftPage, Message.FailedAuthorize],
	execute: ({ scope, state, ...request }) => {
		const fields: { -readonly [K in keyof AuthorizeAgentRequest]: AuthorizeAgentRequest[K] } = request
		if (scope !== null) fields.scope = scope
		if (state !== null) fields.state = state
		return HazelApiClient.use((client) =>
			// The payload is a `Schema.Class`: a plain object fails to encode before the request is sent.
			client.agentAccess.authorizeAgent({ payload: new AuthorizeAgentRequest(fields) }),
		).pipe(
			Effect.flatMap(({ redirectTo }) => load(redirectTo)),
			Effect.as(Message.LeftPage()),
			Effect.catchTags({
				AgentClientInvalidError: () => Effect.succeed(Message.FailedAuthorize({ reason: "Invalid" })),
			}),
			catchCommon((reason) => Message.FailedAuthorize({ reason })),
		)
	},
})

/** Sign in, then come back to this link. */
export const RedirectToAuthorizeSignIn = Command.define("RedirectToAuthorizeSignIn", {
	args: { returnTo: Schema.String },
	messages: [Message.LeftPage],
	execute: ({ returnTo }) => load(signInHref(returnTo)).pipe(Effect.as(Message.LeftPage())),
})
