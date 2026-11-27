/**
 * The notifications page's data (today's `notifications/organization.ts`, `overrides.ts` and
 * `user-stream.ts`): the user's own settings, "This organization" (Discord's server notification
 * settings, `notification_overrides` scope `organization`) and every channel or section with a
 * setting of its own.
 */
import { ChannelMember, NotificationOverride, User } from "@hazel/domain/models"
import { ChannelId, ChannelMemberId, ChannelSectionId, type OrganizationId, type UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { DateTime, Schema } from "effect"
import { liveQuery } from "../../../app/live"
import {
	isMutedNow,
	levelLabels,
	MuteDuration,
	muteDurations,
	muteStatusOf,
	type NotificationLevel,
} from "../../../lib/notification-settings"
import { isDirectMessageType } from "../../../lib/unread"

export const UserSettings = User.UserSettingsSchema
export type UserSettings = User.UserSettings

/** The user's settings for the organization; the defaults with no row. */
export const OrganizationSettings = Schema.Struct({
	level: Schema.NullOr(NotificationOverride.Schema.fields.level),
	isMuted: Schema.Boolean,
	mutedUntilMs: Schema.NullOr(Schema.Finite),
	suppressEveryone: Schema.Boolean,
})
export type OrganizationSettings = typeof OrganizationSettings.Type

export const DEFAULTS: OrganizationSettings = {
	level: null,
	isMuted: false,
	mutedUntilMs: null,
	suppressEveryone: false,
}

/** What one change writes: only the fields given (`mute: null` is until turned off). */
export const Change = Schema.Struct({
	level: Schema.optional(Schema.NullOr(NotificationOverride.Schema.fields.level)),
	mute: Schema.optional(Schema.Union([MuteDuration, Schema.Literal("off")])),
	suppressEveryone: Schema.optional(Schema.Boolean),
})
export type Change = typeof Change.Type

export const applied = (
	settings: OrganizationSettings,
	change: Change,
	nowMs: number,
): OrganizationSettings => ({
	level: change.level === undefined ? settings.level : change.level,
	isMuted: change.mute === undefined ? settings.isMuted : change.mute === null,
	mutedUntilMs:
		change.mute === undefined
			? settings.mutedUntilMs
			: change.mute === null || change.mute === "off"
				? null
				: nowMs + change.mute * 60_000,
	suppressEveryone: change.suppressEveryone ?? settings.suppressEveryone,
})

export const sameSettings = (a: OrganizationSettings, b: OrganizationSettings) =>
	a.level === b.level &&
	a.isMuted === b.isMuted &&
	a.mutedUntilMs === b.mutedUntilMs &&
	a.suppressEveryone === b.suppressEveryone

/** `channelMember.setScopeNotifications`: the whole snapshot, so the latest choice stands. */
export const payloadOf = (organizationId: OrganizationId, settings: OrganizationSettings) => ({
	organizationId,
	scope: "organization" as const,
	scopeId: organizationId,
	level: settings.level,
	suppressEveryone: settings.suppressEveryone,
	isMuted: settings.isMuted,
	mutedUntil: settings.mutedUntilMs === null ? null : new Date(settings.mutedUntilMs),
})

export const LEVELS: ReadonlyArray<{ readonly key: NotificationLevel | "default"; readonly label: string }> =
	[
		{ key: "default", label: "Default" },
		{ key: "all", label: levelLabels.all },
		{ key: "mentions", label: levelLabels.mentions },
		{ key: "nothing", label: levelLabels.nothing },
	]

/** `timed`: a running timed mute, its own segment ("Until 14:30") while it lasts. */
const MUTES: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
	{ key: "off", label: "Off" },
	...muteDurations.map((duration) => ({
		key: duration.minutes === null ? "forever" : `${duration.minutes}`,
		label: duration.minutes === null ? "Until I turn it off" : duration.label.replace("For ", ""),
	})),
]

/** The running timed mute's segment keeps the deadline it has. */
export const muteOfKey = (key: string): Change["mute"] =>
	key === "off" ? "off" : key === "forever" ? null : key === "timed" ? undefined : Number(key)

export const muteSegmentsOf = (settings: OrganizationSettings, nowMs: number) => {
	if (!isMutedNow(settings, nowMs)) return { segments: MUTES, selected: "off" }
	if (settings.isMuted) return { segments: MUTES, selected: "forever" }
	const until = (muteStatusOf(settings, nowMs) ?? "").replace("Muted until ", "Until ")
	return { segments: [...MUTES, { key: "timed", label: until }], selected: "timed" }
}

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

/** A level of its own, or a mute still running: a timed mute that has ended is no override. */
export const isInEffect = (override: Override, nowMs: number): boolean =>
	override.level !== null || muteStatusOf(override, nowMs) !== null

/** "All messages · Muted until 14:30", or "Default". */
export const summaryOf = (override: Override, nowMs: number): string => {
	const parts = [
		...(override.level === null ? [] : [levelLabels[override.level]]),
		...[muteStatusOf(override, nowMs)].filter((status): status is string => status !== null),
	]
	return parts.length === 0 ? "Default" : parts.join(" · ")
}

/** What "Reset" writes for a channel: no level and no mute. */
export const channelResetOf = (memberId: ChannelMemberId) => ({
	memberId,
	isMuted: false,
	mutedUntil: null,
	notificationLevel: null,
})

/** The user's own row (`useNotificationSettings`): only its settings. */
export const userSettingsOf = <M>(userId: UserId, toMessage: (settings: UserSettings | null) => M) =>
	liveQuery<{ readonly settings: UserSettings | null }, M>(
		(data) => (q) =>
			q
				.from({ u: data.collections.userCollection })
				.where(({ u }) => eq(u.id, userId))
				.findOne(),
		(rows) => toMessage(rows[0]?.settings ?? null),
	)

export const organizationSettingsOf = <M>(
	organizationId: OrganizationId,
	toMessage: (settings: OrganizationSettings) => M,
) =>
	liveQuery<
		{
			readonly level: NotificationLevel | null
			readonly isMuted: boolean
			readonly mutedUntil: Date | DateTime.Utc | null
			readonly suppressEveryone: boolean
		},
		M
	>(
		(data) => (q) =>
			q
				.from({ override: data.collections.notificationOverrideCollection })
				.where(({ override }) =>
					and(eq(override.scope, "organization"), eq(override.scopeId, organizationId)),
				),
		(rows) => {
			const row = rows[0]
			return toMessage(
				row === undefined
					? DEFAULTS
					: {
							level: row.level,
							isMuted: row.isMuted,
							mutedUntilMs: msOf(row.mutedUntil),
							suppressEveryone: row.suppressEveryone,
						},
			)
		},
	)

/** The user's channels (not DMs) with a level or mute of their own, by name. */
export const channelOverridesOf = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (overrides: ReadonlyArray<Override>) => M,
) =>
	liveQuery<
		{
			readonly memberId: ChannelMemberId
			readonly channelId: ChannelId
			readonly name: string
			readonly type: string
			readonly level: NotificationLevel | null
			readonly isMuted: boolean
			readonly mutedUntil: Date | null
		},
		M
	>(
		(data) => (q) =>
			q
				.from({ member: data.collections.channelMemberCollection })
				.innerJoin({ channel: data.collections.channelCollection }, ({ member, channel }) =>
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
							!isDirectMessageType(row.type) &&
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
export const sectionOverridesOf = <M>(
	organizationId: OrganizationId,
	toMessage: (overrides: ReadonlyArray<Override>) => M,
) =>
	liveQuery<
		{
			readonly sectionId: ChannelSectionId
			readonly name: string
			readonly level: NotificationLevel | null
			readonly isMuted: boolean
			readonly mutedUntil: Date | DateTime.Utc | null
		},
		M
	>(
		(data) => (q) =>
			q
				.from({ override: data.collections.notificationOverrideCollection })
				.innerJoin({ section: data.collections.channelSectionCollection }, ({ override, section }) =>
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
