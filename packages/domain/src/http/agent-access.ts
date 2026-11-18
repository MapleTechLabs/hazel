/**
 * Agent access: a user lets an agent act for them through Hazel's MCP server (`POST /mcp`). Agents
 * connect with OAuth (Hazel is the authorization server; the consent page calls `authorizeAgent`)
 * or with a personal access token. Every agent is a grant the user lists and revokes here.
 *
 * Messages an agent writes are marked in chat ("via <agent>") for the author's own organization.
 *
 * The OAuth protocol endpoints themselves (`/.well-known/*`, `/oauth/register`, `/oauth/token`)
 * are raw routes in the api Worker (`routes/agent-oauth.ts`), not part of this group.
 */
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { AgentClientId, AgentGrantId } from "@hazel/schema"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * What an agent may do: read messages, or read and write them (send, reply, react, edit, delete),
 * through the MCP server; or read the Customers area of the user's organizations (`customers:read`:
 * the Customers read RPCs and the `/sync/customers` stream, e.g. the Raycast extension).
 */
export const AgentScope = Schema.Literals(["messages:read", "messages:write", "customers:read"])
export type AgentScope = typeof AgentScope.Type

/** What a client that names no scope gets: the MCP server's (never Customers unless asked). */
export const DEFAULT_AGENT_SCOPES: ReadonlyArray<AgentScope> = ["messages:read", "messages:write"]

/**
 * The scopes a stored grant, code or token holds: the known ones, never a default (a scope this
 * version does not know grants nothing, so a rollback cannot widen a grant).
 */
export const storedAgentScopes = (scopes: ReadonlyArray<string>): ReadonlyArray<AgentScope> =>
	scopes.filter((s): s is AgentScope => Schema.is(AgentScope)(s))

/** Parse a client's OAuth `scope` request; unknown scopes are dropped, none means the default ones. */
export const parseAgentScopes = (scope: string | null | undefined): ReadonlyArray<AgentScope> => {
	const requested = (scope ?? "").split(/\s+/).filter((s): s is AgentScope => Schema.is(AgentScope)(s))
	return requested.length === 0 ? DEFAULT_AGENT_SCOPES : [...new Set(requested)]
}

export class AgentClientInfo extends Schema.Class<AgentClientInfo>("AgentClientInfo")({
	id: AgentClientId,
	name: Schema.String,
	clientUri: Schema.NullOr(Schema.String),
	logoUri: Schema.NullOr(Schema.String),
	/** The redirect URI's host, shown on the consent page ("you will return to …"). */
	redirectHost: Schema.String,
}) {}

export class AgentGrantInfo extends Schema.Class<AgentGrantInfo>("AgentGrantInfo")({
	id: AgentGrantId,
	kind: Schema.Literals(["oauth", "token"]),
	name: Schema.String,
	scopes: Schema.Array(AgentScope),
	createdAt: Schema.DateTimeUtcFromString,
	lastUsedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}) {}

export class AgentGrantsResponse extends Schema.Class<AgentGrantsResponse>("AgentGrantsResponse")({
	grants: Schema.Array(AgentGrantInfo),
	/** The MCP server's URL, to paste into an agent's config. */
	mcpUrl: Schema.String,
}) {}

export class AuthorizeAgentRequest extends Schema.Class<AuthorizeAgentRequest>("AuthorizeAgentRequest")({
	clientId: AgentClientId,
	redirectUri: Schema.String,
	codeChallenge: Schema.String,
	codeChallengeMethod: Schema.String,
	scope: Schema.optional(Schema.String),
	state: Schema.optional(Schema.String),
	/** Approve, or deny (the client is sent `error=access_denied`). */
	approve: Schema.Boolean,
}) {}

export class AuthorizeAgentResponse extends Schema.Class<AuthorizeAgentResponse>("AuthorizeAgentResponse")({
	/** Where the consent page sends the browser next: the client's redirect URI with the result. */
	redirectTo: Schema.String,
}) {}

export class CreateAgentTokenRequest extends Schema.Class<CreateAgentTokenRequest>("CreateAgentTokenRequest")(
	{
		name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
		scopes: Schema.Array(AgentScope).check(Schema.isMinLength(1)),
	},
) {}

export class CreateAgentTokenResponse extends Schema.Class<CreateAgentTokenResponse>(
	"CreateAgentTokenResponse",
)({
	grant: AgentGrantInfo,
	/** Shown once; only its hash is kept. */
	token: Schema.String,
}) {}

/** The client is unknown, or the redirect URI is not one it registered; never redirected to. */
export class AgentClientInvalidError extends Schema.TaggedError<AgentClientInvalidError>()(
	"AgentClientInvalidError",
	{ message: Schema.String },
	{ httpApiStatus: 400 },
) {}

export class AgentGrantNotFoundError extends Schema.TaggedError<AgentGrantNotFoundError>()(
	"AgentGrantNotFoundError",
	{ grantId: AgentGrantId },
	{ httpApiStatus: 404 },
) {}

export class AgentAccessGroup extends HttpApiGroup.make("agentAccess")
	.add(
		HttpApiEndpoint.get("getAgentClient", `/clients/:clientId`, {
			params: { clientId: AgentClientId },
			query: { redirect_uri: Schema.String },
			success: AgentClientInfo,
			error: [AgentClientInvalidError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Agent Client",
					description:
						"The OAuth client a consent page asks about, checked against its redirect URI.",
					summary: "Get agent client",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("authorizeAgent", `/authorize`, {
			payload: AuthorizeAgentRequest,
			success: AuthorizeAgentResponse,
			error: [AgentClientInvalidError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Authorize Agent",
					description:
						"The consent page's answer: on approval issues an authorization code for the client's redirect URI.",
					summary: "Authorize agent",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.get("listAgentGrants", `/grants`, {
			success: AgentGrantsResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "List Agent Grants",
					description: "The agents (OAuth apps and personal tokens) that may act for you.",
					summary: "List agent grants",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.delete("revokeAgentGrant", `/grants/:grantId`, {
			params: { grantId: AgentGrantId },
			success: Schema.Void,
			error: [AgentGrantNotFoundError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Revoke Agent Grant",
					description: "Stop an agent acting for you; its tokens stop working at once.",
					summary: "Revoke agent grant",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("createAgentToken", `/tokens`, {
			payload: CreateAgentTokenRequest,
			success: CreateAgentTokenResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Create Personal Access Token",
					description: "A token an agent puts in its MCP config to act for you.",
					summary: "Create personal access token",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/agent-access") {}
