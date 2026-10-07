import { ChannelId, ChannelMemberId, ChannelSectionId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import {
	deleteChannelSectionAction,
	moveChannelToSectionAction,
	updateChannelMemberAction,
} from "~/db/actions"
import { failureToast, runAtomFn, settle, successToast } from "../../data/actions"
import { HazelRpc } from "../../rpc"
import { Message } from "./model"

/** The sidebar menus' writes: the legacy optimistic actions and RPCs, with `exitToast` messages. */

const memberNotFound = {
	ChannelMemberNotFoundError: {
		title: "Membership not found",
		description: "You may no longer be a member of this item.",
	},
}

const succeeded = (title: string) => () => Message.SucceededSidebarAction({ toast: successToast(title) })

/** `useChannelMemberActions` mute and favorite toggles. */
export const UpdateChannelMember = Command.define("UpdateChannelMember", {
	args: {
		memberId: ChannelMemberId,
		field: Schema.Literals(["isMuted", "isFavorite"]),
		value: Schema.Boolean,
		successTitle: Schema.String,
	},
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ memberId, field, value, successTitle }) =>
		settle(
			runAtomFn(updateChannelMemberAction, { memberId, [field]: value }),
			succeeded(successTitle),
			(cause) => Message.FailedSidebarAction({ toast: failureToast(cause, memberNotFound) }),
		),
})

/** `handleLeave`: `channelMember.delete`, as `deleteChannelMemberMutation` sends it. */
export const LeaveChannel = Command.define("LeaveChannel", {
	args: { memberId: ChannelMemberId },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ memberId }) =>
		settle(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("channelMember.delete", { id: memberId })
			}),
			succeeded("Left channel successfully"),
			(cause) => Message.FailedSidebarAction({ toast: failureToast(cause, memberNotFound) }),
		),
})

export const MoveChannelToSection = Command.define("MoveChannelToSection", {
	args: { channelId: ChannelId, sectionId: Schema.NullOr(ChannelSectionId) },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ channelId, sectionId }) =>
		settle(
			runAtomFn(moveChannelToSectionAction, { channelId, sectionId }),
			succeeded(sectionId ? "Channel moved to section" : "Channel moved to default"),
			(cause) =>
				Message.FailedSidebarAction({
					toast: failureToast(cause, {
						ChannelNotFoundError: {
							title: "Channel not found",
							description: "This channel may have been deleted.",
						},
						ChannelSectionNotFoundError: {
							title: "Section not found",
							description: "This section may have been deleted.",
						},
					}),
				}),
		),
})

export const DeleteChannelSection = Command.define("DeleteChannelSection", {
	args: { sectionId: ChannelSectionId },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ sectionId }) =>
		settle(runAtomFn(deleteChannelSectionAction, { sectionId }), succeeded("Section deleted"), (cause) =>
			Message.FailedSidebarAction({
				toast: failureToast(cause, {
					ChannelSectionNotFoundError: {
						title: "Section not found",
						description: "This section may have already been deleted.",
					},
				}),
			}),
		),
})
