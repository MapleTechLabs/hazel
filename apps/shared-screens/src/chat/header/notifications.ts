/**
 * The channel header's bell (Discord's): mute the channel for a while, or choose what it notifies
 * of; a thread adds "Unfollow thread". The same items and keys as the sidebar row's menu
 * (`channel-sidebar/model.ts`).
 */
import type { Content } from "@hazel/ui/vocabulary/index"
import { Match, Option, Schema } from "effect"
import { ChannelMember } from "@hazel/domain/models"
import { isDmType, levelKeyOf, levelLabels, muteDurations } from "../../channel-sidebar/model"
import type { NotificationLevel } from "./model"

export const NotificationChoice = Schema.Union([
	Schema.TaggedStruct("Mute", { minutes: Schema.NullOr(Schema.Finite) }),
	Schema.TaggedStruct("Unmute", {}),
	Schema.TaggedStruct("SetLevel", { level: Schema.NullOr(ChannelMember.NotificationLevel) }),
	Schema.TaggedStruct("Unfollow", {}),
])
export type NotificationChoice = typeof NotificationChoice.Type

const LEVELS: ReadonlyArray<NotificationLevel | null> = [null, "all", "mentions", "nothing"]

/** The bell's menu: Mute (or Unmute), Notifications with its levels (not in a DM), Unfollow. */
export const bellEntries = (options: {
	readonly isMuted: boolean
	readonly level: NotificationLevel | null
	readonly inheritedLevel: NotificationLevel
	readonly channelType: string
}): Content.MenuGroups => {
	const mute: Content.MenuEntry = options.isMuted
		? { id: "mute", label: "Unmute", icon: "volume" }
		: {
				id: "mute",
				label: "Mute",
				icon: "volume-mute",
				entries: muteDurations.map(({ key, label }) => ({ id: key, label })),
			}
	// A DM notifies of every message: only muting changes anything there.
	if (isDmType(options.channelType)) return [{ entries: [mute] }]
	const levels: Content.MenuEntry = {
		id: "notifications",
		label: "Notifications",
		icon: "bell",
		entries: LEVELS.map((candidate) => ({
			id: levelKeyOf(candidate),
			label:
				candidate === null ? `Default (${levelLabels[options.inheritedLevel]})` : levelLabels[candidate],
			checked: candidate === options.level,
		})),
	}
	return options.channelType === "thread"
		? [
				{ entries: [mute, levels] },
				{ entries: [{ id: "unfollow", label: "Unfollow thread", icon: "bell-off" }] },
			]
		: [{ entries: [mute, levels] }]
}

const minutesOf = (key: string): Option.Option<number | null> => {
	if (key === "mute:forever") return Option.some(null)
	const match = /^mute:(\d+)$/.exec(key)
	return match === null ? Option.none() : Option.some(Number(match[1]))
}

const isLevel = Schema.is(ChannelMember.NotificationLevel)

const levelOf = (key: string): Option.Option<NotificationLevel | null> => {
	if (key === "level:default") return Option.some(null)
	const level = key.slice("level:".length)
	return key.startsWith("level:") && isLevel(level) ? Option.some(level) : Option.none()
}

/**
 * The choice a key makes. "mute" itself has no duration to pick: it is muted, so it unmutes, and
 * `wasMuted` (the stored mute, an expired one included) makes that clear it too.
 */
export const choiceOfKey = (key: string, wasMuted: boolean): Option.Option<NotificationChoice> => {
	if (key === "unfollow") return Option.some({ _tag: "Unfollow" })
	if (key === "mute") return Option.some(wasMuted ? { _tag: "Unmute" } : { _tag: "Mute", minutes: null })
	return Option.orElse(
		Option.map(minutesOf(key), (minutes): NotificationChoice => ({ _tag: "Mute", minutes })),
		() => Option.map(levelOf(key), (level): NotificationChoice => ({ _tag: "SetLevel", level })),
	)
}

/** The toast a choice ends with. */
export const choiceToast = (choice: NotificationChoice): string =>
	Match.valueTags(choice, {
		Mute: () => "Channel muted",
		Unmute: () => "Channel unmuted",
		SetLevel: () => "Notification settings updated",
		Unfollow: () => "Unfollowed thread",
	})
