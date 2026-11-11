/**
 * Effects an `OrgObject` receives (`infra/durable-object-sync-plan.md` §4):
 *
 * - from directory profile updates and `UserObject` presence: the `users` and
 *   `user_presence_status` projections (`../org/projections.ts`); send them to each org in the
 *   user's `membership_index`;
 * - from `ChannelObject` message writes: notification recipients and `notificationCount`
 *   (`../org/message-notifications.ts`), thread renames (`../org/channel-rename.ts`);
 * - Connect: a guest org's mount and participants (host side), the host's conversation snapshot
 *   (guest side), `../org/connect.ts`;
 * - message search: index changes from the org's channels, and from a Connect host org
 *   (`../org/message-search.ts`).
 */
import type { Database } from "@hazel/db"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { ChannelAccessSyncService } from "../../../services/channel-access-sync"
import {
	PresenceProjection,
	removeUserProjection,
	RemoveUserProjectionPayload,
	upsertPresenceProjection,
	upsertUserProjection,
	UserProjection,
} from "../org/projections"
import { channelRenameReceivers, ChannelRenameEffects } from "../org/channel-rename"
import { messageNotificationOrgReceivers, MessageNotificationOrgEffects } from "../org/message-notifications"
import { DirectoryWireOrgEffects } from "../directory-wire"
import { upsertBotProjection } from "../org/bot-installs"
import { acceptInvitation } from "../org/invitation-accept"
import { ConnectOrgEffects } from "../connect-wire"
import { connectOrgReceivers } from "../org/connect"
import { ChatSyncOrgEffects } from "../../../services/chat-sync/chat-sync-effects"
import { chatSyncOrgReceivers } from "../../../services/chat-sync/chat-sync-org"
import { messageSearchOrgReceivers } from "../org/message-search"
import { SearchOrgEffects } from "../search-wire"
import { defineEffect, type EffectReceivers } from "./registry"

export const OrgEffects = {
	/** A user's directory row changed (or the user joined): replace the org's copy. */
	upsertUserProjection: defineEffect("org.upsertUserProjection", "org", UserProjection),
	/** A user's presence changed (`UserObject` owns it). */
	upsertPresenceProjection: defineEffect("org.upsertPresenceProjection", "org", PresenceProjection),
	/** Drop a user's copy (and presence) unless they are still a member or participant here. */
	removeUserProjection: defineEffect("org.removeUserProjection", "org", RemoveUserProjectionPayload),
	...MessageNotificationOrgEffects,
	...ChannelRenameEffects,
	...DirectoryWireOrgEffects,
	/** Chat sync: gateway ingest, channel-provisioned link settings (`services/chat-sync`). */
	...ChatSyncOrgEffects,
	/** Hazel Connect (`../connect-wire.ts`). */
	...ConnectOrgEffects,
	/** Message search (`../org/message-search.ts`). */
	...SearchOrgEffects,
}

export const orgReceivers = {
	"org.upsertUserProjection": upsertUserProjection,
	"org.upsertPresenceProjection": upsertPresenceProjection,
	"org.removeUserProjection": removeUserProjection,
	...messageNotificationOrgReceivers,
	...channelRenameReceivers,
	// Called lazily: these modules import the effect registries back.
	"org.upsertBotProjection": (payload) => upsertBotProjection(payload),
	"org.acceptInvitation": (payload) =>
		acceptInvitation(payload).pipe(Effect.provide(ChannelAccessSyncService.layer)),
	"org.chatSyncIngest": (payload) => chatSyncOrgReceivers["org.chatSyncIngest"](payload),
	"org.chatSyncLinkSettings": (payload) => chatSyncOrgReceivers["org.chatSyncLinkSettings"](payload),
	"org.chatSyncLinkThread": (payload) => chatSyncOrgReceivers["org.chatSyncLinkThread"](payload),
	// Connect receivers recompute channel access, which needs the sync service.
	"org.connectMountAdded": (payload) =>
		connectOrgReceivers["org.connectMountAdded"](payload).pipe(
			Effect.provide(ChannelAccessSyncService.layer),
		),
	"org.connectSetParticipants": (payload) =>
		connectOrgReceivers["org.connectSetParticipants"](payload).pipe(
			Effect.provide(ChannelAccessSyncService.layer),
		),
	"org.connectMountRemoved": (payload) =>
		connectOrgReceivers["org.connectMountRemoved"](payload).pipe(
			Effect.provide(ChannelAccessSyncService.layer),
		),
	"org.indexMessages": (payload) => messageSearchOrgReceivers["org.indexMessages"](payload),
	"org.indexConnectMessages": (payload) => messageSearchOrgReceivers["org.indexConnectMessages"](payload),
	"org.connectConversationSnapshot": (payload) =>
		connectOrgReceivers["org.connectConversationSnapshot"](payload).pipe(
			Effect.provide(ChannelAccessSyncService.layer),
		),
} satisfies EffectReceivers<typeof OrgEffects, Database.Database | SqlClient>
