/**
 * "This organization" on the notifications page: Discord's server notification settings, the
 * signed-in user's own (`notification_overrides`, scope `organization`). A level for channels that
 * have none of their own, a mute for a while or until turned off, and "Suppress @channel and
 * @here". DMs take none of them (`notification-rules.ts`).
 */
import { NotificationOverride } from "@hazel/domain/models"
import type { OrganizationId } from "@hazel/schema"
import { and, eq } from "@tanstack/db"
import { DateTime, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { notificationOverrideCollection } from "~/db/collections"
import {
	isMutedNow,
	levelLabels,
	MuteDuration,
	muteDurations,
	muteStatusOf,
	type NotificationLevel,
} from "~/lib/notification-settings"
import { liveQueryStream } from "../../../data/live-query"
import { segmented } from "../../../ui/segmented-control"
import { switchControl } from "../../../ui/switch"

/** The user's settings for the organization, as the page holds them; the defaults with no row. */
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

/** What one change writes: only the fields given. */
export const Change = Schema.Struct({
	level: Schema.optional(Schema.NullOr(NotificationOverride.Schema.fields.level)),
	mute: Schema.optional(Schema.Union([MuteDuration, Schema.Literal("off")])),
	suppressEveryone: Schema.optional(Schema.Boolean),
})
export type Change = typeof Change.Type

/** The settings with a change applied, shown at once while the write goes out. */
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

/** The user's own row for the organization (only theirs is synced). */
export const organizationSettingsStream = <M>(
	organizationId: OrganizationId,
	toMessage: (settings: OrganizationSettings) => M,
) =>
	liveQueryStream<NotificationOverride.Type, M>(
		(q) =>
			q
				.from({ override: notificationOverrideCollection })
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
							mutedUntilMs:
								row.mutedUntil === null
									? null
									: row.mutedUntil instanceof Date
										? row.mutedUntil.getTime()
										: DateTime.toEpochMillis(row.mutedUntil),
							suppressEveryone: row.suppressEveryone,
						},
			)
		},
	)

/**
 * `channelMember.setScopeNotifications` for the organization: the whole snapshot the user chose,
 * so writes sent one after another leave the latest choice standing.
 */
export const payloadOf = (organizationId: OrganizationId, settings: OrganizationSettings) => ({
	organizationId,
	scope: "organization" as const,
	scopeId: organizationId,
	level: settings.level,
	suppressEveryone: settings.suppressEveryone,
	isMuted: settings.isMuted,
	mutedUntil: settings.mutedUntilMs === null ? null : new Date(settings.mutedUntilMs),
})

const LEVELS: ReadonlyArray<{ readonly key: NotificationLevel | "default"; readonly label: string }> = [
	{ key: "default", label: "Default" },
	{ key: "all", label: levelLabels.all },
	{ key: "mentions", label: levelLabels.mentions },
	{ key: "nothing", label: levelLabels.nothing },
]

/** `timed`: a running timed mute, shown as its own segment ("Until 14:30") while it lasts. */
type MuteKey = "off" | `${number}` | "forever" | "timed"

const MUTES: ReadonlyArray<{ readonly key: MuteKey; readonly label: string }> = [
	{ key: "off", label: "Off" },
	...muteDurations.map((duration) => ({
		key: duration.minutes === null ? ("forever" as const) : (`${duration.minutes}` as const),
		label: duration.minutes === null ? "Until I turn it off" : duration.label.replace("For ", ""),
	})),
]

/** The running timed mute's segment: picking it again keeps the deadline it has. */
const muteOfKey = (key: MuteKey): Change["mute"] =>
	key === "off" ? "off" : key === "forever" ? null : key === "timed" ? undefined : Number(key)

/** The mute segments and the selected one; a running timed mute adds a segment saying until when. */
export const muteSegmentsOf = (settings: OrganizationSettings, nowMs: number) => {
	if (!isMutedNow(settings, nowMs)) return { segments: MUTES, selected: "off" as MuteKey }
	if (settings.isMuted) return { segments: MUTES, selected: "forever" as MuteKey }
	const until = (muteStatusOf(settings, nowMs) ?? "").replace("Muted until ", "Until ")
	return { segments: [...MUTES, { key: "timed" as MuteKey, label: until }], selected: "timed" as MuteKey }
}

export const view = <M>(
	h: HtmlBuilder<M>,
	settings: OrganizationSettings,
	nowMs: number,
	toMessage: (change: Change) => M,
): Html => {
	const status = muteStatusOf(settings, nowMs)
	const mutes = muteSegmentsOf(settings, nowMs)
	return h.div(
		[h.Class("flex flex-col gap-6")],
		[
			h.div(
				[h.Class("flex flex-col gap-2")],
				[
					h.div([h.Class("font-medium text-sm")], ["Notify me about"]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["For channels without a setting of their own. Direct messages always notify."],
					),
					segmented(h, {
						ariaLabel: "Notify me about",
						segments: LEVELS,
						selected: settings.level ?? "default",
						onSelect: (key) => toMessage({ level: key === "default" ? null : key }),
					}),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-2")],
				[
					h.div([h.Class("font-medium text-sm")], ["Mute this organization"]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[status ?? "Muted channels still notify you when someone mentions you or replies."],
					),
					segmented(h, {
						ariaLabel: "Mute this organization",
						segments: mutes.segments,
						selected: mutes.selected,
						onSelect: (key) => toMessage({ mute: muteOfKey(key) }),
						className: "flex-wrap",
					}),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-2")],
				[
					switchControl(
						h,
						{
							id: "suppress-everyone",
							isSelected: settings.suppressEveryone,
							onChange: (isSelected) => toMessage({ suppressEveryone: isSelected }),
						},
						"Suppress @channel and @here",
					),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["They notify you like any other message in the channel."],
					),
				],
			),
		],
	)
}
