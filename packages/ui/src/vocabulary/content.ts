/**
 * Structured props (contract C1): data a primitive measures and draws itself, crossing the wire as one
 * JSON value (G7 option C). Objects with readable keys; rich text stays compact tuples.
 */
import { Schema } from "effect"
import { AvatarPresence, BadgeTone, IconName, MessageAction, Provider } from "./options.ts"

// ---------------------------------------------------------------------------
// rich text (`richText.blocks`, `message.row.body`)
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

/** Who reacted, for the tooltip: up to three names and how many others. */
export const ReactionWho = Schema.Struct({ names: Schema.Array(Schema.String), others: Schema.Finite })
export type ReactionWho = typeof ReactionWho.Type

/** One reaction; a custom emoji is its image url. */
export const Reaction = Schema.Struct({
	emoji: Schema.String,
	count: Schema.Finite,
	mine: Schema.Boolean,
	who: Schema.optional(ReactionWho),
})
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
	/** The thread's name, which leads the card (`thread-name`). */
	name: Schema.optional(Schema.String),
	count: Schema.Finite,
	/** The last reply: its author, initials, text and time label. */
	author: Schema.String,
	initials: Schema.String,
	/** The last reply's author picture (`thread-reply-avatar`); else their seeded face. */
	avatar: Schema.optional(Schema.String),
	preview: Schema.String,
	time: Schema.String,
})
export type ThreadSummary = typeof ThreadSummary.Type

/**
 * One message row (G7 option C, extended for the real row), readable keys only. Grouping is the
 * message's own `grouped` flag, not row data. `HazelUI/Chat/RowData.swift` decodes the same keys.
 */
export const MessageRow = Schema.Struct({
	/** Author name and initials; absent on a grouped row. */
	author: Schema.optional(Schema.String),
	initials: Schema.optional(Schema.String),
	/** Author avatar url. */
	avatar: Schema.optional(Schema.String),
	/** The Slack or Discord mark after a synced author's name. */
	provider: Schema.optional(Provider),
	/** Time label (`14:05`), shown in the header or, grouped, in the hover gutter. */
	time: Schema.String,
	body: RichText,
	reactions: Schema.optional(Schema.Array(Reaction)),
	/** Quick emoji in the hover toolbar before "Add reaction"; a press raises `pressReaction`. */
	quick: Schema.optional(Schema.Array(Schema.String)),
	/** Edited since sent. */
	edited: Schema.optional(Schema.Boolean),
	/** A status emoji after the name. */
	status: Schema.optional(Schema.String),
	badges: Schema.optional(Schema.Array(AuthorBadge)),
	/** The message this one replies to: its author and first line, or absent when it was deleted. */
	reply: Schema.optional(
		Schema.Struct({
			author: Schema.String,
			initials: Schema.String,
			text: Schema.String,
			/** The quoted author's picture (`thread-reply-avatar`). */
			avatar: Schema.optional(Schema.String),
		}),
	),
	files: Schema.optional(Schema.Array(Attachment)),
	embeds: Schema.optional(Schema.Array(Embed)),
	thread: Schema.optional(ThreadSummary),
	/** What the row offers on hover or long press, in order. */
	actions: Schema.optional(Schema.Array(MessageAction)),
})
export type MessageRow = typeof MessageRow.Type

// ---------------------------------------------------------------------------
// channel icons and people
// ---------------------------------------------------------------------------

/** An organization's or customer's mark: its logo, else its initials on a tint seeded by `name`. */
export const Logo = Schema.Struct({
	name: Schema.String,
	initials: Schema.String,
	src: Schema.optional(Schema.String),
})
export type Logo = typeof Logo.Type

/** One tile of a `peopleStrip`: an avatar over a label; `name` seeds the avatar's tint. */
export const StripPerson = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	name: Schema.String,
	initials: Schema.String,
	src: Schema.optional(Schema.String),
	presence: Schema.optional(AvatarPresence),
	/** Unread: the label in default ink and strong, else muted. */
	emphasized: Schema.optional(Schema.Boolean),
	/** Where the tile links on the web (middle click, copy link). */
	href: Schema.optional(Schema.String),
})
export type StripPerson = typeof StripPerson.Type

/** Where a popover anchors inside a leaf: run `run` of the element keyed `key`. */
export const LeafAnchor = Schema.Struct({ key: Schema.String, run: Schema.Finite })
export type LeafAnchor = typeof LeafAnchor.Type

// ---------------------------------------------------------------------------
// menus, selects, tabs
// ---------------------------------------------------------------------------

const menuEntryFields = {
	id: Schema.String,
	label: Schema.String,
	icon: Schema.optional(IconName),
	destructive: Schema.optional(Schema.Boolean),
	disabled: Schema.optional(Schema.Boolean),
	/** A check mark (the current choice in a group). */
	checked: Schema.optional(Schema.Boolean),
}

/** A submenu's entry: one level only, so it maps onto `UIMenu` children. */
export const MenuLeaf = Schema.Struct(menuEntryFields)
export type MenuLeaf = typeof MenuLeaf.Type

export const MenuEntry = Schema.Struct({
	...menuEntryFields,
	/** A submenu (`menu-submenu`); selecting one of its entries reports that entry's id. */
	entries: Schema.optional(Schema.Array(MenuLeaf)),
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
