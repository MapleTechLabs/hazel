import { SyncChannelLinkId, SyncConnectionId, SyncEventReceiptId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const ChatSyncReceiptSource = S.Literals(["hazel", "external"])
export type ChatSyncReceiptSource = S.Schema.Type<typeof ChatSyncReceiptSource>

export const ChatSyncReceiptStatus = S.Literals(["processed", "ignored", "failed"])
export type ChatSyncReceiptStatus = S.Schema.Type<typeof ChatSyncReceiptStatus>

class Model extends M.Class<Model>("ChatSyncEventReceipt")({
	id: M.Generated(SyncEventReceiptId),
	syncConnectionId: SyncConnectionId,
	channelLinkId: S.NullOr(SyncChannelLinkId),
	source: ChatSyncReceiptSource,
	externalEventId: S.NullOr(S.String),
	dedupeKey: S.String,
	payloadHash: S.NullOr(S.String),
	status: ChatSyncReceiptStatus,
	errorMessage: S.NullOr(S.String),
	processedAt: M.Generated(JsonDate),
	createdAt: M.Generated(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
