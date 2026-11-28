/**
 * The `hazel` vocabulary as data (contract C1, `docs/hazel-ui.md` "The vocabulary"): every v1 tag's
 * props, slots, events, commands and owning lanes. The builders (`Hazel.ts`), both hosts' registries,
 * the manifest and `CONTRACTS.md` read this; a change here is a contract change the user reviews.
 */
import { Schema } from "effect"
import * as Content from "./content.ts"
import * as O from "./options.ts"
import * as TextField from "./TextField.ts"

// ---------------------------------------------------------------------------
// prop kinds
// ---------------------------------------------------------------------------

/**
 * How a prop is set and sent. Every kind drops the key when it holds its default, so the wire carries
 * only what differs: `text` and `value` drop `undefined`, `count` drops 0, `flag` drops false, `option`
 * drops its default. `controlled` carries a revision the host never lets go back (G5).
 */
export type PropSpec =
	| { readonly kind: "text"; readonly schema: Schema.Codec<string> }
	| { readonly kind: "count"; readonly schema: Schema.Codec<number> }
	| { readonly kind: "flag"; readonly schema: Schema.Codec<boolean> }
	| { readonly kind: "option"; readonly schema: Schema.Codec<string>; readonly default: string }
	| { readonly kind: "value"; readonly schema: Schema.Top }
	| { readonly kind: "controlled"; readonly schema: Schema.Top }

const text = { kind: "text", schema: Schema.String } as const
const count = { kind: "count", schema: Schema.Finite } as const
const flag = { kind: "flag", schema: Schema.Boolean } as const
const option = <const S extends Schema.Codec<string>, const D extends S["Type"]>(schema: S, value: D) =>
	({ kind: "option", schema, default: value }) as const
const value = <const S extends Schema.Top>(schema: S) => ({ kind: "value", schema }) as const
const controlled = <const S extends Schema.Top>(schema: S) => ({ kind: "controlled", schema }) as const

// ---------------------------------------------------------------------------
// events and commands
// ---------------------------------------------------------------------------

const none = Schema.Struct({})
const ids = Schema.Struct({ id: Schema.String })
/** A dragged row or section dropped before `before` (null: at the end). */
const move = Schema.Struct({ id: Schema.String, before: Schema.NullOr(Schema.String) })
/** A mention pressed inside a leaf, with its run index so a popover can anchor at it (`popover.anchorTo`). */
const mention = Schema.Struct({ userId: Schema.String, run: Schema.Finite })

/** A code block's copy button, by the block's index in the body (`richText`, `message`). */
const copyCode = Schema.Struct({ block: Schema.Finite })

/** Imperative requests a Command sends through the vocabulary's `Host` (wire op `command`). */
export const commandNames = ["focus", "blur", "scrollTo", "measure", "select"] as const
export type CommandName = (typeof commandNames)[number]

// ---------------------------------------------------------------------------
// tags
// ---------------------------------------------------------------------------

export const groups = [
	"layout",
	"collections",
	"content",
	"chat",
	"controls",
	"overlays",
	"structure",
	"internal",
] as const
export type Group = (typeof groups)[number]

/** Phase 2 lanes (`docs/hazel-ui.md`, "Phase 2: lanes") that own a tag's renderer on each platform. */
export type WebLane = "A1" | "A2" | "A3" | "A4" | "A5"
export type IosLane = "S0" | "S1" | "S2" | "S3" | "S4" | "S5"

/** `elements`: element children only; `text`: text and inline elements (`textParents`); `none`: a leaf. */
export type ContentKind = "elements" | "text" | "none"

export interface TagSpec {
	readonly group: Group
	readonly web: WebLane
	readonly ios: IosLane
	readonly content: ContentKind
	readonly props: Readonly<Record<string, PropSpec>>
	readonly slots: ReadonlyArray<string>
	readonly events: Readonly<Record<string, Schema.Top>>
	readonly commands: ReadonlyArray<CommandName>
}

interface Defaults {
	readonly props: {}
	readonly slots: readonly []
	readonly events: {}
	readonly commands: readonly []
}
const tag = <const S extends Partial<TagSpec> & Pick<TagSpec, "group" | "web" | "ios" | "content">>(
	spec: S,
): Omit<Defaults, keyof S> & S => ({ props: {}, slots: [], events: {}, commands: [], ...spec }) as never

const textFieldEvents = {
	change: TextField.ChangePayload,
	submit: TextField.ChangePayload,
	focus: none,
	blur: none,
} as const

export const tags = {
	// Layout
	stack: tag({
		group: "layout",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: {
			axis: option(O.StackAxis, "vertical"),
			density: option(O.StackDensity, "regular"),
			align: option(O.StackAlign, "stretch"),
			// A row's children wrap onto more lines (`pk0-wrap-row`); drawn only at the regular size
			// class (a desk's key hint bar, `pk0-web-only`).
			wrap: flag,
			regularOnly: flag,
			// Phase 4 (`p4-page-gutter`): a page's gutter inside the stack.
			inset: option(O.StackInset, "none"),
		},
	}),
	spacer: tag({ group: "layout", web: "A1", ios: "S1", content: "none" }),
	scroll: tag({
		group: "layout",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: { axis: option(O.StackAxis, "vertical"), inset: option(O.StackInset, "none") },
		commands: ["scrollTo"],
	}),
	frame: tag({
		group: "layout",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: { surface: option(O.FrameSurface, "card") },
		// Phase 4 (`pk0-card-footer`): a row under a hairline at the frame's end, its parts at either end.
		slots: ["footer"],
	}),
	divider: tag({ group: "layout", web: "A1", ios: "S1", content: "none" }),
	// Phase 4: children in equal columns (KPI tiles, integration cards, settings cards); one column
	// on the compact size class. `density` is its gap, as a stack's.
	grid: tag({
		group: "layout",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: { columns: option(O.GridColumns, "auto"), density: option(O.StackDensity, "regular") },
	}),

	// Collections
	list: tag({
		group: "collections",
		web: "A4",
		ios: "S5",
		content: "elements",
		props: {
			anchor: option(O.ListAnchor, "start"),
			stickToBottom: flag,
			// `loading`: the first load; the renderer draws skeleton rows (renderer-owned, no API).
			loading: flag,
			loadingStart: flag,
			loadingEnd: flag,
			reorderable: flag,
		},
		// `overlay`: a bar floating over the list's top edge ("N new messages").
		slots: ["overlay"],
		events: { reachStart: none, reachEnd: none, move },
		commands: ["scrollTo"],
	}),
	listDivider: tag({
		group: "collections",
		web: "A4",
		ios: "S5",
		content: "none",
		props: { kind: option(O.ListDividerKind, "date"), label: text },
	}),

	// Phase 4: the app's data table (`ui/data-table.ts`). The screen sorts and slices the rows; the
	// table marks the sorted header, draws skeleton rows while `loading`, and with `selectable` a
	// checkbox column whose header reports `selectAll`. On iOS a row is a list row of its cells.
	table: tag({
		group: "collections",
		web: "A4",
		ios: "S5",
		content: "elements",
		props: {
			label: text,
			columns: value(Schema.Array(Content.TableColumn)),
			sort: value(Content.TableSort),
			selectable: flag,
			loading: flag,
			stickyHeader: flag,
			// Its own edge (`table-frame`) and how many skeleton rows `loading` draws (0: the renderer's 6).
			frame: option(O.TableFrame, "none"),
			loadingRows: count,
			rowActions: option(O.TableRowActions, "lastCell"),
		},
		events: {
			sort: Schema.Struct({ column: Schema.String }),
			selectAll: Schema.Struct({ selected: Schema.Boolean }),
		},
		commands: ["scrollTo"],
	}),
	// One row: its cells in column order. `current` is the keyboard row (j/k); `group` a heading row
	// spanning every column (`title`); `footer` the totals row; `actions` show on hover or focus.
	tableRow: tag({
		group: "collections",
		web: "A4",
		ios: "S5",
		content: "elements",
		props: { title: text, selected: flag, current: flag, group: flag, footer: flag, disabled: flag },
		slots: ["actions"],
		events: { press: none, select: Schema.Struct({ selected: Schema.Boolean }) },
	}),
	// A cell: any content, aligned and sized by its column; `column` names it for iOS's row labels.
	tableCell: tag({
		group: "collections",
		web: "A4",
		ios: "S5",
		content: "elements",
		props: { column: text },
	}),

	// Content
	text: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "text",
		props: {
			role: option(O.TextRole, "body"),
			tone: option(O.TextTone, "default"),
			strong: flag,
			numeric: flag,
			truncate: flag,
			// Phase 4 (`pk0-status-dot`): the kit's 6pt status dot before the text, in its tone.
			dot: flag,
		},
	}),
	heading: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "text",
		// `size` `large`: the kit's `title` whatever the level (`p4-channel-settings-header`).
		props: { level: option(O.HeadingLevel, "2"), size: option(O.HeadingSize, "auto") },
	}),
	icon: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: { name: value(O.IconName) },
	}),
	image: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: { src: text, alt: text, width: count, height: count },
		events: { press: none },
	}),
	avatar: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: {
			name: text,
			initials: text,
			src: text,
			presence: option(O.AvatarPresence, "none"),
			size: option(O.AvatarSize, "regular"),
			mark: option(O.ProviderMark, "none"),
			// Phase 4 (PK0): a logo's square corners, initials on a tint, and "Unassigned" (a dashed
			// ring around a user glyph).
			corners: option(O.AvatarCorners, "auto"),
			tint: option(O.AvatarTint, "none"),
			placeholder: flag,
		},
		events: { press: none },
	}),
	avatarStack: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "elements",
		// `pair`: a group DM's two avatars, offset diagonally in one avatar's box (`dm-group-avatar`).
		props: { overflow: count, layout: option(O.AvatarStackLayout, "row") },
	}),
	// The kit's `iconTile` (size `md`, 40pt): a glyph on a tinted square leading a row.
	iconTile: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		// Phase 4 (`pk0-source-tile`): a mark's picture in place of the glyph, and smaller tiles.
		props: {
			name: value(O.IconName),
			tone: option(O.IconTileTone, "neutral"),
			image: text,
			size: option(O.IconTileSize, "regular"),
		},
	}),
	// A channel's icon with its marks, as today's `channelIcon`: the emoji, `#` or a lock; a customer's
	// logo (a lock mark when private); up to two Connect partners' logos; the sync provider's mark.
	channelIcon: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: {
			emoji: text,
			private: flag,
			customer: value(Content.Logo),
			partners: value(Schema.Array(Content.Logo)),
			sync: option(O.ProviderMark, "none"),
			// On a 40pt secondary tile, the header's size (`p4-channel-settings-header`).
			tile: flag,
			// With `tile`: the neutral `iconTile`'s hairline border (the chat index cards).
			tileBorder: flag,
		},
	}),
	// A snapping, edge-to-edge horizontal row of avatar-over-label tiles (`people-strip`).
	peopleStrip: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: { people: value(Schema.Array(Content.StripPerson)) },
		events: { press: ids },
	}),
	badge: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: {
			label: text,
			tone: option(O.BadgeTone, "neutral"),
			style: option(O.BadgeStyle, "solid"),
			size: option(O.BadgeSize, "regular"),
			pill: flag,
			// Phase 4 (PK0): a glyph, a mark's picture or the severity bars before the label; a
			// quieter `detail` run after it; `title` on hover; `truncate` caps a long label.
			icon: value(O.IconName),
			image: text,
			severity: option(O.BadgeSeverity, "none"),
			detail: text,
			title: text,
			truncate: flag,
		},
	}),
	progress: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		// `value` 0 to 1; `indeterminate` when the amount is unknown; `spinner` an inline wait (phase 4).
		props: { value: count, indeterminate: flag, label: text, style: option(O.ProgressStyle, "bar") },
	}),
	emptyState: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: {
			title: text,
			description: text,
			icon: value(O.IconName),
			illustration: option(O.EmptyIllustration, "none"),
		},
		slots: ["action"],
	}),
	richText: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: { blocks: value(Content.RichText) },
		events: {
			pressMention: mention,
			pressLink: Schema.Struct({ url: Schema.String }),
			// A code block's copy button (phase 4); the screen copies through `Clipboard`.
			copyCode,
		},
	}),
	// Phase 4: today's hand-drawn SVG charts (`customers/charts`) as one primitive. Values come per x
	// label; the renderer draws axes, gridlines, the crosshair and the tooltip; `hover` reports the
	// index under the pointer for a screen that shows it elsewhere. iOS draws it with Swift Charts.
	chart: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: {
			kind: option(O.ChartKind, "line"),
			label: text,
			series: value(Schema.Array(Content.ChartSeries)),
			labels: value(Schema.Array(Schema.String)),
			format: option(O.ChartFormat, "number"),
			currency: text,
			size: option(O.ChartSize, "regular"),
			legend: flag,
			// A stacked bar's net line, and the evidence bars' highlighted tail (`highlightFrom`).
			net: flag,
			highlightFrom: count,
			loading: flag,
			// Phase 4: the tooltip's heading per label (`Mon, Oct 12` over the tick's `Oct 12`), and the
			// evidence bars' dashed baseline at a value of the page's (else `net`'s prior mean).
			headings: value(Schema.Array(Schema.String)),
			baseline: value(Schema.Finite),
		},
		events: {
			hover: Schema.Struct({ index: Schema.NullOr(Schema.Finite) }),
			press: Schema.Struct({ index: Schema.Finite }),
		},
	}),
	// Phase 4: a year of days as levels (`charts/calendar-heatmap.ts`); arrow keys step the selection.
	heatmap: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: { label: text, days: value(Schema.Array(Content.HeatmapDay)), selected: text },
		events: { select: Schema.Struct({ date: Schema.String }) },
		commands: ["scrollTo"],
	}),
	// Phase 4: a KPI (`customers/ui/kpi-tile.ts`): its value, a delta pill whose tone the view
	// decides from what is good, a comparison line, and a sparkline in `chart`.
	statTile: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: {
			label: text,
			value: text,
			detail: text,
			definition: text,
			delta: text,
			trend: option(O.StatTrend, "none"),
			deltaTone: option(O.StatDeltaTone, "neutral"),
			comparison: text,
			loading: flag,
			href: text,
		},
		slots: ["chart", "action"],
		events: { press: none },
	}),
	// Phase 4: a code snippet outside a message (an MCP URL, a webhook payload), highlighted by
	// `language`, with a copy button that raises `copy`.
	codeBlock: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		props: { code: text, language: text, title: text, copyable: flag, wrap: flag },
		events: { copy: none },
	}),
	// Phase 4: the kit's callout and the chat's "N new messages" band (`list-new-messages-bar`); its
	// children are extra content (a token shown once, a form), `actions` its buttons.
	banner: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: {
			tone: option(O.BadgeTone, "info"),
			style: option(O.BannerStyle, "callout"),
			title: text,
			description: text,
			icon: value(O.IconName),
			dismissible: flag,
		},
		slots: ["actions"],
		events: { dismiss: none },
	}),

	// Chat
	message: tag({
		group: "chat",
		web: "A5",
		ios: "S5",
		content: "none",
		props: {
			row: value(Content.MessageRow),
			grouped: flag,
			pinned: flag,
			highlighted: flag,
			entering: flag,
			pending: flag,
			failed: flag,
		},
		events: {
			press: none,
			longPress: none,
			// `image`: the url of the attachment under the pointer (`copyImage`, `copyImageUrl`).
			action: Schema.Struct({ action: O.MessageAction, image: Schema.optional(Schema.String) }),
			pressAuthor: none,
			pressReaction: Schema.Struct({ emoji: Schema.String }),
			addReaction: none,
			pressMention: mention,
			pressLink: Schema.Struct({ url: Schema.String }),
			pressAttachment: ids,
			pressReply: none,
			pressThread: none,
			retry: none,
			copyCode,
		},
	}),
	reactionBar: tag({
		group: "chat",
		web: "A5",
		ios: "S5",
		content: "none",
		props: { reactions: value(Schema.Array(Content.Reaction)), addable: flag },
		events: { pressReaction: Schema.Struct({ emoji: Schema.String }), add: none },
	}),
	attachmentGrid: tag({
		group: "chat",
		web: "A5",
		ios: "S5",
		content: "none",
		props: {
			attachments: value(Schema.Array(Content.Attachment)),
			removable: flag,
			// Phase 4: the files page's grid, masonry and list; a message keeps the mosaic.
			layout: option(O.AttachmentLayout, "mosaic"),
			// Phase 4 (`p4-media-see-all`): how many more there are; the last tile reads "+N See all"
			// and raises `pressMore`.
			more: count,
		},
		// `download`: a tile's or row's own download button (`p4-media-download`), drawn when handled.
		events: { press: ids, remove: ids, retry: ids, download: ids, pressMore: none },
	}),
	embed: tag({
		group: "chat",
		web: "A5",
		ios: "S5",
		content: "none",
		props: { embed: value(Content.Embed) },
		events: { press: none },
	}),
	typingIndicator: tag({
		group: "chat",
		web: "A5",
		ios: "S5",
		content: "none",
		props: { names: value(Schema.Array(Schema.String)) },
	}),

	// Controls
	button: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			icon: value(O.IconName),
			variant: option(O.ButtonVariant, "primary"),
			size: option(O.ButtonSize, "regular"),
			iconOnly: flag,
			circle: flag,
			// A toggle that is on (`aria-pressed`): a `chip` draws filled (`filter-chip`).
			selected: flag,
			disabled: flag,
			loading: flag,
			// A filter chip's trailing remove mark (phase 4), raising `remove`.
			removable: flag,
			// A quieter run before the label (`Sort` Priority, `Kind is` Risk) and an icon after it.
			detail: text,
			trailingIcon: value(O.IconName),
			// A key cap after the label (`pk0-action-shortcut`, a queue action's key); web only.
			shortcut: text,
		},
		events: { press: none, remove: none },
		commands: ["focus"],
	}),
	link: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		// `tone` `muted` and a leading `icon`: channel settings' "Back to channel" (`p4-channel-settings-header`).
		props: { label: text, href: text, tone: option(O.LinkTone, "accent"), icon: value(O.IconName) },
		events: { press: none },
	}),
	textField: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			placeholder: text,
			description: text,
			value: controlled(TextField.State),
			error: text,
			disabled: flag,
			readOnly: flag,
			required: flag,
			monospace: flag,
			// Phase 4: the keyboard and hints; a masked value with a reveal button; a copy button
			// (`copy`); fixed text before or after the value (`hazel.app/`, `minutes`).
			inputKind: option(O.InputKind, "text"),
			secret: flag,
			copyable: flag,
			prefix: text,
			suffix: text,
		},
		events: { ...textFieldEvents, copy: none },
		commands: ["focus", "blur", "select"],
	}),
	textArea: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			placeholder: text,
			description: text,
			value: controlled(TextField.State),
			error: text,
			disabled: flag,
		},
		events: textFieldEvents,
		commands: ["focus", "blur", "select"],
	}),
	toggle: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			description: text,
			checked: flag,
			disabled: flag,
			// Phase 4: a checkbox look, and its mixed state (a header row's "select all").
			style: option(O.ToggleStyle, "switch"),
			indeterminate: flag,
		},
		events: { change: Schema.Struct({ checked: Schema.Boolean }) },
	}),
	select: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			placeholder: text,
			options: value(Schema.Array(Content.SelectOption)),
			value: text,
			disabled: flag,
			// Phase 4, the combobox: typing filters the options (label and description); `query`
			// reports the text for options the screen loads; `footer` holds a "Create ..." row.
			searchable: flag,
			// The control's width (`narrow`: a filter's `w-36`); the field still takes its row.
			width: option(O.FieldWidth, "auto"),
		},
		slots: ["footer"],
		events: {
			change: Schema.Struct({ value: Schema.String }),
			query: Schema.Struct({ text: Schema.String }),
		},
	}),
	searchField: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			placeholder: text,
			value: controlled(TextField.State),
			// Phase 4: its width in a row, and a key cap shown while empty (`/`, web only).
			width: option(O.FieldWidth, "auto"),
			shortcut: text,
		},
		events: { change: TextField.ChangePayload, submit: TextField.ChangePayload },
		commands: ["focus", "blur"],
	}),
	composer: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			placeholder: text,
			value: controlled(TextField.State),
			disabled: flag,
			canSend: flag,
			// Phase 4: the open trigger's suggestions, drawn above the field with `activeSuggestion`
			// highlighted; the reply or edit bar.
			suggestions: value(Schema.Array(Content.Suggestion)),
			activeSuggestion: text,
			context: value(Content.ComposerContext),
			// What an open trigger with no suggestions says ("No users found"); the names of the
			// mentions a draft holds, for atoms the composer never suggested.
			emptyText: text,
			mentions: value(Schema.Array(Content.MentionName)),
		},
		slots: ["above", "actions"],
		events: {
			...textFieldEvents,
			// `@`, `#`, `/` or `:` typed at the caret and the query after it; `query` null when it closes.
			trigger: Schema.Struct({
				kind: Schema.Literals(["@", "#", "/", ":"]),
				query: Schema.NullOr(Schema.String),
			}),
			// Only while a trigger is open: these keys drive the suggestions, not the text.
			key: Schema.Struct({ key: O.ComposerKey }),
			// Files dropped or pasted; the host hands them to `Files` and reports the count.
			files: Schema.Struct({ count: Schema.Finite }),
			// Phase 4: a suggestion pressed; Up in an empty composer (edit the last message); the
			// context bar's close.
			pressSuggestion: ids,
			editLast: none,
			cancelContext: none,
			// The pointer over a suggestion (today it moves the active row); Escape with no context and
			// no trigger open; Shift+Tab out of the field (today focus goes to the messages).
			hoverSuggestion: ids,
			escape: none,
			leave: none,
		},
		commands: ["focus", "blur", "select"],
	}),

	// Phase 4: one choice among options, or several (`multiple`), in one of the kit's looks: radio
	// rows, choice cards (`columns`), a segmented control, filter chips, or colour swatches.
	choiceGroup: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			description: text,
			error: text,
			options: value(Schema.Array(Content.ChoiceOption)),
			selected: value(Schema.Array(Schema.String)),
			multiple: flag,
			style: option(O.ChoiceStyle, "list"),
			columns: option(O.ChoiceColumns, "1"),
			disabled: flag,
			// The label names the group for assistive tech only (a range picker, `pk0-choice-name`).
			labelHidden: flag,
		},
		events: { change: Schema.Struct({ selected: Schema.Array(Schema.String) }) },
	}),
	slider: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			value: count,
			min: count,
			max: count,
			step: count,
			valueText: text,
			disabled: flag,
		},
		events: { change: Schema.Struct({ value: Schema.Finite }) },
	}),
	// Phase 4: the kit's date stack (`ui/date-picker.ts`, `date-field.ts`). `value`, `min` and `max`
	// are ISO text (`2026-11-26`, `09:30`, or both); the web draws segments and a calendar popover,
	// iOS the system picker.
	datePicker: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			description: text,
			error: text,
			placeholder: text,
			value: text,
			min: text,
			max: text,
			granularity: option(O.DateGranularity, "date"),
			clearable: flag,
			disabled: flag,
		},
		events: { change: Schema.Struct({ value: Schema.NullOr(Schema.String) }) },
		commands: ["focus"],
	}),
	// Phase 4: a dashed target for files (custom emojis, imports): a press opens the picker, a drop
	// hands the files to `Files` and reports the count, as the composer's `files`.
	dropZone: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: {
			label: text,
			description: text,
			// The glyph over the label (`emoji-add` for custom emojis); else picked from `accept`.
			icon: value(O.IconName),
			accept: text,
			multiple: flag,
			disabled: flag,
			loading: flag,
		},
		events: { press: none, files: Schema.Struct({ count: Schema.Finite }) },
	}),

	// Overlays
	menu: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "none",
		props: { label: text, entries: value(Content.MenuGroups) },
		slots: ["trigger"],
		events: { select: ids },
	}),
	contextMenu: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		props: { entries: value(Content.MenuGroups) },
		events: { select: ids },
	}),
	sheet: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		// Phase 4: `style` `card` is today's floating phone sheet (the customer card).
		props: { open: flag, title: text, style: option(O.SheetStyle, "panel") },
		events: { dismiss: none },
	}),
	dialog: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		// Phase 4: `size` is the kit's modal width; `icon` heads the dialog as an icon tile (beside the
		// title, or above it in `danger`); `secondaryActions` sit at the footer's start.
		props: {
			open: flag,
			title: text,
			description: text,
			destructive: flag,
			size: option(O.DialogSize, "regular"),
			icon: value(O.IconName),
			iconTone: option(O.DialogIconTone, "accent"),
		},
		slots: ["actions", "secondaryActions"],
		events: { dismiss: none },
	}),
	popover: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		// `anchorTo`: anchor at run `run` of the leaf keyed `key` (a mention in a message), not the slot.
		props: {
			open: flag,
			anchorTo: value(Content.LeafAnchor),
			// Phase 4: `hover` opens after a delay over the anchor (a hover card) and asks to close on
			// leave through `dismiss`; the renderer owns the delay.
			trigger: option(O.PopoverTrigger, "press"),
		},
		slots: ["anchor"],
		events: { dismiss: none },
	}),
	toast: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "none",
		props: {
			open: flag,
			tone: option(O.BadgeTone, "neutral"),
			title: text,
			description: text,
			// Phase 4: today's `loading` toast (a spinner; it stays until replaced).
			loading: flag,
		},
		slots: ["action"],
		events: { dismiss: none },
	}),
	tooltip: tag({ group: "overlays", web: "A3", ios: "S3", content: "elements", props: { label: text } }),
	// The system-like emoji picker; the GIF picker is a web extension (`extensions/GifPicker.ts`).
	emojiPicker: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "none",
		// The screen's set (custom emojis with their images, the recently used first); none draws a
		// small built-in set. `loading` shows a spinner, `error` says why with a retry (`retry`).
		props: {
			open: flag,
			categories: value(Schema.Array(Content.EmojiCategory)),
			loading: flag,
			error: text,
		},
		events: { select: Schema.Struct({ emoji: Schema.String }), dismiss: none, retry: none },
	}),

	// Phase 4: the command palette (`overlay/command-palette`): a query field over grouped results.
	// The screen filters; the palette moves the highlight and reports the pick. `back` leaves a
	// form page; the page's own content is the children.
	commandPalette: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		props: {
			open: flag,
			placeholder: text,
			query: controlled(TextField.State),
			groups: value(Content.PaletteGroups),
			loading: flag,
			empty: text,
			title: text,
		},
		events: {
			change: TextField.ChangePayload,
			select: ids,
			back: none,
			dismiss: none,
		},
		commands: ["focus"],
	}),
	// Phase 4: the full-screen image and video viewer (`chat/image-viewer.ts`): zoom, pan, swipe and
	// the thumbnail strip are the renderer's; `entries` is its menu (download, copy, open).
	lightbox: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "none",
		props: {
			open: flag,
			items: value(Schema.Array(Content.Attachment)),
			index: count,
			entries: value(Content.MenuGroups),
		},
		events: { change: Schema.Struct({ index: Schema.Finite }), select: ids, dismiss: none },
	}),

	// Structure
	screen: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		// `surface`: the sidebar's column, or a phone tab's page (`screen-surface`).
		props: {
			title: text,
			back: flag,
			surface: option(O.ScreenSurface, "sidebar"),
			// Phase 4: a line under the title; breadcrumbs over it (`crumb` reports the one pressed).
			subtitle: text,
			crumbs: value(Schema.Array(Content.Crumb)),
		},
		// `floatingAction`: the screen's primary action, a round button over the content's end corner.
		// Phase 4: `aside` is `centered`'s brand panel beside the card (regular size class only);
		// `meta` holds badges after the title; `leading` a mark over the title in `centered` (an
		// invitation's workspace logo, `p4-avatar-xl`), elsewhere at the content's start.
		slots: ["toolbar", "floatingAction", "aside", "meta", "leading"],
		events: { back: none, crumb: Schema.Struct({ index: Schema.Finite }) },
	}),
	navigation: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		events: { pop: Schema.Struct({ depth: Schema.Finite }) },
	}),
	tabBar: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		props: {
			tabs: value(Schema.Array(Content.Tab)),
			selected: text,
			// Phase 4: in-page tabs, and tabs the user drags to reorder (saved views).
			style: option(O.TabBarStyle, "app"),
			reorderable: flag,
			// Below today's `md` a `page` bar is a native select (`p4-mobile-select-tabs`); web only.
			collapse: flag,
		},
		events: { change: ids, move },
	}),
	splitView: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		// Phase 4: `rail` is an icon column before the sidebar; `detail` a side panel after the
		// content (a thread, the assistant, a preview), `resizable` by its edge, which reports
		// `resize`; a sheet on the compact size class.
		// G2: the edge's name (`resizeLabel`), the panel's limits (0: the renderer's 320, 1200 and 400),
		// a compact leading sheet for the sidebar (`sidebarSheet`, shown while `sidebarOpen`), and the
		// sheets' own dismissals (a scrim tap, a swipe, Escape).
		props: {
			sidebarCollapsed: flag,
			detailWidth: count,
			resizable: flag,
			resizeLabel: text,
			detailMin: count,
			detailMax: count,
			contentMin: count,
			sidebarSheet: flag,
			sidebarOpen: flag,
		},
		slots: ["sidebar", "rail", "detail"],
		events: {
			resize: Schema.Struct({ width: Schema.Finite }),
			dismissSidebar: none,
			dismissDetail: none,
		},
	}),
	section: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		// Header actions: `.action(icon, message, label)` appends an `hz:action` (`Hazel.ts`).
		props: {
			title: text,
			collapsible: flag,
			collapsed: flag,
			reorderable: flag,
			// Its header's look (`section-style`): a sidebar's group, the channel tree's, a phone list's, the inbox's.
			style: option(O.SectionStyle, "sidebar"),
		},
		events: { toggle: Schema.Struct({ collapsed: Schema.Boolean }), move },
	}),
	item: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		props: {
			title: text,
			subtitle: text,
			badge: count,
			emphasized: flag,
			selected: flag,
			disabled: flag,
			// Dimmed but still pressable (a muted channel, a discover row).
			muted: flag,
			nested: option(O.ItemNesting, "none"),
			// An unread mark at the row's start: the sidebar's edge `pip` or activity's brand `dot`.
			unread: option(O.ItemUnreadMark, "none"),
			titleLines: option(O.LineCount, "1"),
			subtitleLines: option(O.LineCount, "1"),
			// `large`: a 40pt avatar or icon tile leads the row, top aligned.
			leadingSize: option(O.ItemLeadingSize, "regular"),
			// `switcher` and `account`: a sidebar's org switcher and account card (`p4-sidebar-account-card`).
			style: option(O.ItemStyle, "row"),
			// A keyboard shortcut hint at the row's end; web only, iOS ignores it.
			shortcut: text,
			href: text,
		},
		// `actions`: controls shown on hover or focus within (always on touch), after `trailing`; they
		// never grow the row (`item-hover-trailing`, `item-hover-action`).
		slots: ["leading", "trailing", "actions"],
		events: { press: none, longPress: none },
		commands: ["scrollTo"],
	}),

	// Phase 4: a label and its value (`detail/parts.ts` `property`, a `dl` row); the value is the
	// children (text, a badge, a link). Inside a `section` or `frame`, rows align their labels.
	property: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		// `justified` (`pk0-facts`): one row, the value at its end (customers' evidence facts).
		props: { label: text, description: text, style: option(O.PropertyStyle, "column") },
	}),
	// Phase 4: a header that shows or hides its children (`ui/thought-line.ts`, customers'
	// `disclosure`, a reasoning step); `running` marks work in progress.
	disclosure: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		// `icon` (`disclosure-glyph`): the thought line's glyph leads and the chevron trails it.
		props: {
			title: text,
			subtitle: text,
			open: flag,
			running: flag,
			icon: value(O.IconName),
			tone: option(O.DisclosureTone, "default"),
		},
		slots: ["trailing"],
		events: { toggle: Schema.Struct({ open: Schema.Boolean }) },
	}),
	// Phase 4: where a wizard is (onboarding's "Step 2 of 6" and its segments).
	stepper: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "none",
		props: { steps: count, current: count, label: text },
	}),
	// Phase 4: a bar over the page's bottom edge while `open`: the bulk actions for a selection,
	// unsaved changes. `label` says what it acts on; `dismiss` is its close (clear the selection).
	actionBar: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "none",
		props: { open: flag, label: text },
		slots: ["actions"],
		events: { dismiss: none },
	}),

	// Internal: what the builders compile slots and extensions to; never named in a screen.
	slot: tag({ group: "internal", web: "A1", ios: "S1", content: "elements", props: { name: text } }),
	action: tag({
		group: "internal",
		web: "A4",
		ios: "S4",
		content: "elements",
		// A press, or with `entries` a menu whose choice raises `select` (`section.action`).
		props: { label: text, entries: value(Content.MenuGroups) },
		events: { press: none, select: ids },
	}),
	ext: tag({
		group: "internal",
		web: "A1",
		ios: "S0",
		content: "elements",
		props: { ext: text, args: value(Schema.Unknown) },
		slots: ["fallback"],
	}),
} as const satisfies Readonly<Record<string, TagSpec>>

export type Tags = typeof tags
export type TagKey = keyof Tags
/** The runtime tag, `hz:<key>`. */
export type TagName = `hz:${TagKey}`
export const tagName = <K extends TagKey>(key: K): `hz:${K}` => `hz:${key}`
export const tagKeys = Object.keys(tags) as ReadonlyArray<TagKey>

export const isTagKey = (key: string): key is TagKey => Object.hasOwn(tags, key)

/** `hz:button` to `button`; undefined for any other tag. */
export const keyOf = (name: string): TagKey | undefined => {
	const key = name.startsWith("hz:") ? name.slice(3) : ""
	return isTagKey(key) ? key : undefined
}

/** Tags whose `content` is `text`: what `textParents` lists. */
export const textTags: ReadonlyArray<TagName> = tagKeys
	.filter((key) => tags[key].content === "text")
	.map((key) => tagName(key))

/** The `controlled` props of a tag: the host's revision rule applies to them. */
export const controlledProps = (key: TagKey): ReadonlyArray<string> => {
	const props: Readonly<Record<string, PropSpec>> = tags[key].props
	return Object.keys(props).filter((name) => props[name]?.kind === "controlled")
}

/** What a renderer or command not written yet throws: what is missing and the lane that owns it. */
export class NotImplemented extends Schema.TaggedError<NotImplemented>()("NotImplemented", {
	what: Schema.String,
	lane: Schema.String,
}) {
	override get message() {
		return `${this.what} is not implemented yet: lane ${this.lane} owns it`
	}
}

/** The web renderer's lane for `hz:<key>`, as a `NotImplemented` to throw. */
export const notOnWeb = (key: TagKey) =>
	new NotImplemented({ what: `${tagName(key)} on the web`, lane: tags[key].web })
