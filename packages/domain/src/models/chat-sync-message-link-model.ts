import {
	ChannelId,
	ExternalMessageId,
	ExternalThreadId,
	MessageId,
	SyncChannelLinkId,
	SyncMessageLinkId,
} from "@hazel/schema"
import { Schema as S } from "effect"
import { ChatSyncReceiptSource } from "./chat-sync-event-receipt-model"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("ChatSyncMessageLink")({
	id: M.Generated(SyncMessageLinkId),
	channelLinkId: SyncChannelLinkId,
	hazelMessageId: MessageId,
	externalMessageId: ExternalMessageId,
	source: ChatSyncReceiptSource,
	rootHazelMessageId: S.NullOr(MessageId),
	rootExternalMessageId: S.NullOr(ExternalMessageId),
	hazelThreadChannelId: S.NullOr(ChannelId),
	externalThreadId: S.NullOr(ExternalThreadId),
	lastSyncedAt: M.Generated(JsonDate),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
