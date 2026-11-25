import { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Clock, Effect, Match, Schema } from "effect"
import { Command } from "foldkit"
import {
	deleteChannelSectionAction,
	moveChannelToSectionAction,
	updateChannelMemberAction,
} from "~/db/actions"
import { orgOfChannelMember } from "~/db/routing-hints"
import { NotificationChoice, writeChoice } from "../../chat/notification-menu"
import { catchCommon } from "../../data/actions"
import { HazelRpc } from "../../rpc"
import { Message, type SidebarFailure, type SidebarOutcome } from "./model"

/** The sidebar menus' writes: optimistic actions and RPCs, settling into a typed outcome or reason. */

const failed = (reason: SidebarFailure) => Message.FailedSidebarAction({ reason })

const MemberField = Schema.Literals(["isFavorite", "isHidden"])

const memberOutcomes: {
	readonly [F in typeof MemberField.Type]: { readonly on: SidebarOutcome; readonly off: SidebarOutcome }
} = {
	isFavorite: { on: "Favorited", off: "Unfavorited" },
	isHidden: { on: "Hidden", off: "Unhidden" },
}

const choiceOutcomes: { readonly [T in NotificationChoice["_tag"]]: SidebarOutcome } = {
	Mute: "Muted",
	Unmute: "Unmuted",
	SetLevel: "NotificationLevelChanged",
}

/** A choice from the row's notification items (`chat/notification-menu.ts`): mute, unmute, a level. */
export const ApplyNotificationChoice = Command.define("ApplyNotificationChoice", {
	args: { memberId: ChannelMemberId, choice: NotificationChoice },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ memberId, choice }) =>
		writeChoice(memberId, choice).pipe(
			Effect.as(Message.SucceededSidebarAction({ outcome: choiceOutcomes[choice._tag] })),
			Effect.catchTags({
				ChannelMemberNotFoundError: () => Effect.succeed(failed("MemberNotFound")),
			}),
			catchCommon(failed),
		),
})

/** `useChannelMemberActions` favorite toggle, and a DM's "Hide conversation". */
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

/** A section's Mute or Notifications choice, written as the user's section-scoped settings. */
export const ApplySectionNotificationChoice = Command.define("ApplySectionNotificationChoice", {
	args: { organizationId: OrganizationId, sectionId: ChannelSectionId, choice: NotificationChoice },
	messages: [Message.SucceededSidebarAction, Message.FailedSidebarAction],
	execute: ({ organizationId, sectionId, choice }) =>
		Effect.gen(function* () {
			const nowMs = yield* Clock.currentTimeMillis
			const scope = { organizationId, scope: "section" as const, scopeId: sectionId }
			const fields = Match.valueTags(choice, {
				Mute: ({ minutes }) =>
					minutes === null
						? { isMuted: true, mutedUntil: null }
						: { isMuted: false, mutedUntil: new Date(nowMs + minutes * 60_000) },
				Unmute: () => ({ isMuted: false, mutedUntil: null }),
				SetLevel: ({ level }) => ({ level }),
			})
			yield* HazelRpc.use((rpc) => rpc("channelMember.setScopeNotifications", { ...scope, ...fields }))
			return Message.SucceededSidebarAction({
				outcome:
					choice._tag === "Mute"
						? "SectionMuted"
						: choice._tag === "Unmute"
							? "SectionUnmuted"
							: "NotificationLevelChanged",
			})
		}).pipe(
			Effect.catchTags({
				ChannelSectionNotFoundError: () => Effect.succeed(failed("SectionNotFound")),
				UnauthorizedError: () => Effect.succeed(failed("SectionNotFound")),
			}),
			catchCommon(failed),
		),
})
