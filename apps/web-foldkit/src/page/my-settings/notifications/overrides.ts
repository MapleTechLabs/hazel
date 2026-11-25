/**
 * Discord's "Notification overrides": every channel and section of the organization where the user
 * set something of their own (a level or a mute), with what it is and a Reset back to the default.
 */
import { ChannelId, ChannelMemberId, ChannelSectionId, type OrganizationId, type UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { DateTime, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	channelCollection,
	channelMemberCollection,
	channelSectionCollection,
	notificationOverrideCollection,
} from "~/db/collections"
import { levelLabels, muteStatusOf, type NotificationLevel } from "~/lib/notification-settings"
import { ChannelMember } from "@hazel/domain/models"
import { liveQueryStream } from "../../../data/live-query"
import { button } from "../../../ui/button"

export const Override = Schema.Union([
	Schema.TaggedStruct("Channel", {
		memberId: ChannelMemberId,
		channelId: ChannelId,
		name: Schema.String,
		type: Schema.String,
		level: Schema.NullOr(ChannelMember.NotificationLevel),
		isMuted: Schema.Boolean,
		mutedUntilMs: Schema.NullOr(Schema.Finite),
	}),
	Schema.TaggedStruct("Section", {
		sectionId: ChannelSectionId,
		name: Schema.String,
		level: Schema.NullOr(ChannelMember.NotificationLevel),
		isMuted: Schema.Boolean,
		mutedUntilMs: Schema.NullOr(Schema.Finite),
	}),
])
export type Override = typeof Override.Type

const msOf = (value: Date | DateTime.Utc | null | undefined) =>
	value === null || value === undefined
		? null
		: value instanceof Date
			? value.getTime()
			: DateTime.toEpochMillis(value)

/** The user's channels (not DMs) with a level or mute of their own, by name. */
export const channelOverridesStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (overrides: Array<Override>) => M,
) =>
	liveQueryStream<
		{
			memberId: ChannelMemberId
			channelId: ChannelId
			name: string
			type: string
			level: NotificationLevel | null
			isMuted: boolean
			mutedUntil: Date | null
		},
		M
	>(
		(q) =>
			q
				.from({ member: channelMemberCollection })
				.innerJoin({ channel: channelCollection }, ({ member, channel }) =>
					eq(channel.id, member.channelId),
				)
				.where(({ member, channel }) =>
					and(
						eq(channel.organizationId, organizationId),
						eq(member.userId, userId),
						isNull(member.deletedAt),
						isNull(channel.deletedAt),
					),
				)
				.select(({ member, channel }) => ({
					memberId: member.id,
					channelId: channel.id,
					name: channel.name,
					type: channel.type,
					level: member.notificationLevel,
					isMuted: member.isMuted,
					mutedUntil: member.mutedUntil,
				})),
		(rows) =>
			toMessage(
				rows
					.filter(
						(row) =>
							row.type !== "direct" &&
							row.type !== "single" &&
							(row.level !== null || row.isMuted || row.mutedUntil !== null),
					)
					.map((row): Override => ({
						_tag: "Channel",
						memberId: row.memberId,
						channelId: row.channelId,
						name: row.name,
						type: row.type,
						level: row.level,
						isMuted: row.isMuted,
						mutedUntilMs: msOf(row.mutedUntil),
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
			),
	)

/** The user's section settings that are not the defaults, by section name. */
export const sectionOverridesStream = <M>(
	organizationId: OrganizationId,
	toMessage: (overrides: Array<Override>) => M,
) =>
	liveQueryStream<
		{
			sectionId: ChannelSectionId
			name: string
			level: NotificationLevel | null
			isMuted: boolean
			mutedUntil: Date | null
		},
		M
	>(
		(q) =>
			q
				.from({ override: notificationOverrideCollection })
				.innerJoin({ section: channelSectionCollection }, ({ override, section }) =>
					eq(section.id, override.scopeId),
				)
				.where(({ override, section }) =>
					and(
						eq(override.organizationId, organizationId),
						eq(override.scope, "section"),
						isNull(section.deletedAt),
					),
				)
				.select(({ override, section }) => ({
					sectionId: section.id,
					name: section.name,
					level: override.level,
					isMuted: override.isMuted,
					mutedUntil: override.mutedUntil,
				})),
		(rows) =>
			toMessage(
				rows
					.filter((row) => row.level !== null || row.isMuted || row.mutedUntil !== null)
					.map((row): Override => ({
						_tag: "Section",
						sectionId: row.sectionId,
						name: row.name,
						level: row.level,
						isMuted: row.isMuted,
						mutedUntilMs: msOf(row.mutedUntil),
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
			),
	)

/** A level of its own, or a mute still running: a timed mute that has ended is no override. */
export const isInEffect = (override: Override, nowMs: number): boolean =>
	override.level !== null || muteStatusOf(override, nowMs) !== null

/** "All messages · Muted until 14:30", or "Default" for a timed mute that has ended. */
export const summaryOf = (override: Override, nowMs: number): string => {
	const parts = [
		...(override.level === null ? [] : [levelLabels[override.level]]),
		...[muteStatusOf(override, nowMs)].filter((status): status is string => status !== null),
	]
	return parts.length === 0 ? "Default" : parts.join(" · ")
}

export const view = <M>(
	h: HtmlBuilder<M>,
	overrides: ReadonlyArray<Override>,
	nowMs: number,
	toReset: (override: Override) => M,
): Html =>
	listView(
		h,
		overrides.filter((override) => isInEffect(override, nowMs)),
		nowMs,
		toReset,
	)

const listView = <M>(
	h: HtmlBuilder<M>,
	overrides: ReadonlyArray<Override>,
	nowMs: number,
	toReset: (override: Override) => M,
): Html =>
	overrides.length === 0
		? h.p(
				[h.Class("text-muted-fg text-sm")],
				[
					"No channel or section has a setting of its own. Use a channel's or section's menu to set one.",
				],
			)
		: h.ul(
				[h.Class("flex flex-col divide-y divide-border rounded-lg border border-border")],
				overrides.map((override) =>
					h.li(
						[h.Class("flex items-center justify-between gap-3 px-3 py-2")],
						[
							h.div(
								[h.Class("flex min-w-0 flex-col")],
								[
									h.span(
										[h.Class("truncate font-medium text-sm")],
										[override._tag === "Channel" ? `#${override.name}` : override.name],
									),
									h.span(
										[h.Class("text-muted-fg text-xs")],
										[
											`${override._tag === "Section" ? "Section · " : ""}${summaryOf(override, nowMs)}`,
										],
									),
								],
							),
							button(
								h,
								{
									intent: "outline",
									size: "xs",
									onPress: toReset(override),
									attributes: [
										h.AriaLabel(
											override._tag === "Channel"
												? `Reset #${override.name}`
												: `Reset section ${override.name}`,
										),
									],
								},
								["Reset"],
							),
						],
					),
				),
			)
