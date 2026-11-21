import { type AgentGrantInfo, type AgentScope, CreateAgentTokenRequest } from "@hazel/domain/http"
import { AgentGrantId } from "@hazel/schema"
import { DateTime, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { catchCommon } from "../../../data/actions"
import { HazelApiClient } from "../../../rpc"
import { CopyTarget, Message } from "./message"
import { type Grant, TokenAccess } from "./model"

const toGrant = (grant: AgentGrantInfo): Grant => ({
	id: grant.id,
	kind: grant.kind,
	name: grant.name,
	scopes: grant.scopes,
	createdAtMs: DateTime.toEpochMillis(grant.createdAt),
	lastUsedAtMs: grant.lastUsedAt === null ? null : DateTime.toEpochMillis(grant.lastUsedAt),
})

export const FetchAgentGrants = Command.define("FetchAgentGrants", {
	messages: [Message.SucceededFetchGrants, Message.FailedFetchGrants],
	execute: HazelApiClient.use((client) => client.agentAccess.listAgentGrants()).pipe(
		Effect.map((response) =>
			Message.SucceededFetchGrants({ grants: response.grants.map(toGrant), mcpUrl: response.mcpUrl }),
		),
		catchCommon((reason) => Message.FailedFetchGrants({ reason })),
	),
})

export const RevokeAgentGrant = Command.define("RevokeAgentGrant", {
	args: { grantId: AgentGrantId },
	messages: [Message.SucceededRevoke, Message.FailedRevoke],
	execute: ({ grantId }) =>
		HazelApiClient.use((client) => client.agentAccess.revokeAgentGrant({ params: { grantId } })).pipe(
			Effect.as(Message.SucceededRevoke({ grantId })),
			// Already gone: the list drops it all the same.
			Effect.catchTags({
				AgentGrantNotFoundError: () => Effect.succeed(Message.SucceededRevoke({ grantId })),
			}),
			catchCommon((reason) => Message.FailedRevoke({ reason })),
		),
})

const SCOPES_OF = {
	read: ["messages:read"],
	write: ["messages:read", "messages:write"],
	read_customers: ["messages:read", "customers:read"],
} as const satisfies Record<TokenAccess, ReadonlyArray<AgentScope>>

const scopesOf = (access: TokenAccess): Array<AgentScope> => [...SCOPES_OF[access]]

export const CreateAgentToken = Command.define("CreateAgentToken", {
	args: { name: Schema.String, access: TokenAccess },
	messages: [Message.SucceededCreateToken, Message.FailedCreateToken],
	execute: ({ name, access }) =>
		HazelApiClient.use((client) =>
			client.agentAccess.createAgentToken({
				payload: new CreateAgentTokenRequest({ name, scopes: scopesOf(access) }),
			}),
		).pipe(
			Effect.map((response) =>
				Message.SucceededCreateToken({
					token: { name: response.grant.name, token: response.token },
					grant: toGrant(response.grant),
				}),
			),
			catchCommon((reason) => Message.FailedCreateToken({ reason })),
		),
})

export const CopyAgentText = Command.define("CopyAgentText", {
	args: { target: CopyTarget, text: Schema.String },
	messages: [Message.SucceededCopy, Message.FailedCopy],
	execute: ({ target, text }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededCopy({ target }),
				onFailure: () => Message.FailedCopy({ target }),
			}),
		),
})
