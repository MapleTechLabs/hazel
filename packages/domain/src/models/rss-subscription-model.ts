import { ChannelId, OrganizationId, RssSubscriptionId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("RssSubscription")({
	id: M.Generated(RssSubscriptionId),
	channelId: ChannelId,
	organizationId: OrganizationId,
	feedUrl: S.String,
	feedTitle: S.NullOr(S.String),
	feedIconUrl: S.NullOr(S.String),
	lastFetchedAt: M.Generated(S.NullOr(JsonDate)),
	lastItemPublishedAt: M.Generated(S.NullOr(JsonDate)),
	lastItemGuid: M.Generated(S.NullOr(S.String)),
	consecutiveErrors: M.Generated(S.Number),
	lastErrorMessage: M.Generated(S.NullOr(S.String)),
	lastErrorAt: M.Generated(S.NullOr(JsonDate)),
	isEnabled: S.Boolean,
	pollingIntervalMinutes: S.Number,
	createdBy: UserId,
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
