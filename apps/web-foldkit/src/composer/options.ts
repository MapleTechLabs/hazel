import { formatCustomEmojiKey } from "~/lib/custom-emoji-utils"
import { EMOJI_DATA } from "~/lib/emoji-shortcode-map"
import type { BotCommand, Model, PresenceStatus } from "./composer"

/** The option lists of the three autocomplete triggers (`useMentionOptions`, `useBotCommandOptions`, `useEmojiOptions`). */

/** One row of the mention popover (legacy `AutocompleteOption<MentionData>`). */
export interface MentionOption {
	readonly id: string
	readonly label: string
	readonly description: string | null
	readonly type: "user" | "channel" | "here" | "bot"
	readonly displayName: string
	readonly avatarUrl: string | null
	readonly status: PresenceStatus | null
}

/** @channel and @here, then mentionable bots, then channel members, filtered by search. */
export const mentionOptions = (model: Model): ReadonlyArray<MentionOption> => {
	if (model.autocomplete?.trigger !== "mention") return []
	const search = model.autocomplete.search.toLowerCase()
	const special: Array<MentionOption> = [
		{ id: "channel", label: "@channel", description: "Notify all members in this channel" },
		{ id: "here", label: "@here", description: "Notify all online members" },
	]
		.filter(({ id }) => id.includes(search))
		.map(({ id, label, description }) => ({
			id,
			label,
			description,
			type: id === "channel" ? "channel" : "here",
			displayName: id,
			avatarUrl: null,
			status: null,
		}))
	const bots = model.mentionableBots
		.filter((bot) => bot.name.toLowerCase().includes(search))
		.map(
			(bot): MentionOption => ({
				id: bot.userId,
				label: bot.name,
				description: bot.description ?? "Bot",
				type: "bot",
				displayName: bot.name,
				avatarUrl: bot.avatarUrl,
				status: null,
			}),
		)
	const statusOf = new Map(model.presence.map((row) => [row.userId, row.status]))
	const members = model.members.flatMap((member): Array<MentionOption> => {
		const displayName = `${member.firstName} ${member.lastName}`
		if (!displayName.toLowerCase().includes(search)) return []
		return [
			{
				id: member.userId,
				label: displayName,
				description: null,
				type: "user",
				displayName,
				avatarUrl: member.avatarUrl,
				status: statusOf.get(member.userId) ?? "offline",
			},
		]
	})
	return [...special, ...bots, ...members]
}

export interface CommandOption {
	readonly id: string
	readonly command: BotCommand
}

export const commandOptions = (model: Model): ReadonlyArray<CommandOption> => {
	if (model.autocomplete?.trigger !== "command") return []
	const search = model.autocomplete.search.toLowerCase()
	return model.botCommands
		.filter(
			(command) =>
				command.name.toLowerCase().includes(search) ||
				command.bot.name.toLowerCase().includes(search) ||
				command.description.toLowerCase().includes(search),
		)
		.map((command) => ({ id: `${command.bot.id}-${command.id}`, command }))
}

export interface EmojiOption {
	readonly id: string
	readonly emoji: string
	readonly name: string
	readonly keywords: ReadonlyArray<string>
	readonly imageUrl: string | null
}

const ALL_EMOJI_OPTIONS: ReadonlyArray<EmojiOption> = EMOJI_DATA.map(([emoji, name, ...keywords]) => ({
	id: name,
	emoji,
	name,
	keywords,
	imageUrl: null,
}))

/** Two characters minimum; custom emojis first, then standard, at most 20. */
export const emojiOptions = (model: Model): ReadonlyArray<EmojiOption> => {
	if (model.autocomplete?.trigger !== "emoji") return []
	const search = model.autocomplete.search.toLowerCase()
	if (search.length < 2) return []
	const standard = ALL_EMOJI_OPTIONS.filter(
		(option) => option.name.includes(search) || option.keywords.some((keyword) => keyword.includes(search)),
	)
	const custom = model.customEmojis
		.filter((emoji) => emoji.name.includes(search))
		.map((emoji) => ({
			id: formatCustomEmojiKey(emoji.name),
			emoji: formatCustomEmojiKey(emoji.name),
			name: emoji.name,
			keywords: [],
			imageUrl: emoji.imageUrl,
		}))
	return [...custom, ...standard].slice(0, 20)
}

/** How many options the open trigger shows. */
export const optionCount = (model: Model): number => {
	const trigger = model.autocomplete?.trigger
	if (trigger === undefined) return 0
	return trigger === "mention"
		? mentionOptions(model).length
		: trigger === "command"
			? commandOptions(model).length
			: emojiOptions(model).length
}

/** Legacy `useSlateAutocomplete` clamps the index to the current list. */
export const clampedActiveIndex = (model: Model) => {
	const count = optionCount(model)
	return count > 0 ? Math.min(model.activeIndex, count - 1) : 0
}
