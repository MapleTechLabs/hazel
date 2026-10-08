import { Effect, Match, Queue, Schema, Stream } from "effect"
import { Command, Mount, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { formatCustomEmojiKey } from "~/lib/custom-emoji-utils"
import { EmojiData, loadEmojiData, type PickerData, type PickerEmoji, pickerDataOf } from "./data"

/**
 * A Foldkit port of frimousse's `EmojiPicker` (Root, Search, Viewport, List, ActiveEmoji): the
 * store becomes this Model, the virtualized range is derived in the view, and a Mount measures
 * the sizers and viewport and reports scrolling, as frimousse's layout effects do.
 */

export const COLUMNS = 9
const VIEWPORT_OVERSCAN = 2

// MODEL

export const Interaction = Schema.Literals(["none", "keyboard", "pointer"])

export const Model = Schema.Struct({
	id: Schema.String,
	data: Schema.NullOr(EmojiData),
	search: Schema.String,
	interaction: Interaction,
	activeColumnIndex: Schema.Number,
	activeRowIndex: Schema.Number,
	isFocusedWithin: Schema.Boolean,
	rowHeight: Schema.NullOr(Schema.Number),
	categoryHeaderHeight: Schema.NullOr(Schema.Number),
	viewportWidth: Schema.NullOr(Schema.Number),
	viewportHeight: Schema.NullOr(Schema.Number),
	scrollTop: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (id: string): Model => ({
	id,
	data: null,
	search: "",
	interaction: "none",
	activeColumnIndex: 0,
	activeRowIndex: 0,
	isFocusedWithin: false,
	rowHeight: null,
	categoryHeaderHeight: null,
	viewportWidth: null,
	viewportHeight: null,
	scrollTop: 0,
})

// MESSAGE

export const Message = defineMessageUnion({
	SucceededLoadEmojiData: { data: EmojiData },
	FailedLoadEmojiData: {},
	UpdatedSearch: { search: Schema.String },
	MeasuredPicker: {
		rowHeight: Schema.Number,
		categoryHeaderHeight: Schema.Number,
		viewportWidth: Schema.Number,
		viewportHeight: Schema.Number,
	},
	ScrolledViewport: { scrollTop: Schema.Number },
	FocusedSearch: {},
	FocusedViewport: {},
	BlurredPicker: {},
	PressedNavigationKey: { key: Schema.String },
	HoveredEmoji: { rowIndex: Schema.Number, columnIndex: Schema.Number },
	UnhoveredEmoji: {},
	ClickedEmoji: { rowIndex: Schema.Number, columnIndex: Schema.Number },
	ClickedCustomEmoji: { name: Schema.String, imageUrl: Schema.String },
})
export type Message = typeof Message.Type

/** `onEmojiSelect`: `{ emoji, label }`, plus `imageUrl` for the dialog's custom emojis. */
export const OutMessage = defineMessageUnion({
	SelectedEmoji: { emoji: Schema.String, label: Schema.String, imageUrl: Schema.NullOr(Schema.String) },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const LoadEmojiData = Command.define("LoadEmojiData", {
	messages: [Message.SucceededLoadEmojiData, Message.FailedLoadEmojiData],
	execute: loadEmojiData().pipe(
		Effect.map((data) => Message.SucceededLoadEmojiData({ data })),
		Effect.catchCause(() => Effect.succeed(Message.FailedLoadEmojiData())),
	),
})

// DERIVED

export const pickerData = (model: Model): PickerData | null =>
	model.data === null ? null : pickerDataOf(model.data, COLUMNS, model.search)

/** `$isLoading`. */
export const isLoading = (model: Model) =>
	model.data === null || model.viewportHeight === null || model.rowHeight === null || model.categoryHeaderHeight === null

/** `$activeEmoji`. */
export const activeEmoji = (model: Model): PickerEmoji | null =>
	model.interaction === "none"
		? null
		: (pickerData(model)?.rows[model.activeRowIndex]?.emojis[model.activeColumnIndex] ?? null)

export interface ViewportRange {
	readonly startRowIndex: number
	readonly endRowIndex: number
}

/** `updateViewportState`: the rendered rows, with frimousse's overscan and header arithmetic. */
export const viewportRange = (model: Model, data: PickerData): ViewportRange => {
	const { rowHeight, categoryHeaderHeight, viewportHeight } = model
	if (data.rows.length === 0 || !categoryHeaderHeight || !rowHeight || !viewportHeight)
		return { startRowIndex: 0, endRowIndex: 0 }
	const previousHeaders = data.categories.filter(
		(category, index) => index * categoryHeaderHeight + category.startRowIndex * rowHeight < model.scrollTop,
	).length
	const totalHeight = data.categories.length * categoryHeaderHeight + data.rows.length * rowHeight
	const startY = Math.min(
		model.scrollTop - previousHeaders * categoryHeaderHeight - Math.floor((VIEWPORT_OVERSCAN * rowHeight) / 2),
		totalHeight - viewportHeight,
	)
	const endY = startY + viewportHeight + Math.ceil((VIEWPORT_OVERSCAN * rowHeight) / 2)
	return {
		startRowIndex: Math.max(0, Math.floor(startY / rowHeight)),
		endRowIndex: Math.min(data.rows.length - 1, Math.ceil(endY / rowHeight)),
	}
}

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const resetActive = (model: Model): Model => ({ ...model, interaction: "none", activeColumnIndex: 0, activeRowIndex: 0 })

/** frimousse's arrow-key movement across rows and columns. */
const moveActive = (model: Model, key: string): Model => {
	const rows = pickerData(model)?.rows ?? []
	if (model.interaction === "none" || rows.length === 0)
		return { ...model, interaction: "keyboard", activeColumnIndex: 0, activeRowIndex: 0 }
	let column = model.activeColumnIndex
	let row = model.activeRowIndex
	const previous = rows[row - 1]
	const next = rows[row + 1]
	Match.value(key).pipe(
		Match.when("ArrowLeft", () => {
			if (column > 0) column -= 1
			else if (previous) [row, column] = [row - 1, previous.emojis.length - 1]
		}),
		Match.when("ArrowRight", () => {
			if (column < (rows[row]?.emojis.length ?? 1) - 1) column += 1
			else if (next) [row, column] = [row + 1, 0]
		}),
		Match.when("ArrowUp", () => {
			if (previous) [row, column] = [row - 1, previous.emojis[column] ? column : previous.emojis.length - 1]
		}),
		Match.when("ArrowDown", () => {
			if (next) [row, column] = [row + 1, next.emojis[column] ? column : next.emojis.length - 1]
		}),
		Match.orElse(() => undefined),
	)
	return { ...model, interaction: "keyboard", activeColumnIndex: column, activeRowIndex: row }
}

const select = (model: Model, emoji: PickerEmoji | null): Return =>
	emoji === null
		? { model }
		: { model, outMessage: OutMessage.SelectedEmoji({ emoji: emoji.emoji, label: emoji.label, imageUrl: null }) }

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		// `onDataChange` resets the active emoji.
		SucceededLoadEmojiData: ({ data }) => ({ model: { ...model, data, activeColumnIndex: 0, activeRowIndex: 0 } }),
		FailedLoadEmojiData: () => ({ model }),
		UpdatedSearch: ({ search }) => ({
			model: { ...model, search, interaction: search ? "keyboard" : "none", activeColumnIndex: 0, activeRowIndex: 0 },
		}),
		MeasuredPicker: (measured) => ({ model: { ...model, ...measured } }),
		ScrolledViewport: ({ scrollTop }) => ({ model: { ...model, scrollTop } }),
		FocusedSearch: () => ({
			model: { ...model, isFocusedWithin: true, interaction: model.search === "" ? "none" : model.interaction },
		}),
		FocusedViewport: () => ({
			model: { ...model, isFocusedWithin: true, interaction: "keyboard", activeColumnIndex: 0, activeRowIndex: 0 },
		}),
		BlurredPicker: () => ({ model: resetActive({ ...model, isFocusedWithin: false }) }),
		PressedNavigationKey: ({ key }) => (key === "Enter" ? select(model, activeEmoji(model)) : { model: moveActive(model, key) }),
		HoveredEmoji: ({ rowIndex, columnIndex }) => ({
			model: { ...model, interaction: "pointer", activeRowIndex: rowIndex, activeColumnIndex: columnIndex },
		}),
		UnhoveredEmoji: () => ({ model: resetActive(model) }),
		ClickedEmoji: ({ rowIndex, columnIndex }) =>
			select(model, pickerData(model)?.rows[rowIndex]?.emojis[columnIndex] ?? null),
		ClickedCustomEmoji: ({ name, imageUrl }) => ({
			model,
			outMessage: OutMessage.SelectedEmoji({ emoji: formatCustomEmojiKey(name), label: name, imageUrl }),
		}),
	})

// MOUNT

type MeasureMessage = typeof Message.MeasuredPicker.Type | typeof Message.ScrolledViewport.Type
type KeyMessage = typeof Message.PressedNavigationKey.Type | typeof Message.BlurredPicker.Type

/** The sizers' and viewport's sizes (ResizeObserver) and the viewport's scroll position. */
export const MeasurePicker = Mount.defineStream("MeasurePicker", {
	messages: [Message.MeasuredPicker, Message.ScrolledViewport],
	execute: ({ element }) =>
		Stream.callback<MeasureMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const query = (selector: string) => element.querySelector<HTMLElement>(selector)
					const viewport = query("[frimousse-viewport]")
					const row = query("[frimousse-row-sizer]")
					const header = query("[frimousse-category-header-sizer]")
					if (!viewport || !row || !header) return () => undefined
					const measure = () =>
						Queue.offerUnsafe(
							queue,
							Message.MeasuredPicker({
								rowHeight: row.clientHeight,
								categoryHeaderHeight: header.clientHeight,
								viewportWidth: viewport.offsetWidth,
								viewportHeight: viewport.clientHeight,
							}),
						)
					const observer = new ResizeObserver(measure)
					observer.observe(viewport)
					observer.observe(row)
					observer.observe(header)
					measure()
					const onScroll = () => Queue.offerUnsafe(queue, Message.ScrolledViewport({ scrollTop: viewport.scrollTop }))
					viewport.addEventListener("scroll", onScroll, { passive: true })
					return () => {
						observer.disconnect()
						viewport.removeEventListener("scroll", onScroll)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

/** frimousse's document keydown while focus is inside the picker, and its blur-capture. */
export const TrackPickerKeys = Mount.defineStream("TrackPickerKeys", {
	messages: [Message.PressedNavigationKey, Message.BlurredPicker],
	execute: ({ element: wrapper }) =>
		Stream.callback<KeyMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const element = wrapper.closest<HTMLElement>("[frimousse-root]") ?? (wrapper as HTMLElement)
					const onKeyDown = (event: KeyboardEvent) => {
						if (event.defaultPrevented || !element.contains(document.activeElement)) return
						if (!event.key.startsWith("Arrow") && event.key !== "Enter") return
						event.preventDefault()
						Queue.offerUnsafe(queue, Message.PressedNavigationKey({ key: event.key }))
					}
					const onFocusOut = (event: FocusEvent) => {
						const related = event.relatedTarget
						if (!(related instanceof Node) || !element.contains(related))
							Queue.offerUnsafe(queue, Message.BlurredPicker())
					}
					document.addEventListener("keydown", onKeyDown)
					element.addEventListener("focusout", onFocusOut)
					return () => {
						document.removeEventListener("keydown", onKeyDown)
						element.removeEventListener("focusout", onFocusOut)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})
