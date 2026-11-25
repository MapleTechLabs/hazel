/**
 * Discord's notification items for a channel the user is in: "Mute" (for how long, or "Unmute"
 * while muted) and "Notifications" (the level). The sidebar's row menus and the channel header's
 * bell show the same items and write the same way.
 */
import type { ChannelMemberId } from "@hazel/schema"
import { Clock, Effect, Match, Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineTaggedUnion } from "foldkit/schema"
import { updateChannelMemberAction } from "~/db/actions"
import {
	levelKeyOf,
	levelLabelOf,
	levelOfKey,
	MuteDuration,
	muteDurationOfKey,
	muteDurations,
	muteKeyOf,
	type NotificationLevel,
} from "~/lib/notification-settings"
import { ChannelMember } from "@hazel/domain/models"
import { IconBell, IconCheck, IconVolume, IconVolumeMute } from "../icons"
import * as Menu from "../ui/menu"

/**
 * What the items read. `isMuted` is muted now, from the clock, so the menu offers "Unmute" only
 * then. `inheritedLevel` is what "Default" means here (`inheritedLevelOf`).
 */
export interface NotificationMember {
	readonly isMuted: boolean
	readonly notificationLevel: NotificationLevel | null
	readonly inheritedLevel: NotificationLevel
}

export const NotificationChoice = defineTaggedUnion({
	Mute: { minutes: MuteDuration },
	Unmute: {},
	SetLevel: { level: Schema.NullOr(ChannelMember.NotificationLevel) },
})
export type NotificationChoice = typeof NotificationChoice.Type

const LEVEL_CHOICES: ReadonlyArray<NotificationLevel | null> = [null, "all", "mentions", "nothing"]

/** Muted: "Unmute". Not muted: "Mute" opens how long for. */
export const muteEntry = (member: NotificationMember): Menu.Entry =>
	member.isMuted
		? Menu.item("mute", { textValue: "Unmute" })
		: Menu.item("mute", {
				textValue: "Mute",
				submenu: muteDurations.map((duration) =>
					Menu.leaf(muteKeyOf(duration.minutes), { textValue: duration.label }),
				),
			})

/** "Notifications": the inherited default, all messages, only @mentions, or nothing. */
export const levelEntry = (member: NotificationMember): Menu.Entry =>
	Menu.item("notifications", {
		textValue: "Notifications",
		submenu: LEVEL_CHOICES.map((level) =>
			Menu.leaf(levelKeyOf(level), { textValue: levelLabelOf(level, member.inheritedLevel) }),
		),
	})

/**
 * The choice a key makes: a mute duration, a level, or "mute" itself (no duration to pick: it is
 * muted, so it unmutes). `wasMuted` is the member's stored mute, an expired one included, so
 * choosing it clears that too. None for the submenu parents and any other key.
 */
export const choiceOfKey = (key: string, wasMuted: boolean): Option.Option<NotificationChoice> => {
	if (key === "mute")
		return Option.some(
			wasMuted ? NotificationChoice.Unmute() : NotificationChoice.Mute({ minutes: null }),
		)
	return Option.orElse(
		Option.map(muteDurationOfKey(key), (minutes) => NotificationChoice.Mute({ minutes })),
		() => Option.map(levelOfKey(key), (level) => NotificationChoice.SetLevel({ level })),
	)
}

/** An item's children (`menuLabel` draws the words); null for keys these items do not own. */
export const itemContent = <M>(
	h: HtmlBuilder<M>,
	member: NotificationMember,
	key: string,
	text: (value: string) => Html,
): ReadonlyArray<Html | string> | null => {
	if (key === "mute")
		return [
			member.isMuted
				? IconVolume(h, { className: "size-4" })
				: IconVolumeMute(h, { className: "size-4" }),
			text(member.isMuted ? "Unmute" : "Mute"),
		]
	if (key === "notifications") return [IconBell(h, { className: "size-4" }), text("Notifications")]
	const duration = muteDurations.find((candidate) => muteKeyOf(candidate.minutes) === key)
	if (duration !== undefined) return [text(duration.label)]
	const level = LEVEL_CHOICES.find((candidate) => levelKeyOf(candidate) === key)
	if (level !== undefined)
		return [
			text(levelLabelOf(level, member.inheritedLevel)),
			// The level in force: the member's own, or the default when they have none.
			level === member.notificationLevel ? IconCheck(h, { className: "ml-auto size-4" }) : h.empty,
		]
	return null
}

/** The write a choice makes, optimistic: a mute for a while sets `mutedUntil` from the clock. */
export const writeChoice = (memberId: ChannelMemberId, choice: NotificationChoice) =>
	Match.valueTags(choice, {
		Mute: ({ minutes }) =>
			Effect.flatMap(Clock.currentTimeMillis, (nowMs) =>
				updateChannelMemberAction(
					minutes === null
						? { memberId, isMuted: true, mutedUntil: null }
						: { memberId, isMuted: false, mutedUntil: new Date(nowMs + minutes * 60_000) },
				),
			),
		Unmute: () => updateChannelMemberAction({ memberId, isMuted: false, mutedUntil: null }),
		SetLevel: ({ level }) => updateChannelMemberAction({ memberId, notificationLevel: level }),
	})
