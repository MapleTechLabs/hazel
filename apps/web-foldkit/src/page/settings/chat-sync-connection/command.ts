import { OrganizationId, SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { type Cause, Effect, Exit, Schema } from "effect"
import { Command } from "foldkit"
import { HazelRpc } from "../../../rpc"
import { failureToast } from "../../../ui/toast-exit"
import { fetchDiscordGuildChannels } from "../chat-sync/discord"
import { fetchConnections } from "../chat-sync/rpc"
import { type ChannelLink, DIRECTION_LABELS, Message, SyncDirection, WebhookPermission } from "./model"

const linkNotFound = {
	ChatSyncChannelLinkNotFoundError: {
		title: "Link not found",
		description: "This channel link may have already been removed.",
		isRetryable: false,
	},
}

const toastFields = (cause: Cause.Cause<unknown>, handlers: Parameters<typeof failureToast>[1]) => {
	const toast = failureToast(cause, handlers)
	return { title: toast.title, description: toast.description }
}

export const ListConnections = Command.define("ListConnections", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededListConnections, Message.FailedListConnections],
	execute: ({ organizationId }) =>
		fetchConnections(organizationId).pipe(
			Effect.map((connections) => Message.SucceededListConnections({ organizationId, connections })),
			Effect.catch(() => Effect.succeed(Message.FailedListConnections({ organizationId }))),
		),
})

/** `AddChannelLinkModal`'s channel query for the connection's guild. */
export const ListDiscordChannels = Command.define("ListDiscordChannels", {
	args: { organizationId: OrganizationId, guildId: Schema.String },
	messages: [Message.SucceededListDiscordChannels, Message.FailedListDiscordChannels],
	execute: ({ organizationId, guildId }) =>
		fetchDiscordGuildChannels(organizationId, guildId).pipe(
			Effect.map((channels) => Message.SucceededListDiscordChannels({ channels })),
			Effect.catch(() => Effect.succeed(Message.FailedListDiscordChannels())),
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
	args: { syncConnectionId: SyncConnectionId },
	messages: [Message.SucceededListChannelLinks, Message.FailedListChannelLinks],
	execute: ({ syncConnectionId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const response = yield* client("chatSync.channelLink.list", { syncConnectionId })
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
			return Message.SucceededListChannelLinks({ links })
		}).pipe(Effect.catch(() => Effect.succeed(Message.FailedListChannelLinks()))),
})

export const DisconnectConnection = Command.define("DisconnectConnection", {
	args: { syncConnectionId: SyncConnectionId },
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: ({ syncConnectionId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("chatSync.connection.delete", { syncConnectionId }))
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededDisconnect(),
				onFailure: (cause) =>
					Message.FailedDisconnect(
						toastFields(cause, {
							ChatSyncConnectionNotFoundError: {
								title: "Connection not found",
								description: "This connection may have already been deleted.",
								isRetryable: false,
							},
						}),
					),
			})
		}),
})

export const RemoveChannelLink = Command.define("RemoveChannelLink", {
	args: { syncChannelLinkId: SyncChannelLinkId },
	messages: [Message.SucceededRemoveLink, Message.FailedRemoveLink],
	execute: ({ syncChannelLinkId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("chatSync.channelLink.delete", { syncChannelLinkId }))
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededRemoveLink(),
				onFailure: (cause) => Message.FailedRemoveLink(toastFields(cause, linkNotFound)),
			})
		}),
})

/** `handleToggleLinkActive` and `handleChangeDirection` (`chatSync.channelLink.update`). */
export const UpdateChannelLink = Command.define("UpdateChannelLink", {
	args: {
		syncChannelLinkId: SyncChannelLinkId,
		isActive: Schema.optional(Schema.Boolean),
		direction: Schema.optional(SyncDirection),
	},
	messages: [Message.SucceededUpdateLink, Message.FailedLinkAction],
	execute: ({ syncChannelLinkId, isActive, direction }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(
				client(
					"chatSync.channelLink.update",
					direction === undefined
						? { syncChannelLinkId, isActive }
						: { syncChannelLinkId, direction },
				),
			)
			const successMessage =
				direction === undefined
					? isActive
						? "Channel link resumed"
						: "Channel link paused"
					: `Sync direction updated to ${DIRECTION_LABELS[direction]}`
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededUpdateLink({ successMessage }),
				onFailure: (cause) => Message.FailedLinkAction(toastFields(cause, linkNotFound)),
			})
		}),
})

/** Lets the success toast reach the root before the page navigates away. */
export const ScheduleReturnToList = Command.define("ScheduleReturnToList", {
	messages: [Message.ReachedReturnToList],
	execute: Effect.succeed(Message.ReachedReturnToList()),
})
