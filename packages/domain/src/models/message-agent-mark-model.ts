import { AgentGrantId, ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

/**
 * A message an agent wrote (or last edited) for its author over Hazel's MCP server; `id` is the
 * message's id. Synced only to the author's own organization.
 */
class Model extends M.Class<Model>("MessageAgentMark")({
	id: MessageId,
	channelId: ChannelId,
	organizationId: OrganizationId,
	authorId: UserId,
	grantId: AgentGrantId,
	agentName: S.String,
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
