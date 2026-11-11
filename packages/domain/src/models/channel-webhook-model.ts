import { ChannelId, ChannelWebhookId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { baseFields, JsonDate } from "./utils"

class Model extends M.Class<Model>("ChannelWebhook")({
	id: M.Generated(ChannelWebhookId),
	channelId: ChannelId,
	organizationId: OrganizationId,
	botUserId: UserId,
	name: S.String,
	description: S.NullOr(S.String),
	avatarUrl: S.NullOr(S.String),
	tokenHash: M.Sensitive(S.String),
	tokenSuffix: S.String,
	isEnabled: S.Boolean,
	createdBy: UserId,
	lastUsedAt: S.NullOr(JsonDate),
	...baseFields,
}) {}

export const { Row, Insert, Update, Schema, Create, Patch } = M.exposeWithRow(Model)
export type Type = typeof Schema.Type
