import { Effect, Number, Queue, Schema, Stream } from "effect"
import { Command, Mount, Render } from "foldkit"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"
import { calculate, emptyPool, Pool } from "./message-list-pool"

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
	/** False while the loaded window stops short of the newest row: the end is then not "live". */
	canFollowEnd: Schema.Boolean,
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
	/** LegendList's containers: which row each rendered `<div>` holds, in DOM order. */
	pool: Pool,
	/**
	 * While the reader scrolls, rows render from a wide overscan window in row order instead (LegendList's
	 * 300px draw distance inserts a row subtree nearly every frame, and each insertion restyles the
	 * page). The pool keeps running and takes over again once the scroll settles.
	 */
	isScrolling: Schema.Boolean,
	scrollEventVersion: Schema.Number,
	isSettleWaitPending: Schema.Boolean,
	/** First and last row of the overscan window. Moved in chunks, so most scroll frames change no DOM. */
	renderedFromKey: Schema.NullOr(Schema.String),
	renderedToKey: Schema.NullOr(Schema.String),
	/** `activeStickyIndex`: the divider pinned `position: sticky`. */
	activeStickyKey: Schema.NullOr(Schema.String),
	/**
	 * The divider drawn without its line. Legacy containers read it from React state only when they
	 * re-render (data, layout, a newly assigned row), so a scroll alone leaves it stale.
	 */
	stuckKey: Schema.NullOr(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	/** A list element was (re)created: its real position, which the Model may no longer match. */
	MountedList: { scrollTop: Schema.Number, viewportHeight: Schema.Number },
	ScrolledList: { scrollTop: Schema.Number },
	ResizedViewport: { viewportHeight: Schema.Number },
	MeasuredRows: {
		measurements: Schema.Array(Schema.Struct({ key: Schema.String, height: Schema.Number })),
	},
	CompletedApplyScroll: { version: Schema.Number, scrollTop: Schema.Number },
	CompletedWaitForScrollSettle: { version: Schema.Number },
})
export type Message = typeof Message.Type

// INIT

export const init = (config: {
	readonly id: string
	readonly estimatedRowHeightPx: number
	readonly followThresholdPx?: number
	/** A previous list's viewport, so the first render already places rows (the Mount corrects it). */
	readonly viewportHeight?: number
	/** Heights measured on an earlier visit; rows re-measure as they render. */
	readonly measuredHeights?: Readonly<Record<string, number>>
}): Model => ({
	id: config.id,
	estimatedRowHeightPx: config.estimatedRowHeightPx,
	followThresholdPx: config.followThresholdPx ?? 1,
	canFollowEnd: true,
	keys: [],
	stickyKeys: [],
	measuredHeights: config.measuredHeights ?? {},
	viewportHeight: config.viewportHeight ?? 0,
	scrollTop: 0,
	anchor: ViewportAnchor.End(),
	scrollVersion: 0,
	appliedScrollVersion: 0,
	pool: emptyPool,
	isScrolling: false,
	scrollEventVersion: 0,
	isSettleWaitPending: false,
	renderedFromKey: null,
	renderedToKey: null,
	activeStickyKey: null,
	stuckKey: null,
})

// LAYOUT

export interface Layout {
	/** `offsets[i]` is the top of row i inside the content box; `offsets[n]` is the total height. */
	readonly offsets: Float64Array
	readonly indexByKey: ReadonlyMap<string, number>
	readonly totalHeight: number
}

const computeLayout = (model: Model): Layout => {
	const { keys, measuredHeights, estimatedRowHeightPx } = model
	const offsets = new Float64Array(keys.length + 1)
	const indexByKey = new Map<string, number>()
	keys.forEach((key, index) => {
		indexByKey.set(key, index)
		offsets[index + 1] = offsets[index]! + (measuredHeights[key] ?? estimatedRowHeightPx)
	})
	return { offsets, indexByKey, totalHeight: offsets[keys.length]! }
}

// Pure memos keyed by the frozen inputs, so lists never evict each other's entries.
const layouts = new WeakMap<ReadonlyArray<string>, WeakMap<object, { readonly estimate: number; readonly layout: Layout }>>()

/** Prefix sums over measured or estimated heights, memoized on the (frozen) inputs by reference. */
export const layoutOf = (model: Model): Layout => {
	const byHeights = layouts.get(model.keys) ?? new WeakMap()
	const cached = byHeights.get(model.measuredHeights)
	if (cached !== undefined && cached.estimate === model.estimatedRowHeightPx) return cached.layout
	const layout = computeLayout(model)
	byHeights.set(model.measuredHeights, { estimate: model.estimatedRowHeightPx, layout })
	layouts.set(model.keys, byHeights)
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

const stickySets = new WeakMap<ReadonlyArray<string>, ReadonlySet<string>>()
const stickySetOf = (model: Model): ReadonlySet<string> => {
	const cached = stickySets.get(model.stickyKeys)
	if (cached !== undefined) return cached
	const set = new Set(model.stickyKeys)
	stickySets.set(model.stickyKeys, set)
	return set
}

/** The anchor that describes `scrollTop`: the end when within the follow threshold, else the top non-sticky row. */
export const anchorAt = (model: Model, layout: Layout, scrollTop: number): ViewportAnchor => {
	const distanceFromEnd = layout.totalHeight - model.viewportHeight - scrollTop
	if (model.keys.length === 0 || (model.canFollowEnd && distanceFromEnd <= model.followThresholdPx))
		return ViewportAnchor.End()
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

/**
 * Resumes in the frame's ResizeObserver step: after layout, before paint, so touching `scrollTop`
 * forces no layout of the freshly patched rows. A 0x0 element is never observed; the next frame
 * stands in.
 */
const afterLayout = (element: Element) =>
	Effect.raceFirst(
		Effect.callback<void>((resume) => {
			const observer = new ResizeObserver(() => {
				observer.disconnect()
				resume(Effect.void)
			})
			observer.observe(element)
			return Effect.sync(() => observer.disconnect())
		}),
		Render.afterPaint,
	)

/** Adjusts `scrollTop` once the pending patch has committed and laid out, before the browser paints. */
export const ApplyScroll = Command.define("ApplyScroll", {
	args: { id: Schema.String, adjustment: ScrollAdjustment, version: Schema.Number },
	messages: [Message.CompletedApplyScroll],
	execute: ({ id, adjustment, version }) =>
		Effect.gen(function* () {
			yield* Render.afterCommit
			const element = document.getElementById(id)
			if (element === null) return Message.CompletedApplyScroll({ version, scrollTop: 0 })
			yield* afterLayout(element)
			element.scrollTop =
				adjustment._tag === "To" ? adjustment.scrollTop : element.scrollTop + adjustment.deltaPx
			return Message.CompletedApplyScroll({ version, scrollTop: element.scrollTop })
		}),
})

/** How long without a scroll event before the overscan window gives way to LegendList's containers. */
const SCROLL_SETTLE_MS = 200

export const WaitForScrollSettle = Command.define("WaitForScrollSettle", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForScrollSettle],
	execute: ({ version }) =>
		Effect.sleep(SCROLL_SETTLE_MS).pipe(Effect.as(Message.CompletedWaitForScrollSettle({ version }))),
})

// UPDATE

export type ListReturn = Update.Return<Model, Message>

export const isScrollPending = (model: Model) => model.appliedScrollVersion !== model.scrollVersion

/** Puts the anchor back where it was observed in the current layout, scheduling a scroll if it moved. */
const reconcile = (model: Model): ListReturn => {
	if (model.viewportHeight === 0) return { model }
	const target = scrollTopForAnchor(model, layoutOf(model), model.anchor)
	if (Math.abs(target - model.scrollTop) < 0.5) return { model }
	const version = Number.increment(model.scrollVersion)
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
 * The overscan window always covers the viewport plus `RENDER_MARGIN_PX`, then grows toward
 * `RENDER_LEAD_PX` by at most `RENDER_STEP_PX` per side and update, so a frame builds a few rows,
 * never a 2400px chunk. Rows past the lead plus `RENDER_SLACK_PX` are dropped.
 */
const RENDER_MARGIN_PX = 300
const RENDER_LEAD_PX = 2400
const RENDER_STEP_PX = 320
const RENDER_SLACK_PX = 600

export const renderedIndexes = (model: Model, layout: Layout) => {
	const from = model.renderedFromKey === null ? undefined : layout.indexByKey.get(model.renderedFromKey)
	const to = model.renderedToKey === null ? undefined : layout.indexByKey.get(model.renderedToKey)
	return from === undefined || to === undefined || from > to ? undefined : { from, to }
}

const keepOverscan = (model: Model): Model => {
	if (!model.isScrolling || model.viewportHeight === 0 || model.keys.length === 0) return model
	const layout = layoutOf(model)
	const top = model.scrollTop
	const bottom = top + model.viewportHeight
	const at = (y: number) => rowIndexAt(layout, Math.max(0, y))
	const hardFrom = at(top - RENDER_MARGIN_PX)
	const hardTo = at(bottom + RENDER_MARGIN_PX)
	const current = renderedIndexes(model, layout)
	// A jump past the window (fling, jump to a row) starts over from what the viewport needs.
	const isDisjoint = current === undefined || current.to < hardFrom || current.from > hardTo
	const coveredFrom = isDisjoint ? hardFrom : Math.min(current.from, hardFrom)
	const coveredTo = isDisjoint ? hardTo : Math.max(current.to, hardTo)
	const grownFrom = Math.max(
		at(top - RENDER_LEAD_PX),
		Math.min(coveredFrom, at(layout.offsets[coveredFrom]! - RENDER_STEP_PX)),
	)
	const grownTo = Math.min(
		at(bottom + RENDER_LEAD_PX),
		Math.max(coveredTo, at(layout.offsets[coveredTo + 1]! + RENDER_STEP_PX)),
	)
	const from = Math.max(
		Math.min(coveredFrom, grownFrom),
		at(top - RENDER_LEAD_PX - RENDER_SLACK_PX),
	)
	const to = Math.min(Math.max(coveredTo, grownTo), at(bottom + RENDER_LEAD_PX + RENDER_SLACK_PX))
	if (current !== undefined && from === current.from && to === current.to) return model
	return modifyFields(model, { renderedFromKey: () => model.keys[from]!, renderedToKey: () => model.keys[to]! })
}

/** A scroll event that is not the echo of our own `ApplyScroll`: the reader is scrolling. */
const startedScrolling = (model: Model): ListReturn => {
	const version = Number.increment(model.scrollEventVersion)
	const scrolling = modifyFields(model, {
		isScrolling: () => true,
		scrollEventVersion: () => version,
		isSettleWaitPending: () => true,
	})
	return model.isSettleWaitPending
		? { model: scrolling }
		: { model: scrolling, commands: [WaitForScrollSettle({ version })] }
}

const stickyIndexes = new WeakMap<ReadonlyArray<string>, WeakMap<Layout, ReadonlyArray<number>>>()
const stickyIndexesOf = (model: Model, layout: Layout): ReadonlyArray<number> => {
	const byLayout = stickyIndexes.get(model.stickyKeys) ?? new WeakMap<Layout, ReadonlyArray<number>>()
	const cached = byLayout.get(layout)
	if (cached !== undefined) return cached
	const indexes = model.stickyKeys
		.flatMap((key) => {
			const index = layout.indexByKey.get(key)
			return index === undefined ? [] : [index]
		})
		.sort((a, b) => a - b)
	byLayout.set(layout, indexes)
	stickyIndexes.set(model.stickyKeys, byLayout)
	return indexes
}

/** What triggered a pass. After a scroll only newly assigned containers re-render (and re-read `stuckKey`). */
type Trigger = "Scroll" | "Data" | "Layout"

/** Runs LegendList's `calculateItemsInView` for the current layout and scroll position. */
const withPool = (result: ListReturn, trigger: Trigger): ListReturn => {
	const model = result.model
	const layout = layoutOf(model)
	const calculation = calculate(model.pool, {
		keys: model.keys,
		stickyIndexes: stickyIndexesOf(model, layout),
		indexByKey: layout.indexByKey,
		offsets: layout.offsets,
		scrollTop: model.scrollTop,
		viewportHeight: model.viewportHeight,
		estimatedItemSize: model.estimatedRowHeightPx,
		isDataChange: trigger === "Data",
	})
	if (calculation === undefined) return withOverscan(result)
	const { pool, activeStickyKey } = calculation
	const stuckKey = trigger !== "Scroll" || pool !== model.pool ? activeStickyKey : model.stuckKey
	if (pool === model.pool && activeStickyKey === model.activeStickyKey && stuckKey === model.stuckKey)
		return withOverscan(result)
	return withOverscan({
		...result,
		model: modifyFields(model, {
			pool: () => pool,
			activeStickyKey: () => activeStickyKey,
			stuckKey: () => stuckKey,
		}),
	})
}

const withOverscan = (result: ListReturn): ListReturn => {
	const model = keepOverscan(result.model)
	return model === result.model ? result : { ...result, model }
}

export const update = (model: Model, message: Message): ListReturn => {
	const result = updateScroll(model, message)
	// Re-observed rows that changed nothing are not a recalculation.
	if (result.model === model) return result
	const isScroll =
		message._tag === "ScrolledList" ||
		message._tag === "CompletedApplyScroll" ||
		message._tag === "CompletedWaitForScrollSettle"
	return withPool(result, isScroll ? "Scroll" : "Layout")
}

const updateScroll = (model: Model, message: Message): ListReturn =>
	Message.match<ListReturn>(message, {
		// While our own scroll is in flight the event describes the pre-patch DOM, so it is ignored.
		ScrolledList: ({ scrollTop }) => {
			if (isScrollPending(model)) return { model }
			const scrolled = modifyFields(model, {
				scrollTop: () => scrollTop,
				anchor: () => anchorAt(model, layoutOf(model), scrollTop),
			})
			// The scroll event our own `ApplyScroll` causes lands where the model already is.
			return Math.abs(scrollTop - model.scrollTop) < 1
				? { model: scrolled }
				: startedScrolling(scrolled)
		},
		CompletedWaitForScrollSettle: ({ version }) =>
			version === model.scrollEventVersion
				? {
						model: modifyFields(model, {
							isScrolling: () => false,
							isSettleWaitPending: () => false,
							renderedFromKey: () => null,
							renderedToKey: () => null,
						}),
					}
				: { model, commands: [WaitForScrollSettle({ version: model.scrollEventVersion })] },
		ResizedViewport: ({ viewportHeight }) =>
			reconcile(modifyFields(model, { viewportHeight: () => viewportHeight })),
		// A remounted element (the Files tab round-trip) starts at its own offset; the anchor is kept,
		// so `reconcile` scrolls back to it.
		MountedList: ({ scrollTop, viewportHeight }) =>
			reconcile(
				modifyFields(model, { scrollTop: () => scrollTop, viewportHeight: () => viewportHeight }),
			),
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
		: withPool(reconcile(modifyFields(model, { keys: () => keys, stickyKeys: () => stickyKeys })), "Data")

/** Jumps to the newest row and follows it (after sending a message). */
export const scrollToEnd = (model: Model): ListReturn =>
	withPool(reconcile(modifyFields(model, { anchor: () => ViewportAnchor.End() })), "Layout")

/** Within half a viewport of the newest loaded row: time to load a newer page of a capped window. */
export const isNearEnd = (model: Model) =>
	model.viewportHeight > 0 &&
	model.keys.length > 0 &&
	maxScrollTop(model, layoutOf(model)) - model.scrollTop < model.viewportHeight / 2

/** Whether the window reaches the newest row; while it does not, the list anchors on rows only. */
export const setCanFollowEnd = (model: Model, canFollowEnd: boolean): Model =>
	model.canFollowEnd === canFollowEnd
		? model
		: modifyFields(model, {
				canFollowEnd: () => canFollowEnd,
				anchor: (anchor) =>
					!canFollowEnd &&
					anchor._tag === "End" &&
					model.viewportHeight > 0 &&
					model.keys.length > 0
						? anchorAt({ ...model, canFollowEnd: false }, layoutOf(model), model.scrollTop)
						: anchor,
			})

/** Within half a viewport of the oldest loaded row: time to load an older page. */
export const isNearStart = (model: Model) =>
	model.viewportHeight > 0 && model.keys.length > 0 && model.scrollTop < model.viewportHeight / 2

// MOUNT

const ROW_KEY_ATTRIBUTE = "data-list-key"

type ObservedMessage =
	| typeof Message.MountedList.Type
	| typeof Message.ScrolledList.Type
	| typeof Message.ResizedViewport.Type
	| typeof Message.MeasuredRows.Type

const observeList = (element: Element): Stream.Stream<ObservedMessage> =>
	Stream.callback<ObservedMessage>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				if (!(element instanceof HTMLElement)) return () => undefined
				Queue.offerUnsafe(
					queue,
					Message.MountedList({ scrollTop: element.scrollTop, viewportHeight: element.clientHeight }),
				)

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
							: [{ key, height: roundSize(entry.target.getBoundingClientRect().height) }]
					})
					if (measurements.length > 0)
						Queue.offerUnsafe(queue, Message.MeasuredRows({ measurements }))
				})
				// Containers are recycled: a container that gets a new row is observed afresh, so the new
				// row is measured even when it happens to be as tall as the previous one.
				const observedRows = new Map<Element, string | null>()
				const reconcileRows = () => {
					const rows = new Set(element.querySelectorAll(`[${ROW_KEY_ATTRIBUTE}]`))
					for (const row of observedRows.keys())
						if (!rows.has(row)) {
							rowObserver.unobserve(row)
							observedRows.delete(row)
						}
					for (const row of rows) {
						const key = row.getAttribute(ROW_KEY_ATTRIBUTE)
						if (observedRows.get(row) === key) continue
						if (observedRows.has(row)) rowObserver.unobserve(row)
						rowObserver.observe(row)
						observedRows.set(row, key)
					}
				}
				const mutationObserver = new MutationObserver(reconcileRows)
				mutationObserver.observe(element, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: [ROW_KEY_ATTRIBUTE],
				})
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

/** `@legendapp/list`'s `updateItemSize` stores `Math.round(height)`, so offsets land where it puts them. */
const roundSize = (size: number) => Math.round(size)

/** Container-owned Mount: scroll position, viewport height and row heights, all from one element. */
export const ObserveMessageList = Mount.defineStream("ObserveMessageList", {
	args: { id: Schema.String },
	messages: [Message.MountedList, Message.ScrolledList, Message.ResizedViewport, Message.MeasuredRows],
	execute: ({ element, viewStateChanges }) =>
		viewStateChanges.pipe(
			Stream.switchMap((viewState) => (viewState === "Live" ? observeList(element) : Stream.never)),
		),
})

// VIEW

/**
 * Whether two Models render the same list. Scroll offset, anchor and scroll bookkeeping are left
 * out: most scroll events change only those, and the rows sit at absolute offsets regardless.
 */
export const isViewEqual = (a: Model, b: Model): boolean =>
	a === b ||
	(a.id === b.id &&
		a.keys === b.keys &&
		a.stickyKeys === b.stickyKeys &&
		a.measuredHeights === b.measuredHeights &&
		a.estimatedRowHeightPx === b.estimatedRowHeightPx &&
		a.viewportHeight === b.viewportHeight &&
		a.isScrolling === b.isScrolling &&
		a.pool === b.pool &&
		a.renderedFromKey === b.renderedFromKey &&
		a.renderedToKey === b.renderedToKey &&
		a.activeStickyKey === b.activeStickyKey &&
		a.stuckKey === b.stuckKey)

export interface ViewInputs<Item, ParentMessage> {
	/** Same order as `model.keys`, oldest first. */
	readonly items: ReadonlyArray<Item>
	readonly itemToKey: (item: Item) => string
	readonly itemToView: (item: Item, context: { readonly isStuck: boolean }) => Html
	/** Date separators: the one above the viewport is pinned to the top (`isStuck`). */
	readonly isStickyHeader: (item: Item) => boolean
	readonly toParentMessage: (message: Message) => ParentMessage
}

/** LegendList's `POSITION_OUT_OF_VIEW`, where empty containers wait. */
const OUT_OF_VIEW_PX = -10000000

export const view = <Item, ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	inputs: ViewInputs<Item, ParentMessage>,
): Html => {
	const layout = layoutOf(model)
	const sticky = stickySetOf(model)
	const emptyContainer = (slot: number) =>
		h.keyed("div")(
			`empty-${slot}`,
			[
				h.Style({
					contain: "layout style paint",
					left: "0px",
					position: "absolute",
					right: "0px",
					top: `${OUT_OF_VIEW_PX}px`,
				}),
			],
		)
	// Keyed by row, so switching between the overscan window and the containers moves nodes.
	const row = (index: number) => {
		const key = model.keys[index]!
		const isActive = key === model.activeStickyKey
		// PositionViewSticky: every divider stacks by index; only the active one is sticky.
		const style: Record<string, string> = sticky.has(key)
			? {
					contain: "layout style paint",
					left: "0px",
					position: isActive ? "sticky" : "absolute",
					right: "0px",
					top: isActive ? "0px" : `${layout.offsets[index]}px`,
					"z-index": `${index + 1000}`,
				}
			: {
					contain: "layout style paint",
					left: "0px",
					position: "absolute",
					right: "0px",
					top: `${layout.offsets[index]}px`,
				}
		return h.keyed("div")(
			key,
			[h.Attribute("data-index", `${index}`), h.Attribute(ROW_KEY_ATTRIBUTE, key), h.Style(style)],
			[inputs.itemToView(inputs.items[index]!, { isStuck: key === model.stuckKey })],
		)
	}
	const overscanRows = () => {
		const range = renderedIndexes(model, layout)
		if (range === undefined) return []
		const indexes = Array.from({ length: range.to - range.from + 1 }, (_, offset) => range.from + offset)
		const activeIndex =
			model.activeStickyKey === null ? undefined : layout.indexByKey.get(model.activeStickyKey)
		// The pinned divider renders even when its day started above the window.
		return [
			...indexes.filter((index) => index !== activeIndex),
			...(activeIndex === undefined ? [] : [activeIndex]),
		].map(row)
	}
	const containerRows = () =>
		Array.from({ length: model.pool.pooledCount }, (_, slot) => {
			const key = model.pool.slots[slot] ?? null
			const index = key === null ? undefined : layout.indexByKey.get(key)
			return index === undefined ? emptyContainer(slot) : row(index)
		})
	const rows = model.viewportHeight === 0 ? [] : model.isScrolling ? overscanRows() : containerRows()

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
