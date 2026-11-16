import { AgentScope } from "@hazel/domain/http"
import { AgentClientId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

/** What the consent page shows about the client asking for access. */
export const ClientSummary = Schema.Struct({
	id: AgentClientId,
	name: Schema.String,
	clientUri: Schema.NullOr(Schema.String),
	logoUri: Schema.NullOr(Schema.String),
	redirectHost: Schema.String,
})
export type ClientSummary = typeof ClientSummary.Type

/** The link's OAuth parameters, once they check out (authorization code with S256 PKCE). */
export const Request = Schema.Struct({
	clientId: AgentClientId,
	redirectUri: Schema.String,
	codeChallenge: Schema.String,
	codeChallengeMethod: Schema.String,
	scope: Schema.NullOr(Schema.String),
	state: Schema.NullOr(Schema.String),
	scopes: Schema.Array(AgentScope),
})
export type Request = typeof Request.Type

/**
 * `agentAccess.getAgentClient`. `Invalid` is a link that cannot be honoured: parameters missing, an
 * unknown client, or a redirect it never registered. It never sends the browser anywhere.
 */
export const Lookup = defineTaggedUnion({
	Loading: {},
	Loaded: { client: ClientSummary },
	Invalid: {},
	Failed: { reason: CommonReason },
})
export type Lookup = typeof Lookup.Type

export const ApproveFailure = Schema.Union([Schema.Literal("Invalid"), CommonReason])
export type ApproveFailure = typeof ApproveFailure.Type

/** Approving (or denying) stays in flight until the browser leaves for the client's redirect. */
export const Approval = defineTaggedUnion({
	Idle: {},
	Approving: {},
	Denying: {},
	Leaving: {},
	Failed: { reason: ApproveFailure },
})
export type Approval = typeof Approval.Type

export const Model = Schema.Struct({
	/** This link, to come back to after signing in. */
	returnTo: Schema.String,
	request: Schema.NullOr(Request),
	lookup: Lookup,
	approval: Approval,
})
export type Model = typeof Model.Type
