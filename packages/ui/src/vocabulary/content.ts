/**
 * Structured props (contract C1): data a primitive measures and draws itself, crossing the wire as one
 * JSON value (G7 option C). Objects with readable keys; rich text stays compact tuples.
 */
import { Schema } from "effect"
import { AvatarPresence, BadgeTone, IconName, MessageAction, Provider, TabTint } from "./options.ts"

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
	/** The upload or the load failed: the tile shows it, and a press raises `retry` (phase 4). */
	failed: Schema.optional(Schema.Boolean),
	/** A video's length, formatted by the screen (`1:24`), for the media grid (phase 4). */
	duration: Schema.optional(Schema.String),
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

export const SelectOption = Schema.Struct({
	value: Schema.String,
	label: Schema.String,
	/** A second line, and what a `searchable` select also matches (phase 4). */
	description: Schema.optional(Schema.String),
	/** Options sharing a `group` are drawn under that heading, in first-seen order (phase 4). */
	group: Schema.optional(Schema.String),
	disabled: Schema.optional(Schema.Boolean),
})
export type SelectOption = typeof SelectOption.Type

export const Tab = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	/** Required by `tabBar` style `app` (a phone's tabs); `page` tabs are text (phase 4: optional). */
	icon: Schema.optional(IconName),
	/** A saved view's colour: tints `icon`, or is drawn as a dot before the label when there is none. */
	tint: Schema.optional(TabTint),
	badge: Schema.optional(Schema.Finite),
	/** Where the tab links on the web (`?tab=`), for middle click and copy link. */
	href: Schema.optional(Schema.String),
})
export type Tab = typeof Tab.Type

// ---------------------------------------------------------------------------
// phase 4: data the web pages draw (`docs/hazel-ui-phase4.md`, "Pattern gaps")
// ---------------------------------------------------------------------------

/** A table column's share of the row; `fill` takes the rest and truncates (one per table). */
export const TableColumnWidth = Schema.Literals(["auto", "fill", "narrow", "regular", "wide"])
export type TableColumnWidth = typeof TableColumnWidth.Type

/**
 * A `table` column: its header, alignment, whether a press sorts by it, its width, and `optional`,
 * hidden on the compact size class (today's `max-lg:hidden`). Cells follow in `tableRow` order.
 */
export const TableColumn = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	align: Schema.optional(Schema.Literals(["start", "end"])),
	sortable: Schema.optional(Schema.Boolean),
	width: Schema.optional(TableColumnWidth),
	optional: Schema.optional(Schema.Boolean),
})
export type TableColumn = typeof TableColumn.Type

export const SortDirection = Schema.Literals(["ascending", "descending"])
export type SortDirection = typeof SortDirection.Type

/** The column a table is sorted by; the screen sorts the rows, the table only marks the header. */
export const TableSort = Schema.Struct({ column: Schema.String, direction: SortDirection })
export type TableSort = typeof TableSort.Type

/**
 * A series' colour, from today's chart tokens (`--chart-*`): three neutral series, the MRR movement
 * kinds, and the status tones. Never a raw colour.
 */
export const ChartTone = Schema.Literals([
	"series1",
	"series2",
	"series3",
	"neutral",
	"new",
	"expansion",
	"contraction",
	"churn",
	"accent",
	"success",
	"warning",
	"danger",
])
export type ChartTone = typeof ChartTone.Type

/** One series: a value per x label (null: no data there). A stacked bar stacks series per label. */
export const ChartSeries = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	tone: ChartTone,
	values: Schema.Array(Schema.NullOr(Schema.Finite)),
})
export type ChartSeries = typeof ChartSeries.Type

/** One day of a calendar heatmap: ISO date, a level 0 (none) to 4 (most), and its tooltip. */
export const HeatmapDay = Schema.Struct({
	date: Schema.String,
	level: Schema.Literals([0, 1, 2, 3, 4]),
	label: Schema.String,
})
export type HeatmapDay = typeof HeatmapDay.Type

/**
 * One choice of a `choiceGroup`. `image` is a picture over the label (a theme preview, an
 * illustration); `swatch` is a colour the user is choosing, as data (`#6938EF`), drawn as a sample.
 */
export const ChoiceOption = Schema.Struct({
	value: Schema.String,
	label: Schema.String,
	description: Schema.optional(Schema.String),
	icon: Schema.optional(IconName),
	image: Schema.optional(Schema.String),
	swatch: Schema.optional(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
	/** A count after the label (a queue tab, a filter). */
	badge: Schema.optional(Schema.Finite),
	disabled: Schema.optional(Schema.Boolean),
})
export type ChoiceOption = typeof ChoiceOption.Type

/** A person or logo leading a palette item or a composer suggestion. */
export const Face = Schema.Struct({
	name: Schema.String,
	initials: Schema.String,
	src: Schema.optional(Schema.String),
	presence: Schema.optional(AvatarPresence),
})
export type Face = typeof Face.Type

/** One command palette result; `shortcut` is a key hint drawn as key caps (web only). */
export const PaletteItem = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	description: Schema.optional(Schema.String),
	icon: Schema.optional(IconName),
	face: Schema.optional(Face),
	shortcut: Schema.optional(Schema.String),
})
export type PaletteItem = typeof PaletteItem.Type

/** Results in groups, filtered by the screen; the palette only moves the highlight and reports picks. */
export const PaletteGroups = Schema.Array(
	Schema.Struct({ title: Schema.optional(Schema.String), items: Schema.Array(PaletteItem) }),
)
export type PaletteGroups = typeof PaletteGroups.Type

/** A breadcrumb over a screen's title; the last one is the screen itself. */
export const Crumb = Schema.Struct({ label: Schema.String, href: Schema.optional(Schema.String) })
export type Crumb = typeof Crumb.Type

/** One composer suggestion for an open trigger (`@`, `#`, `/`, `:`), drawn above the composer. */
/** A bot command's argument after its name: `<required>` warning-tinted, `[optional]` muted. */
export const SuggestionChip = Schema.Struct({ label: Schema.String, required: Schema.optional(Schema.Boolean) })
export type SuggestionChip = typeof SuggestionChip.Type

export const Suggestion = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	description: Schema.optional(Schema.String),
	/** A group heading (Members, Bots, Channels); suggestions are drawn in the order given. */
	group: Schema.optional(Schema.String),
	icon: Schema.optional(IconName),
	face: Schema.optional(Face),
	/** An emoji (or a custom emoji's image url) for `:` suggestions. */
	emoji: Schema.optional(Schema.String),
	mark: Schema.optional(Provider),
	/** A `/` command's arguments, drawn after the label (`composer-command-args`). */
	chips: Schema.optional(Schema.Array(SuggestionChip)),
})
export type Suggestion = typeof Suggestion.Type

/** A member's name for the mentions in a draft the composer never suggested (`composer-mention-names`). */
export const MentionName = Schema.Struct({ id: Schema.String, name: Schema.String })
export type MentionName = typeof MentionName.Type

/** What the composer is doing besides a new message: replying to one, or editing one. */
export const ComposerContext = Schema.Struct({
	kind: Schema.Literals(["reply", "edit"]),
	author: Schema.optional(Schema.String),
	text: Schema.String,
})
export type ComposerContext = typeof ComposerContext.Type
