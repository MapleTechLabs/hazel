/**
 * Structured props (contract C1): data a primitive measures and draws itself, crossing the wire as one
 * JSON value (G7 option C). Arrays and short keys where a value repeats per row; objects elsewhere.
 */
import { Schema } from "effect"
import { BadgeTone, IconName, MessageAction } from "./options.ts"

// ---------------------------------------------------------------------------
// rich text (`richText.blocks`, `message.row.b`)
// ---------------------------------------------------------------------------

export const RunKind = { mention: 1, link: 2, code: 3, strong: 4, emphasis: 5, strike: 6 } as const
export const BlockKind = { paragraph: 0, code: 1, item: 2, quote: 3 } as const

/** A run: plain text, or `[kind, text, arg?]` (a mention's user id, a link's url). */
export const Run = Schema.Union([
	Schema.String,
	Schema.Tuple([Schema.Literal(RunKind.mention), Schema.String, Schema.String]),
	Schema.Tuple([Schema.Literal(RunKind.link), Schema.String, Schema.String]),
	Schema.Tuple([Schema.Literal(RunKind.code), Schema.String]),
	Schema.Tuple([Schema.Literal(RunKind.strong), Schema.String]),
	Schema.Tuple([Schema.Literal(RunKind.emphasis), Schema.String]),
	Schema.Tuple([Schema.Literal(RunKind.strike), Schema.String]),
])
export type Run = typeof Run.Type

/** A paragraph's runs, a code block's text and language, a list item with its marker, a quote. */
export const Block = Schema.Union([
	Schema.Tuple([Schema.Literal(BlockKind.paragraph), Schema.Array(Run)]),
	Schema.Tuple([Schema.Literal(BlockKind.code), Schema.String, Schema.String]),
	Schema.Tuple([Schema.Literal(BlockKind.item), Schema.Array(Run), Schema.String]),
	Schema.Tuple([Schema.Literal(BlockKind.quote), Schema.Array(Run)]),
])
export type Block = typeof Block.Type

export const RichText = Schema.Array(Block)
export type RichText = typeof RichText.Type

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

/** `[emoji, count, mine]`; a custom emoji is its image url. */
export const Reaction = Schema.Tuple([Schema.String, Schema.Finite, Schema.Literals([0, 1])])
export type Reaction = typeof Reaction.Type

export const AttachmentKind = Schema.Literals(["image", "video", "file"])
export const Attachment = Schema.Struct({
	id: Schema.String,
	kind: AttachmentKind,
	name: Schema.String,
	/** Formatted by the screen (`2.4 MB`). */
	size: Schema.optional(Schema.String),
	url: Schema.optional(Schema.String),
	/** Pixel size of an image or video, so native lays it out before it loads. */
	width: Schema.optional(Schema.Finite),
	height: Schema.optional(Schema.Finite),
	/** Upload progress 0 to 1 while it uploads (the composer's previews). */
	progress: Schema.optional(Schema.Finite),
})
export type Attachment = typeof Attachment.Type

export const Embed = Schema.Struct({
	url: Schema.String,
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	site: Schema.optional(Schema.String),
	image: Schema.optional(Schema.String),
})
export type Embed = typeof Embed.Type

/** A small label after the author (`APP`, `Customer`, `via Maple`). */
export const AuthorBadge = Schema.Struct({ label: Schema.String, tone: BadgeTone })
export type AuthorBadge = typeof AuthorBadge.Type

export const ThreadSummary = Schema.Struct({
	count: Schema.Finite,
	/** The last reply: its author, initials, text and time label. */
	author: Schema.String,
	initials: Schema.String,
	preview: Schema.String,
	time: Schema.String,
})
export type ThreadSummary = typeof ThreadSummary.Type

/**
 * One message row (G7 option C, extended for the real row). `a i t g b r` keep G7's keys, which
 * `HazelUI/Chat/RowData.swift` decodes; the rest are new in C1.
 */
export const MessageRow = Schema.Struct({
	/** Author name and initials; absent on a grouped row. */
	a: Schema.optional(Schema.String),
	i: Schema.optional(Schema.String),
	/** Author avatar url. */
	avatar: Schema.optional(Schema.String),
	/** Time label (`14:05`), shown in the header or, grouped, in the hover gutter. */
	t: Schema.String,
	g: Schema.optional(Schema.Literal(1)),
	b: RichText,
	r: Schema.optional(Schema.Array(Reaction)),
	/** Edited since sent. */
	edited: Schema.optional(Schema.Literal(1)),
	/** A status emoji after the name. */
	status: Schema.optional(Schema.String),
	badges: Schema.optional(Schema.Array(AuthorBadge)),
	/** The message this one replies to: its author and first line, or absent when it was deleted. */
	reply: Schema.optional(
		Schema.Struct({ author: Schema.String, initials: Schema.String, text: Schema.String }),
	),
	files: Schema.optional(Schema.Array(Attachment)),
	embeds: Schema.optional(Schema.Array(Embed)),
	thread: Schema.optional(ThreadSummary),
	/** What the row offers on hover or long press, in order. */
	actions: Schema.optional(Schema.Array(MessageAction)),
})
export type MessageRow = typeof MessageRow.Type

// ---------------------------------------------------------------------------
// menus, selects, tabs
// ---------------------------------------------------------------------------

export const MenuEntry = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	icon: Schema.optional(IconName),
	destructive: Schema.optional(Schema.Boolean),
	disabled: Schema.optional(Schema.Boolean),
	/** A check mark (the current choice in a group). */
	checked: Schema.optional(Schema.Boolean),
})
export type MenuEntry = typeof MenuEntry.Type

/** Entries in groups; a host draws a separator between groups. Data, so it maps onto `UIMenu`. */
export const MenuGroups = Schema.Array(
	Schema.Struct({ title: Schema.optional(Schema.String), entries: Schema.Array(MenuEntry) }),
)
export type MenuGroups = typeof MenuGroups.Type

export const SelectOption = Schema.Struct({ value: Schema.String, label: Schema.String })
export type SelectOption = typeof SelectOption.Type

export const Tab = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	icon: IconName,
	badge: Schema.optional(Schema.Finite),
})
export type Tab = typeof Tab.Type
