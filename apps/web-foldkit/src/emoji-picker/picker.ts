import { Effect, Match, Option, Queue, Result, Schema, Stream } from "effect"
import { AsyncData, Command, Mount, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { formatCustomEmojiKey } from "~/lib/custom-emoji-utils"
import { CommonReason } from "~/lib/error-messages"
import { catchCommon } from "../data/actions"
import { EmojiData, loadEmojiData, type PickerData, type PickerEmoji, pickerDataOf } from "./data"

/**
 * A Foldkit port of frimousse's `EmojiPicker` (Root, Search, Viewport, List, ActiveEmoji): the
 * store becomes this Model, the virtualized range is derived in the view, and a Mount measures
 * the sizers and viewport and reports scrolling, as frimousse's layout effects do.
 */

export const COLUMNS = 9
const VIEWPORT_OVERSCAN = 2

// MODEL

export const Interaction = Schema.Literals(["None", "Keyboard", "Pointer"])
export type Interaction = typeof Interaction.Type

/** Loading the dataset fails only for the shared reasons (the CDN is a plain HTTP fetch). */
export const LoadEmojiDataFailure = CommonReason
export type LoadEmojiDataFailure = typeof LoadEmojiDataFailure.Type

export const EmojiDataAsync = AsyncData.Schema(EmojiData, LoadEmojiDataFailure)

export const Model = Schema.Struct({
	id: Schema.String,
	data: EmojiDataAsync.schema,
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

/** A picker with nothing requested yet; `loadData` (or the parent's `LoadEmojiData`) fetches the dataset. */
export const init = (id: string): Model => ({
	id,
	data: AsyncData.Idle(),
	search: "",
	interaction: "None",
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
	FailedLoadEmojiData: { reason: LoadEmojiDataFailure },
	ClickedRetryLoadEmojiData: {},
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
		catchCommon((reason) => Message.FailedLoadEmojiData({ reason })),
	),
})

// DERIVED

export const pickerData = (model: Model): PickerData | null =>
	Option.match(AsyncData.getData(model.data), {
		onNone: () => null,
		onSome: (data) => pickerDataOf(data, COLUMNS, model.search),
	})

/** `$isLoading`: no dataset yet (and no failure to show), or the sizers are not measured. */
export const isLoading = (model: Model) =>
	AsyncData.matchData(model.data, {
		onEmpty: () => true,
		onFailure: () => false,
		onData: () =>
			model.viewportHeight === null || model.rowHeight === null || model.categoryHeaderHeight === null,
	})

/** `$activeEmoji`. */
export const activeEmoji = (model: Model): PickerEmoji | null =>
	model.interaction === "None"
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
		(category, index) =>
			index * categoryHeaderHeight + category.startRowIndex * rowHeight < model.scrollTop,
	).length
	const totalHeight = data.categories.length * categoryHeaderHeight + data.rows.length * rowHeight
	const startY = Math.min(
		model.scrollTop -
			previousHeaders * categoryHeaderHeight -
			Math.floor((VIEWPORT_OVERSCAN * rowHeight) / 2),
		totalHeight - viewportHeight,
	)
	const endY = startY + viewportHeight + Math.ceil((VIEWPORT_OVERSCAN * rowHeight) / 2)
	return {
		startRowIndex: Math.max(0, Math.floor(startY / rowHeight)),
		endRowIndex: Math.min(data.rows.length - 1, Math.ceil(endY / rowHeight)),
	}
}

/** The keys the picker root handles (frimousse's document keydown while focus is inside). */
export const isNavigationKey = (key: string) => key.startsWith("Arrow") || key === "Enter"

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

/** Start (or restart) loading the dataset. */
export const loadData = (model: Model): Update.Return<Model, Message> => ({
	model: modifyFields(model, { data: () => AsyncData.Loading() }),
	commands: [LoadEmojiData()],
})

const withActive = (
	model: Model,
	interaction: Interaction,
	activeRowIndex: number,
	activeColumnIndex: number,
): Model =>
	modifyFields(model, {
		interaction: () => interaction,
		activeRowIndex: () => activeRowIndex,
		activeColumnIndex: () => activeColumnIndex,
	})

const resetActive = (model: Model): Model => withActive(model, "None", 0, 0)

interface Position {
	readonly row: number
	readonly column: number
}

/** frimousse's arrow-key movement across rows and columns. */
const movedPosition = (
	rows: ReadonlyArray<PickerData["rows"][number]>,
	{ row, column }: Position,
	key: string,
): Position => {
	const previous = rows[row - 1]
	const next = rows[row + 1]
	const lastColumnOf = (target: PickerData["rows"][number]) => target.emojis.length - 1
	return Match.value(key).pipe(
		Match.when("ArrowLeft", (): Position => {
			if (column > 0) return { row, column: column - 1 }
			return previous ? { row: row - 1, column: lastColumnOf(previous) } : { row, column }
		}),
		Match.when("ArrowRight", (): Position => {
			if (column < (rows[row]?.emojis.length ?? 1) - 1) return { row, column: column + 1 }
			return next ? { row: row + 1, column: 0 } : { row, column }
		}),
		Match.when("ArrowUp", (): Position =>
			previous
				? { row: row - 1, column: previous.emojis[column] ? column : lastColumnOf(previous) }
				: { row, column },
		),
		Match.when("ArrowDown", (): Position =>
			next
				? { row: row + 1, column: next.emojis[column] ? column : lastColumnOf(next) }
				: { row, column },
		),
		Match.orElse((): Position => ({ row, column })),
	)
}

const moveActive = (model: Model, key: string): Model => {
	const rows = pickerData(model)?.rows ?? []
	if (model.interaction === "None" || rows.length === 0) return withActive(model, "Keyboard", 0, 0)
	const { row, column } = movedPosition(
		rows,
		{ row: model.activeRowIndex, column: model.activeColumnIndex },
		key,
	)
	return withActive(model, "Keyboard", row, column)
}

const select = (model: Model, emoji: PickerEmoji | null): Return =>
	emoji === null
		? { model }
		: {
				model,
				outMessage: OutMessage.SelectedEmoji({
					emoji: emoji.emoji,
					label: emoji.label,
					imageUrl: null,
				}),
			}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		// `onDataChange` resets the active emoji.
		SucceededLoadEmojiData: ({ data }) => ({
			model: modifyFields(withActive(model, model.interaction, 0, 0), {
				data: () => AsyncData.Success({ data }),
			}),
		}),
		FailedLoadEmojiData: ({ reason }) => ({
			model: modifyFields(model, {
				data: (previous) => AsyncData.settle(previous, Result.fail(reason)),
			}),
		}),
		ClickedRetryLoadEmojiData: () => loadData(model),
		UpdatedSearch: ({ search }) => ({
			model: modifyFields(withActive(model, search ? "Keyboard" : "None", 0, 0), {
				search: () => search,
			}),
		}),
		MeasuredPicker: ({ rowHeight, categoryHeaderHeight, viewportWidth, viewportHeight }) => ({
			model: modifyFields(model, {
				rowHeight: () => rowHeight,
				categoryHeaderHeight: () => categoryHeaderHeight,
				viewportWidth: () => viewportWidth,
				viewportHeight: () => viewportHeight,
			}),
		}),
		ScrolledViewport: ({ scrollTop }) => ({ model: modifyFields(model, { scrollTop: () => scrollTop }) }),
		FocusedSearch: () => ({
			model: modifyFields(model, {
				isFocusedWithin: () => true,
				interaction: (interaction) => (model.search === "" ? "None" : interaction),
			}),
		}),
		FocusedViewport: () => ({
			model: modifyFields(withActive(model, "Keyboard", 0, 0), { isFocusedWithin: () => true }),
		}),
		BlurredPicker: () => ({ model: resetActive(modifyFields(model, { isFocusedWithin: () => false })) }),
		PressedNavigationKey: ({ key }) =>
			key === "Enter" ? select(model, activeEmoji(model)) : { model: moveActive(model, key) },
		HoveredEmoji: ({ rowIndex, columnIndex }) => ({
			model: withActive(model, "Pointer", rowIndex, columnIndex),
		}),
		UnhoveredEmoji: () => ({ model: resetActive(model) }),
		ClickedEmoji: ({ rowIndex, columnIndex }) =>
			select(model, pickerData(model)?.rows[rowIndex]?.emojis[columnIndex] ?? null),
		ClickedCustomEmoji: ({ name, imageUrl }) => ({
			model,
			outMessage: OutMessage.SelectedEmoji({
				emoji: formatCustomEmojiKey(name),
				label: name,
				imageUrl,
			}),
		}),
	})

// MOUNT

type MeasureMessage = typeof Message.MeasuredPicker.Type | typeof Message.ScrolledViewport.Type
type FocusOutMessage = typeof Message.BlurredPicker.Type

/** The viewport's and its sizers' sizes (ResizeObserver) and the viewport's scroll position. */
export const MeasurePicker = Mount.defineStream("MeasurePicker", {
	messages: [Message.MeasuredPicker, Message.ScrolledViewport],
	execute: ({ element: viewport }) =>
		Stream.callback<MeasureMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const row = viewport.querySelector<HTMLElement>("[frimousse-row-sizer]")
					const header = viewport.querySelector<HTMLElement>("[frimousse-category-header-sizer]")
					if (!(viewport instanceof HTMLElement) || !row || !header) return () => undefined
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
					const onScroll = () =>
						Queue.offerUnsafe(queue, Message.ScrolledViewport({ scrollTop: viewport.scrollTop }))
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

/** frimousse's blur capture: focus leaving the picker root resets the active emoji. */
export const TrackPickerFocusOut = Mount.defineStream("TrackPickerFocusOut", {
	messages: [Message.BlurredPicker],
	execute: ({ element }) =>
		Stream.callback<FocusOutMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const onFocusOut = (event: Event) => {
						const related = event instanceof FocusEvent ? event.relatedTarget : null
						if (!(related instanceof Node) || !element.contains(related))
							Queue.offerUnsafe(queue, Message.BlurredPicker())
					}
					element.addEventListener("focusout", onFocusOut)
					return () => element.removeEventListener("focusout", onFocusOut)
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})
