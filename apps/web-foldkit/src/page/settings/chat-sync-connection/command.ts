import {
	ChannelId,
	ExternalChannelId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
} from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Render } from "foldkit"
import * as Dom from "foldkit/dom"
import { orgOfChatSyncChannelLink, orgOfChatSyncConnection } from "~/db/routing-hints"
import { HazelRpc } from "../../../rpc"
import { catchCommon } from "../../../data/actions"
import { fetchDiscordGuildChannels } from "../chat-sync/discord"
import { fetchConnections } from "../chat-sync/rpc"
import {
	CHANNEL_SEARCH_ID,
	type ChannelLink,
	DIRECTION_LABELS,
	Message,
	SyncDirection,
	WebhookPermission,
} from "./model"

export const ListChatSyncConnectionsForConnection = Command.define("ListChatSyncConnectionsForConnection", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededListConnections, Message.FailedListConnections],
	execute: ({ organizationId }) =>
		fetchConnections(organizationId).pipe(
			Effect.map((connections) => Message.SucceededListConnections({ organizationId, connections })),
			catchCommon((reason) => Message.FailedListConnections({ organizationId, reason })),
		),
})

/** `AddChannelLinkModal`'s channel query for the connection's guild. */
export const ListDiscordChannels = Command.define("ListDiscordChannels", {
	args: { organizationId: OrganizationId, guildId: Schema.String },
	messages: [Message.SucceededListDiscordChannels, Message.FailedListDiscordChannels],
	execute: ({ organizationId, guildId }) =>
		fetchDiscordGuildChannels(organizationId, guildId).pipe(
			Effect.map((channels) => Message.SucceededListDiscordChannels({ guildId, channels })),
			Effect.catchTags({
				IntegrationNotConnectedForPreviewError: () =>
					Effect.succeed(Message.FailedListDiscordChannels({ guildId, reason: "NotConnected" })),
				IntegrationResourceError: () =>
					Effect.succeed(Message.FailedListDiscordChannels({ guildId, reason: "ProviderError" })),
			}),
			catchCommon((reason) => Message.FailedListDiscordChannels({ guildId, reason })),
		),
})

const isDirection = Schema.is(SyncDirection)
const isPermission = Schema.is(WebhookPermission)

/** `getWebhookPermissionFromSettings` */
const webhookPermissionOf = (settings: unknown): WebhookPermission => {
	if (typeof settings !== "object" || settings === null || !("webhookPermission" in settings))
		return "unknown"
	const raw = settings.webhookPermission
	if (typeof raw !== "object" || raw === null || !("status" in raw)) return "unknown"
	return isPermission(raw.status) && raw.status !== "unknown" ? raw.status : "unknown"
}

export const ListChannelLinks = Command.define("ListChannelLinks", {
	args: { syncConnectionId: SyncConnectionId, version: Schema.Number },
	messages: [Message.SucceededListChannelLinks, Message.FailedListChannelLinks],
	execute: ({ syncConnectionId, version }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const response = yield* client("chatSync.channelLink.list", {
				syncConnectionId,
				organizationId: orgOfChatSyncConnection(syncConnectionId),
			})
			const links = response.data.map(
				(link): ChannelLink => ({
					id: link.id,
					hazelChannelId: link.hazelChannelId,
					externalName: link.externalChannelName || link.externalChannelId,
					direction: isDirection(link.direction) ? link.direction : "both",
					isActive: link.isActive,
					webhookPermission: webhookPermissionOf(link.settings),
				}),
			)
			return Message.SucceededListChannelLinks({ version, links })
		}).pipe(
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(Message.FailedListChannelLinks({ version, reason: "ConnectionNotFound" })),
			}),
			catchCommon((reason) => Message.FailedListChannelLinks({ version, reason })),
		),
})

export const DisconnectConnection = Command.define("DisconnectConnection", {
	args: { syncConnectionId: SyncConnectionId },
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: ({ syncConnectionId }) =>
		HazelRpc.use((rpc) =>
			rpc("chatSync.connection.delete", {
				syncConnectionId,
				organizationId: orgOfChatSyncConnection(syncConnectionId),
			}),
		).pipe(
			Effect.as(Message.SucceededDisconnect()),
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(Message.FailedDisconnect({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedDisconnect({ reason })),
		),
})

export const RemoveChannelLink = Command.define("RemoveChannelLink", {
	args: { syncChannelLinkId: SyncChannelLinkId },
	messages: [Message.SucceededRemoveLink, Message.FailedRemoveLink],
	execute: ({ syncChannelLinkId }) =>
		HazelRpc.use((rpc) =>
			rpc("chatSync.channelLink.delete", {
				syncChannelLinkId,
				organizationId: orgOfChatSyncChannelLink(syncChannelLinkId),
			}),
		).pipe(
			Effect.as(Message.SucceededRemoveLink()),
			Effect.catchTags({
				ChatSyncChannelLinkNotFoundError: () =>
					Effect.succeed(Message.FailedRemoveLink({ reason: "LinkNotFound" })),
			}),
			catchCommon((reason) => Message.FailedRemoveLink({ reason })),
		),
})

/** `handleToggleLinkActive` and `handleChangeDirection` (`chatSync.channelLink.update`). */
export const UpdateChannelLink = Command.define("UpdateChannelLink", {
	args: {
		syncChannelLinkId: SyncChannelLinkId,
		isActive: Schema.optional(Schema.Boolean),
		direction: Schema.optional(SyncDirection),
	},
	messages: [Message.SucceededUpdateLink, Message.FailedUpdateLink],
	execute: ({ syncChannelLinkId, isActive, direction }) => {
		const successMessage =
			direction === undefined
				? isActive
					? "Channel link resumed"
					: "Channel link paused"
				: `Sync direction updated to ${DIRECTION_LABELS[direction]}`
		const organizationId = orgOfChatSyncChannelLink(syncChannelLinkId)
		return HazelRpc.use((rpc) =>
			rpc(
				"chatSync.channelLink.update",
				direction === undefined
					? { syncChannelLinkId, organizationId, isActive }
					: { syncChannelLinkId, organizationId, direction },
			),
		).pipe(
			Effect.as(Message.SucceededUpdateLink({ linkId: syncChannelLinkId, successMessage })),
			Effect.catchTags({
				ChatSyncChannelLinkNotFoundError: () =>
					Effect.succeed(
						Message.FailedUpdateLink({ linkId: syncChannelLinkId, reason: "LinkNotFound" }),
					),
			}),
			catchCommon((reason) => Message.FailedUpdateLink({ linkId: syncChannelLinkId, reason })),
		)
	},
})

/** `AddChannelLinkModal.handleSubmit` (`chatSync.channelLink.create`). */
export const CreateChannelLink = Command.define("CreateChannelLink", {
	args: {
		syncConnectionId: SyncConnectionId,
		hazelChannelId: ChannelId,
		hazelChannelName: Schema.String,
		externalChannelId: ExternalChannelId,
		externalChannelName: Schema.String,
		direction: SyncDirection,
	},
	messages: [Message.SucceededCreateLink, Message.FailedCreateLink],
	execute: ({ hazelChannelName, ...payload }) =>
		Effect.gen(function* () {
			// React paints the pending button on the click, before any reply; wait for that commit.
			yield* Render.afterCommit
			const client = yield* HazelRpc
			yield* client("chatSync.channelLink.create", {
				...payload,
				organizationId: orgOfChatSyncConnection(payload.syncConnectionId),
			})
			return Message.SucceededCreateLink({
				successMessage: `Linked #${hazelChannelName} to #${payload.externalChannelName}`,
			})
		}).pipe(
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(Message.FailedCreateLink({ reason: "ConnectionNotFound" })),
				ChatSyncChannelLinkExistsError: () =>
					Effect.succeed(Message.FailedCreateLink({ reason: "AlreadyLinked" })),
				// The picker lists only this org's channels; another org's id is refused.
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedCreateLink({ reason: "Unexpected" })),
			}),
			catchCommon((reason) => Message.FailedCreateLink({ reason })),
		),
})

/** The Hazel channel search's `autoFocus`, once it is rendered. */
export const FocusChannelSearch = Command.define("FocusChannelSearch", {
	messages: [Message.CompletedFocusChannelSearch],
	execute: Dom.focus(`#${CHANNEL_SEARCH_ID}`).pipe(
		Effect.ignoreCause,
		Effect.as(Message.CompletedFocusChannelSearch()),
	),
})
