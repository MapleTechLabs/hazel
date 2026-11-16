/**
 * Agent access: a user lets an agent act for them over Hazel's MCP server (`POST /mcp`), either by
 * signing in an OAuth client (Hazel is the authorization server) or with a personal access token.
 * Every token belongs to a grant the user can see and revoke. Only token and code hashes are kept.
 *
 * The directory tables (`agent_clients`, `agent_grants`, `agent_tokens`, `agent_auth_codes`) are
 * never synced; `message_agent_marks` (channel store) is, to the author's own organization.
 */
import { AgentClientId, AgentGrantId, ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

/** An OAuth client that registered itself (RFC 7591). Public clients only: PKCE, no secret. */
export const agentClientsTable = SQLite.table("agent_clients", {
	columns: {
		id: SQLite.column(uuid(AgentClientId), { defaultExpr: randomUuid }),
		clientName: SQLite.text,
		redirectUris: jsonb<string[]>(),
		clientUri: SQLite.nullable(SQLite.text),
		logoUri: SQLite.nullable(SQLite.text),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
})
export type AgentClient = SQLite.SelectRowOf<typeof agentClientsTable>

export const agentGrantKindEnum = textEnum(["oauth", "token"])

/**
 * One agent a user let act for them: an approved OAuth client (`kind = "oauth"`) or a personal
 * access token (`kind = "token"`). Revoking it ends every token it issued.
 */
export const agentGrantsTable = SQLite.table("agent_grants", {
	columns: {
		id: SQLite.column(uuid(AgentGrantId), { defaultExpr: randomUuid }),
		userId: uuid(UserId),
		kind: agentGrantKindEnum,
		clientId: SQLite.nullable(uuid(AgentClientId)),
		/** What the user and chat see: the client's name, or the token's label. */
		name: SQLite.text,
		scopes: jsonb<string[]>(),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lastUsedAt: SQLite.nullable(timestamptz),
		revokedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("agent_grants_user_idx", ["userId"])],
})
export type AgentGrant = SQLite.SelectRowOf<typeof agentGrantsTable>

export const agentTokenKindEnum = textEnum(["access", "refresh", "personal"])

/** A bearer credential of a grant, by its SHA-256 hex. `expiresAt` null: until revoked. */
export const agentTokensTable = SQLite.table("agent_tokens", {
	columns: {
		tokenHash: varchar(64),
		grantId: uuid(AgentGrantId),
		kind: agentTokenKindEnum,
		expiresAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["tokenHash"],
	indexes: [SQLite.index("agent_tokens_grant_idx", ["grantId"])],
})
export type AgentToken = SQLite.SelectRowOf<typeof agentTokensTable>

/** An authorization code (the consent page's approval), redeemed once at `POST /oauth/token`. */
export const agentAuthCodesTable = SQLite.table("agent_auth_codes", {
	columns: {
		codeHash: varchar(64),
		clientId: uuid(AgentClientId),
		userId: uuid(UserId),
		redirectUri: SQLite.text,
		codeChallenge: SQLite.text,
		scopes: jsonb<string[]>(),
		expiresAt: timestamptz,
		redeemedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["codeHash"],
})
export type AgentAuthCode = SQLite.SelectRowOf<typeof agentAuthCodesTable>

/**
 * A message an agent wrote (or last edited) for its author, keyed by the message's id. Written in
 * the same transaction as the message by `message.create` / `message.update` when the call came
 * through the MCP server. Synced only to viewers in `organizationId` (the author's organization):
 * Connect viewers from other organizations, and chat-sync copies, never see it.
 */
export const messageAgentMarksTable = SQLite.table("message_agent_marks", {
	columns: {
		id: uuid(MessageId),
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		authorId: uuid(UserId),
		grantId: uuid(AgentGrantId),
		agentName: SQLite.text,
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("message_agent_marks_channel_idx", ["channelId"])],
})
export type MessageAgentMark = SQLite.SelectRowOf<typeof messageAgentMarksTable>
