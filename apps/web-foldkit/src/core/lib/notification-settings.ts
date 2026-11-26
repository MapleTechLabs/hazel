/**
 * Discord's per-channel notification settings, as menus offer them: what a member is notified of
 * (`notificationLevel`; null is the channel type's default) and how long a mute lasts.
 */
import type { ChannelMember } from "@hazel/domain/models"
import { Option, Schema } from "effect"

export type NotificationLevel = ChannelMember.NotificationLevel

/** The server's defaults (`notification-rules.ts`): everything in DMs and threads, mentions elsewhere. */
export const defaultLevelOf = (type: string): NotificationLevel =>
	type === "direct" || type === "single" || type === "thread" ? "all" : "mentions"

export const levelLabels = {
	all: "All messages",
	mentions: "Only @mentions",
	nothing: "Nothing",
} as const satisfies { readonly [L in NotificationLevel]: string }

/** A mute's length in minutes; `null` lasts until it is turned off. */
export const MuteDuration = Schema.NullOr(Schema.Finite)
export type MuteDuration = typeof MuteDuration.Type

export const muteDurations: ReadonlyArray<{ readonly minutes: MuteDuration; readonly label: string }> = [
	{ minutes: 15, label: "For 15 minutes" },
	{ minutes: 60, label: "For 1 hour" },
	{ minutes: 8 * 60, label: "For 8 hours" },
	{ minutes: 24 * 60, label: "For 24 hours" },
	{ minutes: null, label: "Until I turn it back on" },
]

/** Menu keys: `mute:<minutes>` / `mute:forever`, `level:<level>` / `level:default`. */
export const muteKeyOf = (minutes: MuteDuration) => `mute:${minutes ?? "forever"}`
export const levelKeyOf = (level: NotificationLevel | null) => `level:${level ?? "default"}`

export const muteDurationOfKey = (key: string): Option.Option<MuteDuration> => {
	if (!key.startsWith("mute:")) return Option.none()
	const found = muteDurations.find((duration) => muteKeyOf(duration.minutes) === key)
	return found === undefined ? Option.none() : Option.some(found.minutes)
}

const LEVELS: ReadonlyArray<NotificationLevel | null> = [null, "all", "mentions", "nothing"]

export const levelOfKey = (key: string): Option.Option<NotificationLevel | null> => {
	const found = LEVELS.find((level) => levelKeyOf(level) === key)
	return found === undefined ? Option.none() : Option.some(found)
}

/**
 * What a channel with no level of its own is notified of (`notification-rules.ts`): its section's
 * level, else the organization's, else the type's default. DMs and threads take the type's default.
 * A section with no level of its own passes no `sectionLevel`.
 */
export const inheritedLevelOf = (
	channelType: string,
	scopes: {
		readonly sectionLevel?: NotificationLevel | null | undefined
		readonly organizationLevel?: NotificationLevel | null | undefined
	} = {},
): NotificationLevel =>
	channelType === "direct" || channelType === "single" || channelType === "thread"
		? defaultLevelOf(channelType)
		: (scopes.sectionLevel ?? scopes.organizationLevel ?? defaultLevelOf(channelType))

/** The level's label; the default names the level it inherits (`inheritedLevelOf`). */
export const levelLabelOf = (level: NotificationLevel | null, inheritedLevel: NotificationLevel) =>
	level === null ? `Default (${levelLabels[inheritedLevel]})` : levelLabels[level]

/** Muted now: for good, or until a time still ahead. */
export const isMutedNow = (
	member: { readonly isMuted: boolean; readonly mutedUntilMs: number | null },
	nowMs: number,
) => member.isMuted || (member.mutedUntilMs !== null && member.mutedUntilMs > nowMs)

/** "Muted until 14:30" (or "until Tue 14:30"), "Muted" for good, null when not muted. */
export const muteStatusOf = (
	member: { readonly isMuted: boolean; readonly mutedUntilMs: number | null },
	nowMs: number,
): string | null => {
	if (member.isMuted) return "Muted"
	if (member.mutedUntilMs === null || member.mutedUntilMs <= nowMs) return null
	const until = new Date(member.mutedUntilMs)
	const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
	return until.toDateString() === new Date(nowMs).toDateString()
		? `Muted until ${time}`
		: `Muted until ${until.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
}
