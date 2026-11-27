/**
 * The channel composer's data and pure rules (today's `web-foldkit/src/composer/{draft,options}.ts`):
 * what Send does (a message, a reply or an edit), the upload queue, the `@ / :` suggestions and what
 * a picked one writes into the text. No effects here; `ChannelComposer.ts` runs them.
 */
import { AttachmentId, BotCommandId, BotId, MessageId, UserId } from "@hazel/schema"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { EMOJI_DATA } from "../../lib/emoji-shortcode-map"

// ---------------------------------------------------------------------------
// the draft
// ---------------------------------------------------------------------------

/** What Send does with the draft: a new message, a reply, or an edit (never both). */
export const Mode = Schema.Union([
	Schema.TaggedStruct("Plain", {}),
	Schema.TaggedStruct("Replying", { messageId: MessageId, author: Schema.String, text: Schema.String }),
	/** `hadText`: the message had text when the edit began (an attachment-only one has none). */
	Schema.TaggedStruct("Editing", { messageId: MessageId, hadText: Schema.Boolean }),
])
export type Mode = typeof Mode.Type

export const plain: Mode = { _tag: "Plain" }

export const FileKind = Schema.Literals(["image", "video", "file"])
export type FileKind = typeof FileKind.Type

/** A file the host holds for the composer: the bytes stay with the host, the screen keeps its id. */
export const HeldFile = Schema.Struct({
	localId: Schema.String,
	name: Schema.String,
	size: Schema.Finite,
	kind: FileKind,
	/** The host's local url of an image, drawn while it uploads. */
	preview: Schema.NullOr(Schema.String),
})
export type HeldFile = typeof HeldFile.Type

/** One attachment of the draft: waiting, uploading (`progress` 0 to 1), uploaded, or failed. */
export const Upload = Schema.Struct({
	...HeldFile.fields,
	progress: Schema.Finite,
	attachmentId: Schema.NullOr(AttachmentId),
	failed: Schema.Boolean,
})
export type Upload = typeof Upload.Type

export const uploadOf = (file: HeldFile): Upload => ({
	...file,
	progress: 0,
	attachmentId: null,
	failed: false,
})

/** Files go one after another, as today: the first not yet uploaded nor failed. */
export const currentUpload = (uploads: ReadonlyArray<Upload>): Upload | undefined =>
	uploads.find((upload) => upload.attachmentId === null && !upload.failed)

export const isUploading = (uploads: ReadonlyArray<Upload>) => currentUpload(uploads) !== undefined

export const attachmentIdsOf = (uploads: ReadonlyArray<Upload>): ReadonlyArray<AttachmentId> =>
	uploads.flatMap((upload) => (upload.attachmentId === null ? [] : [upload.attachmentId]))

const formatSize = (bytes: number) =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(1)} KB`
			: `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** The previews over the text: today's tiles, with the progress while a file uploads. */
export const attachmentsOf = (uploads: ReadonlyArray<Upload>): ReadonlyArray<Content.Attachment> =>
	uploads.map((upload) => ({
		id: upload.localId,
		kind: upload.kind,
		name: upload.name,
		size:
			upload.attachmentId === null && !upload.failed
				? `${Math.round(upload.progress * 100)}% of ${formatSize(upload.size)}`
				: formatSize(upload.size),
		url: upload.preview ?? undefined,
		progress: upload.attachmentId === null && !upload.failed ? upload.progress : undefined,
		failed: upload.failed || undefined,
	}))

/** Sends with text, or with attachments alone; never while a file uploads (it would go without it). */
export const canSend = (text: string, uploads: ReadonlyArray<Upload>) =>
	!isUploading(uploads) && (text.trim() !== "" || attachmentIdsOf(uploads).length > 0)

// ---------------------------------------------------------------------------
// mention, command and emoji data
// ---------------------------------------------------------------------------

export const MentionProvider = Schema.Literals(["slack", "discord"])

export const MentionMember = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	/** A Slack or Discord person of a synced channel: their platform's mark replaces presence. */
	provider: Schema.NullOr(MentionProvider),
})
export type MentionMember = typeof MentionMember.Type

export const MentionBot = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
})
export type MentionBot = typeof MentionBot.Type

export const MentionGroup = Schema.Struct({
	id: Schema.String,
	handle: Schema.String,
	name: Schema.String,
	memberCount: Schema.Finite,
})
export type MentionGroup = typeof MentionGroup.Type

export const PresenceStatus = Schema.Literals(["online", "away", "busy", "offline"])
export const Presence = Schema.Struct({ userId: UserId, status: PresenceStatus })
export type Presence = typeof Presence.Type

export const BotCommandArgument = Schema.Struct({
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	required: Schema.Boolean,
	placeholder: Schema.NullOr(Schema.String),
})

export const BotCommand = Schema.Struct({
	id: BotCommandId,
	name: Schema.String,
	description: Schema.String,
	botId: BotId,
	botName: Schema.String,
	botAvatarUrl: Schema.NullOr(Schema.String),
	arguments: Schema.Array(BotCommandArgument),
})
export type BotCommand = typeof BotCommand.Type

export const CustomEmoji = Schema.Struct({ name: Schema.String, imageUrl: Schema.String })
export type CustomEmoji = typeof CustomEmoji.Type

export const Trigger = Schema.Struct({
	kind: Schema.Literals(["@", "#", "/", ":"]),
	query: Schema.String,
})
export type Trigger = typeof Trigger.Type

// ---------------------------------------------------------------------------
// suggestions
// ---------------------------------------------------------------------------

/** What a picked suggestion does: a mention atom, a command's argument panel, or an emoji. */
export type Pick =
	| { readonly _tag: "Mention"; readonly markdown: string }
	| { readonly _tag: "Command"; readonly command: BotCommand }
	| { readonly _tag: "Emoji"; readonly markdown: string }

export interface Option {
	readonly suggestion: Content.Suggestion
	readonly pick: Pick
}

export interface SuggestionData {
	readonly members: ReadonlyArray<MentionMember>
	readonly bots: ReadonlyArray<MentionBot>
	readonly groups: ReadonlyArray<MentionGroup>
	readonly presence: ReadonlyArray<Presence>
	readonly commands: ReadonlyArray<BotCommand>
	readonly customEmojis: ReadonlyArray<CustomEmoji>
}

const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.filter((word) => word !== "")
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("")

/** A custom emoji's text in a message: today's atom, `![custom-emoji:name](url)`. */
export const customEmojiMarkdown = (emoji: CustomEmoji) => `![custom-emoji:${emoji.name}](${emoji.imageUrl})`

/**
 * `@channel` and `@here`, then the groups (`@handle`, name and member count), the mentionable bots,
 * and the channel's members (with a synced channel's Slack or Discord people), filtered by the query.
 */
const mentionOptions = (data: SuggestionData, query: string): ReadonlyArray<Option> => {
	const search = query.toLowerCase()
	const directive = (id: "channel" | "here", description: string): Option => ({
		suggestion: { id, label: `@${id}`, description, icon: "megaphone" },
		pick: { _tag: "Mention", markdown: `@[directive:${id}]` },
	})
	const special = [
		directive("channel", "Notify all members in this channel"),
		directive("here", "Notify all online members"),
	].filter(({ suggestion }) => suggestion.id.includes(search))
	const groups = data.groups
		.filter((group) => group.handle.includes(search) || group.name.toLowerCase().includes(search))
		.map((group): Option => ({
			suggestion: {
				id: group.id,
				label: `@${group.handle}`,
				description: `${group.name}, ${group.memberCount} ${group.memberCount === 1 ? "member" : "members"}`,
				icon: "users",
			},
			pick: { _tag: "Mention", markdown: `@[group:${group.id}]` },
		}))
	const bots = data.bots
		.filter((bot) => bot.name.toLowerCase().includes(search))
		.map((bot): Option => ({
			suggestion: {
				id: bot.userId,
				label: bot.name,
				description: bot.description ?? "Bot",
				face: {
					name: bot.name,
					initials: initialsOf(bot.name),
					src: bot.avatarUrl ?? undefined,
				},
			},
			pick: { _tag: "Mention", markdown: `@[userId:${bot.userId}]` },
		}))
	const statusOf = new Map(data.presence.map((row) => [row.userId, row.status]))
	const members = data.members
		.filter((member) => member.name.toLowerCase().includes(search))
		.map((member): Option => ({
			suggestion: {
				id: member.userId,
				label: member.name,
				face: {
					name: member.name,
					initials: initialsOf(member.name),
					src: member.avatarUrl ?? undefined,
					// A Slack or Discord person has no Hazel presence.
					presence:
						member.provider === null ? (statusOf.get(member.userId) ?? "offline") : undefined,
				},
				mark: member.provider ?? undefined,
			},
			pick: { _tag: "Mention", markdown: `@[userId:${member.userId}]` },
		}))
	return [...special, ...groups, ...bots, ...members]
}

const commandOptions = (data: SuggestionData, query: string): ReadonlyArray<Option> => {
	const search = query.toLowerCase()
	return data.commands
		.filter(
			(command) =>
				command.name.toLowerCase().includes(search) ||
				command.botName.toLowerCase().includes(search) ||
				command.description.toLowerCase().includes(search),
		)
		.map((command) => ({
			suggestion: {
				id: `${command.botId}-${command.id}`,
				label: `/${command.name}`,
				description: command.description,
				face: {
					name: command.botName,
					initials: initialsOf(command.botName),
					src: command.botAvatarUrl ?? undefined,
				},
				chips: command.arguments.map((arg) => ({ label: arg.name, required: arg.required })),
			},
			pick: { _tag: "Command", command },
		}))
}

const STANDARD_EMOJIS = EMOJI_DATA.map(([emoji, name, ...keywords]) => ({ emoji, name, keywords }))

/** Two characters at least; custom emojis first, then standard ones, 20 at most. */
const emojiOptions = (data: SuggestionData, query: string): ReadonlyArray<Option> => {
	const search = query.toLowerCase()
	if (search.length < 2) return []
	const custom = data.customEmojis
		.filter((emoji) => emoji.name.includes(search))
		.map((emoji): Option => ({
			suggestion: { id: `custom:${emoji.name}`, label: `:${emoji.name}:`, emoji: emoji.imageUrl },
			pick: { _tag: "Emoji", markdown: customEmojiMarkdown(emoji) },
		}))
	const standard = STANDARD_EMOJIS.filter(
		(option) =>
			option.name.includes(search) || option.keywords.some((keyword) => keyword.includes(search)),
	).map((option): Option => ({
		suggestion: { id: option.name, label: `:${option.name}:`, emoji: option.emoji },
		pick: { _tag: "Emoji", markdown: option.emoji },
	}))
	return [...custom, ...standard].slice(0, 20)
}

/** The open trigger's options; `#` lists nothing, as today. */
export const optionsOf = (trigger: Trigger | null, data: SuggestionData): ReadonlyArray<Option> =>
	trigger === null
		? []
		: trigger.kind === "@"
			? mentionOptions(data, trigger.query)
			: trigger.kind === "/"
				? commandOptions(data, trigger.query)
				: trigger.kind === ":"
					? emojiOptions(data, trigger.query)
					: []

/** What an open trigger with nothing to show says. */
export const emptyTextOf = (trigger: Trigger | null): string | undefined =>
	trigger?.kind === "@" ? "No users found" : trigger?.kind === "/" ? "No commands found" : undefined

/** The highlighted row: the one the keys or the pointer moved to, else the first. */
export const activeOf = (options: ReadonlyArray<Option>, active: string | null): string | undefined =>
	options.find((option) => option.suggestion.id === active)?.suggestion.id ?? options[0]?.suggestion.id

/** The row `step` away from the active one, wrapping round. */
export const stepActive = (options: ReadonlyArray<Option>, active: string | null, step: 1 | -1) => {
	if (options.length === 0) return null
	const index = Math.max(
		0,
		options.findIndex((option) => option.suggestion.id === activeOf(options, active)),
	)
	return options[(index + step + options.length) % options.length]?.suggestion.id ?? null
}

/**
 * The trigger's text (`@ma`) at a word start, its last occurrence, replaced by `insert`: the caret
 * sits in the open trigger, and the field puts it after the replacement.
 */
export const replaceTrigger = (text: string, trigger: Trigger, insert: string): string => {
	const token = `${trigger.kind}${trigger.query}`
	let index = text.lastIndexOf(token)
	while (index > 0 && !/\s/.test(text[index - 1] ?? "")) index = text.lastIndexOf(token, index - 1)
	return index < 0
		? `${text}${insert}`
		: `${text.slice(0, index)}${insert}${text.slice(index + token.length)}`
}

/** An emoji picked from the picker: a standard one as itself, a custom one (`:name:`) as its atom. */
export const pickedEmojiMarkdown = (emoji: string, customEmojis: ReadonlyArray<CustomEmoji>) => {
	const custom = customEmojis.find((each) => `:${each.name}:` === emoji)
	return custom === undefined ? emoji : customEmojiMarkdown(custom)
}

/** Text added where the caret is not known (the picker, typing outside): at the end, spaced. */
export const appendText = (text: string, insert: string) =>
	text === "" || /\s$/.test(text) ? `${text}${insert}` : `${text} ${insert}`

// ---------------------------------------------------------------------------
// bot command arguments
// ---------------------------------------------------------------------------

/** The `/` command collecting its arguments (today's command input panel). */
export const CommandInput = Schema.Struct({
	command: BotCommand,
	values: Schema.Record(Schema.String, Schema.String),
	executing: Schema.Boolean,
})
export type CommandInput = typeof CommandInput.Type

export const missingArguments = (input: CommandInput) =>
	input.command.arguments
		.filter((arg) => arg.required && (input.values[arg.name] ?? "").trim() === "")
		.map((arg) => arg.name)
