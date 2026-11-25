import { ChannelId, ChannelMemberId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { channelMemberCollection } from "~/db/collections"
import { orgOfChannelMember } from "~/db/routing-hints"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import type { Shared } from "../../contract"
import { Message, type Model, type PageReturn } from "./model"
import * as NewMessages from "./new-messages"
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

/**
 * The thread the panel shows, marked read as new replies show in it (Discord reads a thread you
 * have open). Best effort: a failure leaves it unread until the next reply or visit.
 */
export const ReadThread = Command.define("ReadThread", {
	args: { channelId: ChannelId },
	messages: [Message.CompletedReadThread],
	execute: ({ channelId }) =>
		HazelRpc.use((rpc) => rpc("channelMember.clearNotifications", { channelId })).pipe(
			Effect.as(Message.CompletedReadThread()),
			Effect.catchTags({ ChannelNotFoundError: () => Effect.succeed(Message.CompletedReadThread()) }),
			catchCommon(() => Message.CompletedReadThread()),
		),
})

/**
 * After the panel's messages change: while the window is focused and someone else wrote after what
 * the panel last marked read, the thread is read now.
 */
export const readOpenThread = (model: Model): PageReturn => {
	const panel = model.threadPanel
	if (panel === null || panel.creation !== "Created" || !model.notifications.isFocused) return { model }
	const newest = panel.messages.at(-1)
	if (newest === undefined || newest.createdAtMs <= panel.readUpToMs) return { model }
	const read = modifyFields(model, {
		threadPanel: () => modifyFields(panel, { readUpToMs: () => newest.createdAtMs }),
	})
	return newest.authorId === model.currentUserId
		? { model: read }
		: { model: read, commands: [ReadThread({ channelId: panel.threadChannelId })] }
}

export const WaitClearNotificationsRetry = Command.define("WaitClearNotificationsRetry", {
	args: { channelId: ChannelId, delayMs: Schema.Finite },
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

/**
 * What there is to read here: the user's unread notifications (the sidebar badge), and one more
 * while someone else's message is newer than their read position (the unread name).
 */
export const ownUnread = (model: Model) => {
	const own = model.members?.find((member) => member.userId === model.currentUserId)
	const hasNew = NewMessages.hasUnread(model.newMessages, model.currentUserId)
	return (own?.notificationCount ?? 0) + (hasNew ? 1 : 0)
}

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

/** Follow (join) or unfollow (leave) a thread; the membership stream shows the result. */
export const ToggleFollowThread = Command.define("ToggleFollowThread", {
	args: {
		threadChannelId: ChannelId,
		/** The membership to leave; null joins. */
		memberId: Schema.NullOr(ChannelMemberId),
	},
	messages: [Message.CompletedToggleFollowThread],
	execute: ({ threadChannelId, memberId }) =>
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			if (memberId === null) yield* rpc("channelMember.create", { channelId: threadChannelId })
			else
				yield* rpc("channelMember.delete", {
					id: memberId,
					organizationId: orgOfChannelMember(memberId),
				})
			return Message.CompletedToggleFollowThread({ isFollowing: memberId === null, isSuccess: true })
		}).pipe(
			Effect.catchTags({
				ChannelMemberNotFoundError: () =>
					Effect.succeed(
						Message.CompletedToggleFollowThread({
							isFollowing: memberId === null,
							isSuccess: false,
						}),
					),
				ChannelNotFoundError: () =>
					Effect.succeed(
						Message.CompletedToggleFollowThread({
							isFollowing: memberId === null,
							isSuccess: false,
						}),
					),
			}),
			catchCommon(() =>
				Message.CompletedToggleFollowThread({ isFollowing: memberId === null, isSuccess: false }),
			),
		),
})
