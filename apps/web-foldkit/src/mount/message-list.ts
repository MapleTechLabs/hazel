import { Effect, Number as Num, Queue, Schema, Stream } from "effect"
import { Command, Mount, Render } from "foldkit"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

/**
 * Bottom-anchored virtual list for chat (the `@legendapp/list` replacement, plan §3.4).
 *
 * Rows are absolutely positioned from measured heights (estimates until measured), so a newly
 * rendered row never moves the rows in the viewport. A container Mount reports scroll, viewport
 * and row sizes; `update` keeps a stable-key viewport anchor and returns `ApplyScroll`, which
 * writes `scrollTop` after the next commit, in the same frame as the patch.
 */

// MODEL

/** What the viewport holds on to when rows or heights change. */
export const ViewportAnchor = defineTaggedUnion({
	End: {},
	Row: { key: Schema.String, viewportOffset: Schema.Number },
})
export type ViewportAnchor = typeof ViewportAnchor.Type

export const Model = Schema.Struct({
	id: Schema.String,
	estimatedRowHeightPx: Schema.Number,
	followThresholdPx: Schema.Number,
	keys: Schema.Array(Schema.String),
	/** Rows that never anchor the viewport (date dividers move with the first message of their day). */
	stickyKeys: Schema.Array(Schema.String),
	measuredHeights: Schema.Record(Schema.String, Schema.Number),
	viewportHeight: Schema.Number,
	scrollTop: Schema.Number,
	anchor: ViewportAnchor,
	/** Last `ApplyScroll` issued and last one completed; a scroll is pending while they differ. */
	scrollVersion: Schema.Number,
	appliedScrollVersion: Schema.Number,
	/** First and last rendered rows. Moved in chunks, so most scroll frames change no DOM. */
	renderedFromKey: Schema.NullOr(Schema.String),
	renderedToKey: Schema.NullOr(Schema.String),
	/**
	 * The divider drawn without its line. `@legendapp/list` only reports a new sticky header when it
	 * recalculates (data, layout, or rendering new rows), not on scrolls inside rendered rows.
	 */
	stuckKey: Schema.NullOr(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	ScrolledList: { scrollTop: Schema.Number },
	ResizedViewport: { viewportHeight: Schema.Number },
	MeasuredRows: {
		measurements: Schema.Array(Schema.Struct({ key: Schema.String, height: Schema.Number })),
	},
	CompletedApplyScroll: { version: Schema.Number, scrollTop: Schema.Number },
})
export type Message = typeof Message.Type

// INIT

export const init = (config: {
	readonly id: string
	readonly estimatedRowHeightPx: number
	readonly followThresholdPx?: number
}): Model => ({
	id: config.id,
	estimatedRowHeightPx: config.estimatedRowHeightPx,
	followThresholdPx: config.followThresholdPx ?? 1,
	keys: [],
	stickyKeys: [],
	measuredHeights: {},
	viewportHeight: 0,
	scrollTop: 0,
	anchor: ViewportAnchor.End(),
	scrollVersion: 0,
	appliedScrollVersion: 0,
	renderedFromKey: null,
	renderedToKey: null,
	stuckKey: null,
})

// LAYOUT

export interface Layout {
	/** `offsets[i]` is the top of row i inside the content box; `offsets[n]` is the total height. */
	readonly offsets: Float64Array
	readonly indexByKey: ReadonlyMap<string, number>
	readonly totalHeight: number
}

let lastLayoutInputs: readonly [unknown, unknown, number] | undefined
let lastLayout: Layout | undefined

/** Prefix sums over measured or estimated heights, memoized on the (frozen) inputs by reference. */
export const layoutOf = (model: Model): Layout => {
	if (
		lastLayout !== undefined &&
		lastLayoutInputs !== undefined &&
		lastLayoutInputs[0] === model.keys &&
		lastLayoutInputs[1] === model.measuredHeights &&
		lastLayoutInputs[2] === model.estimatedRowHeightPx
	)
		return lastLayout
	const { keys, measuredHeights, estimatedRowHeightPx } = model
	const offsets = new Float64Array(keys.length + 1)
	const indexByKey = new Map<string, number>()
	keys.forEach((key, index) => {
		indexByKey.set(key, index)
		offsets[index + 1] = offsets[index]! + (measuredHeights[key] ?? estimatedRowHeightPx)
	})
	const layout = { offsets, indexByKey, totalHeight: offsets[keys.length]! }
	lastLayoutInputs = [keys, measuredHeights, estimatedRowHeightPx]
	lastLayout = layout
	return layout
}

export const maxScrollTop = (model: Model, layout: Layout = layoutOf(model)) =>
	Math.max(0, layout.totalHeight - model.viewportHeight)

const clampScrollTop = (model: Model, layout: Layout, scrollTop: number) =>
	Math.max(0, Math.min(scrollTop, maxScrollTop(model, layout)))

/** Index of the row containing content offset `y` (first row whose bottom is below `y`). */
export const rowIndexAt = (layout: Layout, y: number): number => {
	const count = layout.offsets.length - 1
	let low = 0
	let high = count
	while (low < high) {
		const middle = (low + high) >>> 1
		if (layout.offsets[middle + 1]! > y) high = middle
		else low = middle + 1
	}
	return Math.min(low, Math.max(0, count - 1))
}

let lastStickyKeys: ReadonlyArray<string> | undefined
let lastStickySet: ReadonlySet<string> = new Set()
const stickySetOf = (model: Model) => {
	if (lastStickyKeys !== model.stickyKeys) {
		lastStickyKeys = model.stickyKeys
		lastStickySet = new Set(model.stickyKeys)
	}
	return lastStickySet
}

/** The anchor that describes `scrollTop`: the end when within the follow threshold, else the top non-sticky row. */
export const anchorAt = (model: Model, layout: Layout, scrollTop: number): ViewportAnchor => {
	const distanceFromEnd = layout.totalHeight - model.viewportHeight - scrollTop
	if (model.keys.length === 0 || distanceFromEnd <= model.followThresholdPx) return ViewportAnchor.End()
	const sticky = stickySetOf(model)
	let index = rowIndexAt(layout, scrollTop)
	while (index < model.keys.length - 1 && sticky.has(model.keys[index]!)) index++
	return ViewportAnchor.Row({ key: model.keys[index]!, viewportOffset: layout.offsets[index]! - scrollTop })
}

/** Where `scrollTop` has to be for the anchor to sit where it was observed. */
export const scrollTopForAnchor = (model: Model, layout: Layout, anchor: ViewportAnchor): number =>
	ViewportAnchor.match(anchor, {
		End: () => maxScrollTop(model, layout),
		Row: ({ key, viewportOffset }) => {
			const index = layout.indexByKey.get(key)
			return index === undefined
				? clampScrollTop(model, layout, model.scrollTop)
				: clampScrollTop(model, layout, layout.offsets[index]! - viewportOffset)
		},
	})

// COMMAND

/** `To` jumps to an offset (the end); `By` shifts by how far the anchor moved, keeping any scroll the reader did meanwhile. */
export const ScrollAdjustment = defineTaggedUnion({
	To: { scrollTop: Schema.Number },
	By: { deltaPx: Schema.Number },
})
export type ScrollAdjustment = typeof ScrollAdjustment.Type

/** Adjusts `scrollTop` once the pending patch has committed, before the browser paints. */
export const ApplyScroll = Command.define("ApplyScroll", {
	args: { id: Schema.String, adjustment: ScrollAdjustment, version: Schema.Number },
	messages: [Message.CompletedApplyScroll],
	execute: ({ id, adjustment, version }) =>
		Effect.gen(function* () {
			yield* Render.afterCommit
			const element = document.getElementById(id)
			if (element === null) return Message.CompletedApplyScroll({ version, scrollTop: 0 })
			element.scrollTop =
				adjustment._tag === "To" ? adjustment.scrollTop : element.scrollTop + adjustment.deltaPx
			return Message.CompletedApplyScroll({ version, scrollTop: element.scrollTop })
		}),
})

// UPDATE

export type ListReturn = Update.Return<Model, Message>

export const isScrollPending = (model: Model) => model.appliedScrollVersion !== model.scrollVersion

/** Puts the anchor back where it was observed in the current layout, scheduling a scroll if it moved. */
const reconcile = (model: Model): ListReturn => {
	if (model.viewportHeight === 0) return { model }
	const target = scrollTopForAnchor(model, layoutOf(model), model.anchor)
	if (Math.abs(target - model.scrollTop) < 0.5) return { model }
	const version = Num.increment(model.scrollVersion)
	const adjustment =
		model.anchor._tag === "End"
			? ScrollAdjustment.To({ scrollTop: target })
			: ScrollAdjustment.By({ deltaPx: target - model.scrollTop })
	return {
		model: modifyFields(model, { scrollTop: () => target, scrollVersion: () => version }),
		commands: [ApplyScroll({ id: model.id, adjustment, version })],
	}
}

const changedMeasurements = (
	model: Model,
	measurements: ReadonlyArray<{ readonly key: string; readonly height: number }>,
) => measurements.filter(({ key, height }) => model.measuredHeights[key] !== height)

/**
 * Inserting rows is the expensive part of a scroll frame (the shared stylesheet's `:has()` rules
 * restyle the page per inserted subtree), so the rendered range only moves when the viewport comes
 * within `RENDER_MARGIN_PX` of its edge, and then by `RENDER_CHUNK_PX` past the viewport.
 */
const RENDER_MARGIN_PX = 200
const RENDER_CHUNK_PX = 2400

export const renderedIndexes = (model: Model, layout: Layout) => {
	const from = model.renderedFromKey === null ? undefined : layout.indexByKey.get(model.renderedFromKey)
	const to = model.renderedToKey === null ? undefined : layout.indexByKey.get(model.renderedToKey)
	return from === undefined || to === undefined || from > to ? undefined : { from, to }
}

const keepRendered = (model: Model): Model => {
	if (model.viewportHeight === 0 || model.keys.length === 0)
		return model.renderedFromKey === null && model.renderedToKey === null
			? model
			: modifyFields(model, { renderedFromKey: () => null, renderedToKey: () => null })
	const layout = layoutOf(model)
	const top = model.scrollTop
	const bottom = top + model.viewportHeight
	const current = renderedIndexes(model, layout)
	if (
		current !== undefined &&
		layout.offsets[current.from]! <= Math.max(0, top - RENDER_MARGIN_PX) &&
		layout.offsets[current.to + 1]! >= Math.min(layout.totalHeight, bottom + RENDER_MARGIN_PX)
	)
		return model
	// A date divider stays first while older same-day rows prepend after it, so it never bounds the range.
	const sticky = stickySetOf(model)
	const toIndex = rowIndexAt(layout, bottom + RENDER_CHUNK_PX)
	let fromIndex = rowIndexAt(layout, Math.max(0, top - RENDER_CHUNK_PX))
	while (fromIndex < toIndex && sticky.has(model.keys[fromIndex]!)) fromIndex++
	const from = model.keys[fromIndex]!
	const to = model.keys[toIndex]!
	return modifyFields(model, { renderedFromKey: () => from, renderedToKey: () => to })
}

/** The divider above the first visible row (the one `position: sticky` pins). */
const stickyKeyAt = (model: Model): string | null => {
	if (model.viewportHeight === 0 || model.keys.length === 0) return null
	const sticky = stickySetOf(model)
	for (let index = rowIndexAt(layoutOf(model), model.scrollTop); index >= 0; index--)
		if (sticky.has(model.keys[index]!)) return model.keys[index]!
	return null
}

const withStuckKey = (model: Model): Model => {
	const stuckKey = stickyKeyAt(model)
	return stuckKey === model.stuckKey ? model : modifyFields(model, { stuckKey: () => stuckKey })
}

/** Keeps the rendered range around the viewport; a recalculation also re-reads the stuck divider. */
const withRendered = (result: ListReturn, isRecalculation = true): ListReturn => {
	const rendered = keepRendered(result.model)
	const hasMoved =
		rendered.renderedFromKey !== result.model.renderedFromKey ||
		rendered.renderedToKey !== result.model.renderedToKey
	const model = isRecalculation || hasMoved ? withStuckKey(rendered) : rendered
	return model === result.model ? result : { ...result, model }
}

export const update = (model: Model, message: Message): ListReturn =>
	withRendered(updateScroll(model, message), message._tag !== "ScrolledList")

const updateScroll = (model: Model, message: Message): ListReturn =>
	Message.match<ListReturn>(message, {
		// While our own scroll is in flight the event describes the pre-patch DOM, so it is ignored.
		ScrolledList: ({ scrollTop }) =>
			isScrollPending(model)
				? { model }
				: {
						model: modifyFields(model, {
							scrollTop: () => scrollTop,
							anchor: () => anchorAt(model, layoutOf(model), scrollTop),
						}),
					},
		ResizedViewport: ({ viewportHeight }) =>
			reconcile(modifyFields(model, { viewportHeight: () => viewportHeight })),
		MeasuredRows: ({ measurements }) => {
			const changed = changedMeasurements(model, measurements)
			if (changed.length === 0) return { model }
			const heights = { ...model.measuredHeights }
			for (const { key, height } of changed) heights[key] = height
			return reconcile(modifyFields(model, { measuredHeights: () => heights }))
		},
		// The DOM now matches the layout, so the anchor is re-read from where the reader really is.
		CompletedApplyScroll: ({ version, scrollTop }) =>
			version !== model.scrollVersion
				? { model }
				: {
						model: modifyFields(model, {
							appliedScrollVersion: () => version,
							scrollTop: () => scrollTop,
							anchor: () => anchorAt(model, layoutOf(model), scrollTop),
						}),
					},
	})

/** The parent's rows changed (prepended page, new message, deletion). Keeps the anchor in place. */
export const setKeys = (
	model: Model,
	keys: ReadonlyArray<string>,
	stickyKeys: ReadonlyArray<string> = model.stickyKeys,
): ListReturn =>
	model.keys === keys && model.stickyKeys === stickyKeys
		? { model }
		: withRendered(reconcile(modifyFields(model, { keys: () => keys, stickyKeys: () => stickyKeys })))

/** Jumps to the newest row and follows it (after sending a message). */
export const scrollToEnd = (model: Model): ListReturn =>
	withRendered(reconcile(modifyFields(model, { anchor: () => ViewportAnchor.End() })))

/** Within half a viewport of the oldest loaded row: time to load an older page. */
export const isNearStart = (model: Model) =>
	model.viewportHeight > 0 && model.keys.length > 0 && model.scrollTop < model.viewportHeight / 2

// MOUNT

const ROW_KEY_ATTRIBUTE = "data-list-key"

type ObservedMessage =
	| typeof Message.ScrolledList.Type
	| typeof Message.ResizedViewport.Type
	| typeof Message.MeasuredRows.Type

const observeList = (element: Element): Stream.Stream<ObservedMessage> =>
	Stream.callback<ObservedMessage>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				if (!(element instanceof HTMLElement)) return () => undefined
				Queue.offerUnsafe(queue, Message.ResizedViewport({ viewportHeight: element.clientHeight }))

				const onScroll = () =>
					Queue.offerUnsafe(queue, Message.ScrolledList({ scrollTop: element.scrollTop }))
				element.addEventListener("scroll", onScroll, { passive: true })

				const viewportObserver = new ResizeObserver(() =>
					Queue.offerUnsafe(
						queue,
						Message.ResizedViewport({ viewportHeight: element.clientHeight }),
					),
				)
				viewportObserver.observe(element)

				// One observer for every rendered row; the browser batches entries per frame.
				const rowObserver = new ResizeObserver((entries) => {
					const measurements = entries.flatMap((entry) => {
						const key = entry.target.getAttribute(ROW_KEY_ATTRIBUTE)
						return key === null
							? []
							: [{ key, height: entry.target.getBoundingClientRect().height }]
					})
					if (measurements.length > 0)
						Queue.offerUnsafe(queue, Message.MeasuredRows({ measurements }))
				})
				const observedRows = new Set<Element>()
				const reconcileRows = () => {
					const rows = new Set(element.querySelectorAll(`[${ROW_KEY_ATTRIBUTE}]`))
					for (const row of observedRows)
						if (!rows.has(row)) {
							rowObserver.unobserve(row)
							observedRows.delete(row)
						}
					for (const row of rows)
						if (!observedRows.has(row)) {
							rowObserver.observe(row)
							observedRows.add(row)
						}
				}
				const mutationObserver = new MutationObserver(reconcileRows)
				mutationObserver.observe(element, { childList: true, subtree: true })
				reconcileRows()

				return () => {
					mutationObserver.disconnect()
					rowObserver.disconnect()
					viewportObserver.disconnect()
					element.removeEventListener("scroll", onScroll)
				}
			}),
			(cleanup) => Effect.sync(cleanup),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

/** Container-owned Mount: scroll position, viewport height and row heights, all from one element. */
export const ObserveMessageList = Mount.defineStream("ObserveMessageList", {
	args: { id: Schema.String },
	messages: [Message.ScrolledList, Message.ResizedViewport, Message.MeasuredRows],
	execute: ({ element, viewStateChanges }) =>
		viewStateChanges.pipe(
			Stream.switchMap((viewState) => (viewState === "Live" ? observeList(element) : Stream.never)),
		),
})

// VIEW

export interface ViewInputs<Item, ParentMessage> {
	/** Same order as `model.keys`, oldest first. */
	readonly items: ReadonlyArray<Item>
	readonly itemToKey: (item: Item) => string
	readonly itemToView: (item: Item, context: { readonly isStuck: boolean }) => Html
	/** Date separators: the one above the viewport is pinned to the top (`isStuck`). */
	readonly isStickyHeader: (item: Item) => boolean
	readonly toParentMessage: (message: Message) => ParentMessage
}

/** The rendered rows (kept by `update`) and the first visible one. */
export const visibleRange = (model: Model, layout: Layout) => {
	const rendered = renderedIndexes(model, layout)
	if (model.viewportHeight === 0 || rendered === undefined) return undefined
	return { start: rendered.from, end: rendered.to, firstVisible: rowIndexAt(layout, model.scrollTop) }
}

export const view = <Item, ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	inputs: ViewInputs<Item, ParentMessage>,
): Html => {
	const layout = layoutOf(model)
	const range = visibleRange(model, layout)
	let stickyIndex: number | undefined
	if (range !== undefined)
		for (let index = range.firstVisible; index >= 0; index--)
			if (inputs.isStickyHeader(inputs.items[index]!)) {
				stickyIndex = index
				break
			}

	const row = (index: number) => {
		const item = inputs.items[index]!
		const key = inputs.itemToKey(item)
		const isStuck = key === model.stuckKey
		const isPinned = index === stickyIndex
		return h.keyed("div")(
			key,
			[
				h.Attribute(ROW_KEY_ATTRIBUTE, key),
				h.Style(
					isPinned
						? {
								contain: "layout style paint",
								left: "0px",
								position: "sticky",
								right: "0px",
								top: "0px",
								"z-index": "1000",
							}
						: {
								contain: "layout style paint",
								left: "0px",
								position: "absolute",
								right: "0px",
								top: `${layout.offsets[index]}px`,
							},
				),
			],
			[inputs.itemToView(item, { isStuck })],
		)
	}
	// The pinned divider comes after the positioned rows, as in `@legendapp/list`.
	const rows: Html[] = []
	if (range !== undefined) {
		for (let index = range.start; index <= range.end; index++)
			if (index !== stickyIndex) rows.push(row(index))
		if (stickyIndex !== undefined) rows.push(row(stickyIndex))
	}

	return h.div(
		[
			h.Id(model.id),
			h.OnMount(Mount.mapMessage(ObserveMessageList({ id: model.id }), inputs.toParentMessage)),
			h.Style({ overflow: "auto", flex: "1 1 0%", "min-height": "0px", "overflow-anchor": "none" }),
		],
		[
			h.div(
				[
					h.Style({
						display: "flex",
						"flex-direction": "column",
						"min-height": "100%",
						"flex-grow": "1",
						"justify-content": "flex-end",
					}),
				],
				[
					h.div(
						[
							h.Style({
								height: `${layout.totalHeight}px`,
								position: "relative",
								"min-width": "0px",
							}),
						],
						rows,
					),
				],
			),
		],
	)
}
