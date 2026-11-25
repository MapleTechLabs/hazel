import { ChannelMemberId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { CommonReason, commonMessage } from "~/lib/error-messages"
import { isMutedNow, levelLabelOf, muteStatusOf, type NotificationLevel } from "~/lib/notification-settings"
import {
	choiceOfKey,
	itemContent,
	levelEntry,
	muteEntry,
	NotificationChoice,
	writeChoice,
} from "../../chat/notification-menu"
import { catchCommon, errorToast, errorToastOf, successToast } from "../../data/actions"
import type { ToastRequest } from "../../overlay/toasts"
import { IconBell, IconBellSlash } from "../../icons"
import { HazelRpc } from "../../rpc"
import { orgOfChannelMember } from "~/db/routing-hints"
import { iconButton } from "../../ui/button"
import * as Menu from "../../ui/menu"
import { menuLabel, view as menuView } from "../../ui/menu-view"

/**
 * The channel header's bell (Discord's): mute the channel for a while, or choose what it notifies
 * of. The same items as the sidebar row's menu (`chat/notification-menu.ts`).
 */

export const Model = Schema.Struct({ menu: Menu.Model })
export type Model = typeof Model.Type

export const init = (channelId: string): Model => ({
	menu: Menu.init({ id: `channel-notifications-${channelId}`, placement: "bottom end" }),
})

export const Failure = Schema.Union([Schema.Literal("MemberNotFound"), CommonReason])
export type Failure = typeof Failure.Type

export const Message = defineMessageUnion({
	GotMenuMessage: { message: Menu.Message },
	SucceededUnfollow: {},
	SucceededChoice: { choice: NotificationChoice },
	FailedChoice: { reason: Failure },
})
export type Message = typeof Message.Type

/** The signed-in user's settings in the channel, as the header reads them. */
export interface Member {
	readonly id: ChannelMemberId
	readonly isMuted: boolean
	readonly mutedUntilMs: number | null
	readonly notificationLevel: NotificationLevel | null
}

const ApplyChannelNotificationChoice = Command.define("ApplyChannelNotificationChoice", {
	args: { memberId: ChannelMemberId, choice: NotificationChoice },
	messages: [Message.SucceededChoice, Message.FailedChoice],
	execute: ({ memberId, choice }) =>
		writeChoice(memberId, choice).pipe(
			Effect.as(Message.SucceededChoice({ choice })),
			Effect.catchTags({
				ChannelMemberNotFoundError: () =>
					Effect.succeed(Message.FailedChoice({ reason: "MemberNotFound" })),
			}),
			catchCommon((reason) => Message.FailedChoice({ reason })),
		),
})

/** "Unfollow thread": leave it; its replies stop notifying until the user writes or is mentioned. */
const UnfollowThread = Command.define("UnfollowThread", {
	args: { memberId: ChannelMemberId },
	messages: [Message.SucceededUnfollow, Message.FailedChoice],
	execute: ({ memberId }) =>
		HazelRpc.use((rpc) =>
			rpc("channelMember.delete", { id: memberId, organizationId: orgOfChannelMember(memberId) }),
		).pipe(
			Effect.as(Message.SucceededUnfollow()),
			Effect.catchTags({
				ChannelMemberNotFoundError: () =>
					Effect.succeed(Message.FailedChoice({ reason: "MemberNotFound" })),
			}),
			catchCommon((reason) => Message.FailedChoice({ reason })),
		),
})

const choiceToast = (choice: NotificationChoice): string =>
	choice._tag === "Mute"
		? "Channel muted"
		: choice._tag === "Unmute"
			? "Channel unmuted"
			: "Notification settings updated"

export interface Return {
	readonly model: Model
	readonly commands?: ReadonlyArray<Command.Command<Message, never, HazelRpc>>
	readonly toast?: ToastRequest
}

export const update = (model: Model, message: Message, member: Member | null): Return =>
	Message.match<Return>(message, {
		GotMenuMessage: ({ message: menuMessage }) => {
			const result = Menu.update(model.menu, menuMessage)
			const next = modifyFields(model, { menu: () => result.model })
			const commands = Command.mapMessages(result.commands ?? [], (inner) =>
				Message.GotMenuMessage({ message: inner }),
			)
			const key = result.outMessage?._tag === "SelectedItem" ? result.outMessage.key : null
			if (key === null || member === null) return { model: next, commands }
			if (key === "unfollow")
				return { model: next, commands: [...commands, UnfollowThread({ memberId: member.id })] }
			return Option.match(choiceOfKey(key, member.isMuted || member.mutedUntilMs !== null), {
				onNone: () => ({ model: next, commands }),
				onSome: (choice) => ({
					model: next,
					commands: [...commands, ApplyChannelNotificationChoice({ memberId: member.id, choice })],
				}),
			})
		},
		SucceededChoice: ({ choice }) => ({ model, toast: successToast(choiceToast(choice)) }),
		SucceededUnfollow: () => ({ model, toast: successToast("Unfollowed thread") }),
		FailedChoice: ({ reason }) => ({
			model,
			toast:
				reason === "MemberNotFound"
					? errorToast("Couldn't update notifications", "You are no longer in this channel.")
					: errorToastOf(commonMessage(reason)),
		}),
	})

const isDmType = (channelType: string) => channelType === "single" || channelType === "direct"

/**
 * The bell's name: "Notification settings", then the level when the member chose one (a DM has
 * none), then the mute while it is in force: "Notification settings: Nothing, Muted until 14:30".
 */
export const labelOf = (member: Member, channelType: string, nowMs: number): string => {
	const level =
		member.notificationLevel === null || isDmType(channelType)
			? "Notification settings"
			: `Notification settings: ${levelLabelOf(member.notificationLevel, channelType)}`
	const mute = muteStatusOf(member, nowMs)
	return mute === null ? level : `${level}, ${mute}`
}

/** The bell, crossed out while muted; its menu has the mute and level items. */
export const view = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	member: Member,
	channelType: string,
	nowMs: number,
	toMessage: (message: Message) => M,
): Html => {
	const isMuted = isMutedNow(member, nowMs)
	const notificationMember = { isMuted, notificationLevel: member.notificationLevel }
	const isDm = isDmType(channelType)
	const label = labelOf(member, channelType, nowMs)
	return h.submodel({
		slotId: model.menu.id,
		model: model.menu,
		view: menuView,
		viewInputs: {
			// A DM notifies of every message: only muting changes anything there.
			entries: isDm
				? [muteEntry(notificationMember)]
				: [
						muteEntry(notificationMember),
						levelEntry(channelType),
						...(channelType === "thread"
							? [Menu.separator, Menu.item("unfollow", { textValue: "Unfollow thread" })]
							: []),
					],
			toTrigger: (attributes, overlay) =>
				h.span(
					[h.Class("relative inline-flex")],
					[
						iconButton(
							h,
							{ label, intent: "plain", attributes },
							isMuted
								? IconBellSlash(h, { attributes: { "data-slot": "icon" } })
								: IconBell(h, { attributes: { "data-slot": "icon" } }),
						),
						overlay,
					],
				),
			content: (key) =>
				key === "unfollow"
					? [
							IconBellSlash(h, { className: "size-4" }),
							menuLabel(h, model.menu.id, key, "Unfollow thread"),
						]
					: (itemContent(h, notificationMember, channelType, key, (value) =>
							menuLabel(h, model.menu.id, key, value),
						) ?? [key]),
			className: "w-52",
		},
		toParentMessage: (message) => toMessage(Message.GotMenuMessage({ message })),
	})
}
