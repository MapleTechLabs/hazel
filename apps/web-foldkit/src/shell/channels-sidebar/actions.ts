import { ChannelId, ChannelMemberId, ChannelSectionId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import {
	deleteChannelSectionAction,
	moveChannelToSectionAction,
	updateChannelMemberAction,
} from "~/db/actions"
import { orgOfChannelMember } from "~/db/routing-hints"
import { catchCommon } from "../../data/actions"
import { HazelRpc } from "../../rpc"
import { Message, type SidebarFailure, type SidebarOutcome } from "./model"

/** The sidebar menus' writes: optimistic actions and RPCs, settling into a typed outcome or reason. */

const failed = (reason: SidebarFailure) => Message.FailedSidebarAction({ reason })

const MemberField = Schema.Literals(["isMuted", "isFavorite"])

const memberOutcomes: {
	readonly [F in typeof MemberField.Type]: { readonly on: SidebarOutcome; readonly off: SidebarOutcome }
} = {
	isMuted: { on: "Muted", off: "Unmuted" },
	isFavorite: { on: "Favorited", off: "Unfavorited" },
}

/** `useChannelMemberActions` mute and favorite toggles. */
export const UpdateChannelMember = Command.define("UpdateChannelMember", {
	args: { memberId: ChannelMemberId, field: MemberField, value: Schema.Boolean },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ memberId, field, value }) =>
		updateChannelMemberAction({ memberId, [field]: value }).pipe(
			Effect.as(
				Message.SucceededSidebarAction({
					outcome: value ? memberOutcomes[field].on : memberOutcomes[field].off,
				}),
			),
			Effect.catchTags({
				ChannelMemberNotFoundError: () => Effect.succeed(failed("MemberNotFound")),
			}),
			catchCommon(failed),
		),
})

/** `handleLeave`: `channelMember.delete`, as `deleteChannelMemberMutation` sends it. */
export const LeaveChannel = Command.define("LeaveChannel", {
	args: { memberId: ChannelMemberId },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ memberId }) =>
		HazelRpc.use((rpc) =>
			rpc("channelMember.delete", { id: memberId, organizationId: orgOfChannelMember(memberId) }),
		).pipe(
			Effect.as(Message.SucceededSidebarAction({ outcome: "Left" })),
			Effect.catchTags({
				ChannelMemberNotFoundError: () => Effect.succeed(failed("MemberNotFound")),
			}),
			catchCommon(failed),
		),
})

export const MoveChannelToSection = Command.define("MoveChannelToSection", {
	args: { channelId: ChannelId, sectionId: Schema.NullOr(ChannelSectionId) },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ channelId, sectionId }) =>
		moveChannelToSectionAction({ channelId, sectionId }).pipe(
			Effect.as(
				Message.SucceededSidebarAction({ outcome: sectionId ? "MovedToSection" : "MovedToDefault" }),
			),
			Effect.catchTags({
				ChannelNotFoundError: () => Effect.succeed(failed("ChannelNotFound")),
				ChannelSectionNotFoundError: () => Effect.succeed(failed("SectionNotFound")),
			}),
			catchCommon(failed),
		),
})

export const DeleteChannelSection = Command.define("DeleteChannelSection", {
	args: { sectionId: ChannelSectionId },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ sectionId }) =>
		deleteChannelSectionAction({ sectionId }).pipe(
			Effect.as(Message.SucceededSidebarAction({ outcome: "SectionDeleted" })),
			Effect.catchTags({
				ChannelSectionNotFoundError: () => Effect.succeed(failed("SectionAlreadyDeleted")),
			}),
			catchCommon(failed),
		),
})
