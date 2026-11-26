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
		},
	}),
	spacer: tag({ group: "layout", web: "A1", ios: "S1", content: "none" }),
	scroll: tag({
		group: "layout",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: { axis: option(O.StackAxis, "vertical") },
		commands: ["scrollTo"],
	}),
	frame: tag({
		group: "layout",
		web: "A1",
		ios: "S1",
		content: "elements",
		props: { surface: option(O.FrameSurface, "card") },
	}),
	divider: tag({ group: "layout", web: "A1", ios: "S1", content: "none" }),

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
		},
	}),
	heading: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "text",
		props: { level: option(O.HeadingLevel, "2") },
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
		props: { name: value(O.IconName), tone: option(O.IconTileTone, "neutral") },
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
		},
	}),
	progress: tag({
		group: "content",
		web: "A1",
		ios: "S1",
		content: "none",
		// `value` 0 to 1; `indeterminate` when the amount is unknown.
		props: { value: count, indeterminate: flag, label: text },
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
		},
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
			action: Schema.Struct({ action: O.MessageAction }),
			pressAuthor: none,
			pressReaction: Schema.Struct({ emoji: Schema.String }),
			addReaction: none,
			pressMention: mention,
			pressLink: Schema.Struct({ url: Schema.String }),
			pressAttachment: ids,
			pressReply: none,
			pressThread: none,
			retry: none,
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
		props: { attachments: value(Schema.Array(Content.Attachment)), removable: flag },
		events: { press: ids, remove: ids },
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
		},
		events: { press: none },
		commands: ["focus"],
	}),
	link: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: { label: text, href: text },
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
		},
		events: textFieldEvents,
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
		props: { label: text, description: text, checked: flag, disabled: flag },
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
		},
		events: { change: Schema.Struct({ value: Schema.String }) },
	}),
	searchField: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: { placeholder: text, value: controlled(TextField.State) },
		events: { change: TextField.ChangePayload, submit: TextField.ChangePayload },
		commands: ["focus", "blur"],
	}),
	composer: tag({
		group: "controls",
		web: "A2",
		ios: "S2",
		content: "none",
		props: { placeholder: text, value: controlled(TextField.State), disabled: flag, canSend: flag },
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
		},
		commands: ["focus", "blur", "select"],
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
		props: { open: flag, title: text },
		events: { dismiss: none },
	}),
	dialog: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		props: { open: flag, title: text, description: text, destructive: flag },
		slots: ["actions"],
		events: { dismiss: none },
	}),
	popover: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "elements",
		// `anchorTo`: anchor at run `run` of the leaf keyed `key` (a mention in a message), not the slot.
		props: { open: flag, anchorTo: value(Content.LeafAnchor) },
		slots: ["anchor"],
		events: { dismiss: none },
	}),
	toast: tag({
		group: "overlays",
		web: "A3",
		ios: "S3",
		content: "none",
		props: { open: flag, tone: option(O.BadgeTone, "neutral"), title: text, description: text },
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
		props: { open: flag },
		events: { select: Schema.Struct({ emoji: Schema.String }), dismiss: none },
	}),

	// Structure
	screen: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		props: { title: text, back: flag },
		// `floatingAction`: the screen's primary action, a round button over the content's end corner.
		slots: ["toolbar", "floatingAction"],
		events: { back: none },
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
		props: { tabs: value(Schema.Array(Content.Tab)), selected: text },
		events: { change: ids },
	}),
	splitView: tag({ group: "structure", web: "A4", ios: "S4", content: "elements", slots: ["sidebar"] }),
	section: tag({
		group: "structure",
		web: "A4",
		ios: "S4",
		content: "elements",
		// Header actions: `.action(icon, message, label)` appends an `hz:action` (`Hazel.ts`).
		props: { title: text, collapsible: flag, collapsed: flag, reorderable: flag },
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
			// The trailing slot shows on hover or focus within (always on touch); it never grows the row.
			trailingOnHover: flag,
			// A keyboard shortcut hint at the row's end; web only, iOS ignores it.
			shortcut: text,
			href: text,
		},
		slots: ["leading", "trailing"],
		events: { press: none, longPress: none },
		commands: ["scrollTo"],
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
