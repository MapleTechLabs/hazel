import { ChannelId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { channelMemberCollection } from "~/db/collections"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import type { Shared } from "../../contract"
import { Message, type Model, type PageReturn } from "./model"
import * as NotificationClear from "./notification-clear"

/** The channel page's side of `NotificationClear`: its inputs from the page, its effects as commands. */

/**
 * Clears the channel's notifications and resolves once the write has synced back, so the member
 * row (and the badge the machine reads) already reflects the clear when the result arrives. A sync
 * that does not arrive in time still counts as cleared: the server took the write.
 */
export const ClearChannelNotifications = Command.define("ClearChannelNotifications", {
	args: { channelId: ChannelId },
	messages: [Message.SucceededClearNotifications, Message.FailedClearNotifications],
	execute: ({ channelId }) =>
		HazelRpc.use((rpc) => rpc("channelMember.clearNotifications", { channelId })).pipe(
			Effect.tap(({ transactionId }) =>
				channelMemberCollection.utils.awaitSeqEffect(transactionId).pipe(
					Effect.catchTags({
						TxIdTimeoutError: () => Effect.void,
						InvalidTxIdError: () => Effect.void,
						AwaitTxIdError: () => Effect.void,
					}),
				),
			),
			Effect.as(Message.SucceededClearNotifications({ channelId })),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(
						Message.FailedClearNotifications({ channelId, reason: "ChannelNotFound" }),
					),
			}),
			catchCommon((reason) => Message.FailedClearNotifications({ channelId, reason })),
		),
})

export const WaitClearNotificationsRetry = Command.define("WaitClearNotificationsRetry", {
	args: { channelId: ChannelId, delayMs: Schema.Number },
	messages: [Message.ElapsedClearNotificationsRetry],
	execute: ({ channelId, delayMs }) =>
		Effect.sleep(Duration.millis(delayMs)).pipe(
			Effect.as(Message.ElapsedClearNotificationsRetry({ channelId })),
		),
})

/** The route content mounts inside the signed-in, loaded org layout (`_app` and `$orgSlug` gates). */
export const isReady = (shared: Shared | null) =>
	shared !== null &&
	shared.auth === "SignedIn" &&
	shared.currentUser !== null &&
	shared.organization !== null

/** The signed-in user's unread notifications in this channel, as the sidebar badge shows them. */
export const ownUnread = (model: Model) =>
	model.members?.find((member) => member.userId === model.currentUserId)?.notificationCount ?? 0

const commandOf = (channelId: ChannelId, effect: NotificationClear.Effect) =>
	effect._tag === "Send"
		? ClearChannelNotifications({ channelId })
		: WaitClearNotificationsRetry({ channelId, delayMs: effect.delayMs })

/** Feeds one event to the machine and turns its effect into a command. */
export const stepNotifications = (model: Model, event: NotificationClear.Event): PageReturn => {
	const next = NotificationClear.transition(model.notifications, event)
	return {
		model:
			next.model === model.notifications
				? model
				: modifyFields(model, { notifications: () => next.model }),
		commands: next.effect === null ? [] : [commandOf(model.channelId, next.effect)],
	}
}

/** The shared readiness (page init, route and shared changes). */
export const syncReady = (model: Model, shared: Shared | null): PageReturn =>
	stepNotifications(model, { _tag: "ChangedReady", isReady: isReady(shared) })

/** The badge, read from the member rows the page holds (after every `UpdatedMembers`). */
export const syncUnread = (model: Model): PageReturn =>
	stepNotifications(model, { _tag: "ChangedUnread", unread: ownUnread(model) })
