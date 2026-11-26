// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * G7's message list, in the three windowing designs it compares:
 * - A: every loaded message as a tree of `hz:*` nodes (one `MessageRow` child component per message),
 *   native virtualizes.
 * - B: the same trees, but only a window of entries around what native reports it shows.
 * - C: every loaded message as one `hz:message` leaf whose `row` prop is compact data; native lays out.
 *   `S` is C with the row pre-serialized, so native's generic decode sees one string per row.
 */
import { UiSchema } from "@effect/ui"
import { Schema } from "effect"
import type { BenchCommand, H } from "./chat.ts"
import * as Chat from "./chat.ts"
import { type Message, me, messages } from "./fixture.ts"
import { BlockKind, type Run } from "./rich-text.ts"
import { type Entry, entries, type Row } from "./rows.ts"

/** `S` is C with each row as one JSON string prop (`rowJson`): the compact-encoding experiment. */
export const Option = Schema.Literals(["A", "B", "C", "S"])
export type Option = typeof Option.Type

export const ListMessage = UiSchema.TaggedEnum({
	ReachedStart: {},
	Viewport: { first: Schema.Finite, last: Schema.Finite },
	Bench: { command: Schema.Any },
})

export const ListProps = Schema.Struct({
	option: Option,
	/** Messages in the channel. */
	total: Schema.Finite,
	/** Loaded at mount, the newest. */
	initial: Schema.Finite,
	/** Older messages loaded per `reachStart`. */
	page: Schema.Finite,
	/** B: entries rendered either side of the viewport. */
	pad: Schema.Finite,
})
export type ListProps = typeof ListProps.Type

const runNode = <Msg>(h: H<Msg>, run: Run) =>
	typeof run === "string" ? h.run.children(run) : h.run.set({ kind: run[0], arg: run[2] }).children(run[1])

/** A message's subtree for A and B: slots, rich text blocks and runs, reactions, attachments. */
export const rowTree = <Msg>(h: H<Msg>, row: Row) =>
	h.message.set({ grouped: row.g === 1 ? true : undefined }).children(
		row.g === 1 ? null : h.slot.set({ name: "avatar" }).children(h.avatar.initials(row.i ?? "")),
		row.g === 1 ? null : h.slot.set({ name: "author" }).children(h.label.strong().children(row.a ?? "")),
		h.slot.set({ name: "time" }).children(h.label.role("caption").tone("muted").children(row.t)),
		h.slot.set({ name: "body" }).children(
			h.richText.children(
				...row.b.map((block) =>
					block[0] === BlockKind.code
						? h.codeBlock.set({ language: block[2] }).children(block[1])
						: h.paragraph
								.set({ marker: block[0] === BlockKind.item ? block[2] : undefined })
								.children(...block[1].map((run) => runNode(h, run))),
				),
			),
		),
		row.m === undefined
			? null
			: h.slot
					.set({ name: "attachments" })
					.children(
						h.attachmentGrid.children(...row.m.map(([width, height]) => h.image.set({ width, height }))),
					),
		row.r === undefined
			? null
			: h.slot.set({ name: "reactions" }).children(
					h.reactionBar.children(
						...row.r.map(([emoji, count, mine]) =>
							h.reaction.key(emoji).set({ emoji, count, mine: mine === 1 ? true : undefined }),
						),
					),
				),
	)

export const MessageRow = Chat.component({
	name: "MessageRow",
	props: Schema.Struct({ row: Schema.Any }),
	model: Schema.Struct({}),
	message: UiSchema.TaggedEnum({ Noop: {} }),
}).make({
	init: () => ({}),
	update: { Noop: ($) => $.model },
	view: (h) => rowTree(h, h.props.row as Row),
})

/** C and S: one builder per row object, so re-rendering the list allocates nothing for unchanged rows. */
const leaves = new WeakMap<Row, unknown>()
const leaf = <Msg>(h: H<Msg>, key: string, row: Row, json: boolean) => {
	const hit = leaves.get(row)
	if (hit !== undefined) return hit as ReturnType<H<Msg>["message"]["key"]>
	const made = h.message.key(key).set(json ? { rowJson: JSON.stringify(row) } : { row: row as never })
	leaves.set(row, made)
	return made
}

const divider = <Msg>(h: H<Msg>, entry: Entry) =>
	entry.kind === "date"
		? h.listDivider.key(entry.key).set({ kind: "date", label: entry.label })
		: h.listDivider.key(entry.key).set({ kind: "unread" })

const toggleThumb = (message: Message): Message => {
	const thumb = message.reactions.find((r) => r.emoji === "👍")
	const others = message.reactions.filter((r) => r !== thumb)
	const users = thumb === undefined ? [me.id] : thumb.users.includes(me.id) ? thumb.users.filter((u) => u !== me.id) : [...thumb.users, me.id]
	return { ...message, reactions: users.length === 0 ? others : [...others, { emoji: "👍", users }] }
}

export const MessageList = Chat.component({
	name: "MessageList",
	props: ListProps,
	model: Schema.Struct({
		messages: Schema.Array(Schema.Any),
		/** Index of the oldest loaded message, and of the next new one. */
		first: Schema.Finite,
		next: Schema.Finite,
		/** B: the window, as entry indices counted from the newest (native's inverted order). */
		from: Schema.Finite,
		to: Schema.Finite,
		unreadAfter: Schema.String,
	}),
	message: ListMessage,
}).make({
	init: ({ props }) => {
		const first = Math.max(0, props.total - props.initial)
		return {
			messages: messages(first, props.total, props.total),
			first,
			next: props.total,
			from: 0,
			to: props.pad * 2,
			unreadAfter: `m${(props.total - 13).toString().padStart(6, "0")}`,
		}
	},
	update: {
		ReachedStart: ($) => {
			if ($.model.first === 0) return $.model
			const first = Math.max(0, $.model.first - $.props.page)
			return $.evolve({
				first,
				messages: (loaded) => [...messages(first, $.model.first, $.props.total), ...loaded],
			})
		},
		Viewport: ($, { first, last }) => {
			const { from, to } = $.model
			const pad = $.props.pad
			// Re-centre only when the viewport nears an edge of the window.
			if (first - from >= pad / 4 && to - last >= pad / 4) return $.model
			return $.evolve({ from: Math.max(0, first - pad), to: last + pad })
		},
		Bench: ($, { command }) => {
			const cmd = command as BenchCommand
			if (cmd.kind === "new") {
				return $.evolve({
					next: (n) => n + 1,
					messages: (loaded) => [...loaded, messages($.model.next, $.model.next + 1, $.props.total)[0]],
				})
			}
			if (cmd.kind === "react") {
				return $.evolve({
					messages: (loaded) => loaded.map((m: Message) => (m.id === cmd.id ? toggleThumb(m) : m)),
				})
			}
			const first = Math.max(0, $.model.first - $.props.page)
			if (first === $.model.first) return $.model
			return $.evolve({
				first,
				messages: (loaded) => [...messages(first, $.model.first, $.props.total), ...loaded],
			})
		},
	},
	view: (h, model) => {
		const all = entries(model.messages as ReadonlyArray<Message>, model.unreadAfter)
		const option = h.props.option
		// B renders entries [length - to, length - from); A and C render them all.
		const start = option === "B" ? Math.max(0, all.length - model.to) : 0
		const end = option === "B" ? Math.max(start, all.length - model.from) : all.length
		const shown = start === 0 && end === all.length ? all : all.slice(start, end)
		return h.list
			.set({
				stickToBottom: true,
				total: option === "B" ? all.length : undefined,
				// B: index, from the newest, of the last child (the newest rendered).
				offset: option === "B" ? all.length - end : undefined,
			})
			.on("reachStart", ListMessage.ReachedStart())
			.on("viewport", ({ first, last }) => ListMessage.Viewport({ first, last }))
			.on("bench", (command) => ListMessage.Bench({ command }))
			.children(
				...shown.map((entry) =>
					entry.kind !== "message"
						? divider(h, entry)
						: option === "C" || option === "S"
							? leaf(h, entry.key, entry.row, option === "S")
							: MessageRow(h, { key: entry.key, props: { row: entry.row } }),
				),
			)
	},
})
