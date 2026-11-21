import { AgentScope } from "@hazel/domain/http"
import { AgentGrantId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

/** One agent that may act for the user, as the page lists it. */
export const Grant = Schema.Struct({
	id: AgentGrantId,
	kind: Schema.Literals(["oauth", "token"]),
	name: Schema.String,
	scopes: Schema.Array(AgentScope),
	createdAtMs: Schema.Finite,
	lastUsedAtMs: Schema.NullOr(Schema.Finite),
})
export type Grant = typeof Grant.Type

export const Grants = defineTaggedUnion({
	Loading: {},
	Loaded: { grants: Schema.Array(Grant), mcpUrl: Schema.String },
	Failed: { reason: CommonReason },
})
export type Grants = typeof Grants.Type

/** A new token's access: read only, read and write, or read only with the Customers area. */
export const TokenAccess = Schema.Literals(["read", "write", "read_customers"])
export type TokenAccess = typeof TokenAccess.Type

/** A token just created: shown once, then gone (only its hash is kept). */
export const CreatedToken = Schema.Struct({ name: Schema.String, token: Schema.String })
export type CreatedToken = typeof CreatedToken.Type

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	grants: Grants,
	tokenName: Schema.String,
	tokenAccess: TokenAccess,
	isCreating: Schema.Boolean,
	createdToken: Schema.NullOr(CreatedToken),
	/** The grant whose Revoke was pressed once and waits for confirmation. */
	confirmingRevoke: Schema.NullOr(AgentGrantId),
	revoking: Schema.NullOr(AgentGrantId),
})
export type Model = typeof Model.Type

/** The longest token name the API takes (`CreateAgentTokenRequest`). */
export const TOKEN_NAME_MAX = 80

/**
 * A token may be created with a name, and once the one on show is dismissed: its secret is
 * shown only once, so a second creation must not replace it.
 */
export const canCreateToken = (model: Model) =>
	!model.isCreating && model.createdToken === null && model.tokenName.trim().length > 0
