import { Schema } from "effect"
import type { Update } from "foldkit"
import { childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"
import * as VirtualList from "@foldkit/ui/virtualList"

/**
 * Chat message list on `@foldkit/ui`'s VirtualList (measured rows, stable-key anchor, follow the
 * end). This adapter keeps the page-facing API: row keys, date dividers that never anchor, the
 * capped window's follow switch, and the edge checks that page older or newer messages in.
 */

// MODEL

export const Model = Schema.Struct({
	list: VirtualList.Model,
	estimatedRowHeightPx: Schema.Number,
	followThresholdPx: Schema.Number,
	keys: Schema.Array(Schema.String),
	/** Date dividers: the one above the viewport is pinned to the top. */
	stickyKeys: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

export const Message = VirtualList.Message
export type Message = VirtualList.Message

export const init = (config: {
	readonly id: string
	readonly estimatedRowHeightPx: number
	readonly followThresholdPx?: number
}): Model => ({
	list: VirtualList.init({
		id: config.id,
		rowHeightPx: config.estimatedRowHeightPx,
		initialScroll: { target: VirtualList.ScrollTarget.End(), alignment: "End" },
		followEnd: { thresholdPx: config.followThresholdPx ?? 1 },
	}),
	estimatedRowHeightPx: config.estimatedRowHeightPx,
	followThresholdPx: config.followThresholdPx ?? 1,
	keys: [],
	stickyKeys: [],
})

// LAYOUT

export interface Layout {
	/** `offsets[i]` is the top of row i inside the content; `offsets[n]` is the total height. */
	readonly offsets: Float64Array
	readonly indexByKey: ReadonlyMap<string, number>
	readonly totalHeight: number
}

let lastLayoutInputs: readonly [unknown, unknown] | undefined
let lastLayout: Layout | undefined

/** Prefix sums over VirtualList's measured heights (the estimate until measured). */
export const layoutOf = (model: Model): Layout => {
	const heights = model.list.measuredRowHeights
	if (lastLayout !== undefined && lastLayoutInputs?.[0] === model.keys && lastLayoutInputs[1] === heights)
		return lastLayout
	const offsets = new Float64Array(model.keys.length + 1)
	const indexByKey = new Map<string, number>()
	model.keys.forEach((key, index) => {
		indexByKey.set(key, index)
		offsets[index + 1] = offsets[index]! + (heights[key] ?? model.estimatedRowHeightPx)
	})
	lastLayoutInputs = [model.keys, heights]
	lastLayout = { offsets, indexByKey, totalHeight: offsets[model.keys.length]! }
	return lastLayout
}

const viewportHeightOf = (model: Model) =>
	model.list.measurement._tag === "Measured" ? model.list.measurement.containerHeight : 0

export const maxScrollTop = (model: Model, layout: Layout = layoutOf(model)) =>
	Math.max(0, layout.totalHeight - viewportHeightOf(model))

// UPDATE

export type ListReturn = Update.Return<Model, Message>

const lift = (model: Model, result: Update.Return<VirtualList.Model, Message>): ListReturn => ({
	model: result.model === model.list ? model : modifyFields(model, { list: () => result.model }),
	commands: result.commands,
})

export const isScrollPending = (model: Model) => model.list.pendingScroll._tag === "Pending"

export const update = (model: Model, message: Message): ListReturn =>
	lift(model, VirtualList.update(model.list, message))

/** The parent's rows changed (prepended page, new message, deletion). VirtualList keeps the anchor. */
export const setKeys = (
	model: Model,
	keys: ReadonlyArray<string>,
	stickyKeys: ReadonlyArray<string> = model.stickyKeys,
): ListReturn => {
	if (model.keys === keys && model.stickyKeys === stickyKeys) return { model }
	const next = modifyFields(model, { keys: () => keys, stickyKeys: () => stickyKeys })
	return model.keys === keys ? { model: next } : lift(next, VirtualList.informItemsChanged(next.list, keys))
}

/** Jumps to the newest row and follows it (after sending a message). */
export const scrollToEnd = (model: Model): ListReturn => lift(model, VirtualList.scrollToEnd(model.list))

/** Jumps to a message (permalink), centered. */
export const scrollToKey = (model: Model, key: string): ListReturn =>
	lift(model, VirtualList.scrollToKey(model.list, key, { alignment: "Center" }))

/** Within half a viewport of the newest loaded row: time to load a newer page of a capped window. */
export const isNearEnd = (model: Model) => {
	const viewportHeight = viewportHeightOf(model)
	return (
		viewportHeight > 0 &&
		model.keys.length > 0 &&
		maxScrollTop(model) - model.list.scrollTop < viewportHeight / 2
	)
}

/** Within half a viewport of the oldest loaded row: time to load an older page. */
export const isNearStart = (model: Model) => {
	const viewportHeight = viewportHeightOf(model)
	return viewportHeight > 0 && model.keys.length > 0 && model.list.scrollTop < viewportHeight / 2
}

/** Whether the window reaches the newest row; while it does not, the list anchors on rows only. */
export const setCanFollowEnd = (model: Model, canFollowEnd: boolean): Model => {
	const isFollowing = model.list.endBehavior._tag === "Follow"
	if (isFollowing === canFollowEnd) return model
	return modifyFields(model, {
		list: (list) =>
			modifyFields(list, {
				endBehavior: () =>
					canFollowEnd
						? { _tag: "Follow", thresholdPx: model.followThresholdPx }
						: { _tag: "PreserveAnchor" },
				viewportAnchor: (anchor) =>
					!canFollowEnd && anchor._tag === "End"
						? { _tag: "Offset", scrollTop: list.scrollTop }
						: anchor,
			}),
	})
}

// VIEW

export interface ViewInputs<Item, ParentMessage> {
	/** Same order as `model.keys`, oldest first. */
	readonly items: ReadonlyArray<Item>
	readonly itemToKey: (item: Item) => string
	readonly itemToView: (item: Item, context: { readonly isStuck: boolean }) => Html
	readonly toParentMessage: (message: Message) => ParentMessage
}

/** The last divider at or above the scroll position, as LegendList's `activeStickyIndex`. */
const activeStickyIndexOf = (model: Model, layout: Layout): number | undefined => {
	const scrollTop = Math.min(model.list.scrollTop, maxScrollTop(model, layout))
	let active: number | undefined
	for (const key of model.stickyKeys) {
		const index = layout.indexByKey.get(key)
		if (
			index !== undefined &&
			layout.offsets[index]! <= scrollTop &&
			(active === undefined || index > active)
		)
			active = index
	}
	return active
}

const rowsView = VirtualList.view<number>()

/** The list plus the pinned divider, which sits over the list's top edge. */
export const view = <Item, ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	inputs: ViewInputs<Item, ParentMessage>,
): ReadonlyArray<Html> => {
	const layout = layoutOf(model)
	const activeIndex = activeStickyIndexOf(model, layout)
	const indexes = Array.from({ length: inputs.items.length }, (_, index) => index)
	const pinned =
		activeIndex === undefined
			? h.empty
			: h.div(
					[
						h.AriaHidden(true),
						h.Style({ position: "sticky", top: "0px", height: "0px", "z-index": "1000" }),
					],
					[inputs.itemToView(inputs.items[activeIndex]!, { isStuck: true })],
				)
	return [
		pinned,
		h.submodel({
			slotId: "message-list",
			model: model.list,
			view: rowsView,
			viewInputs: {
				items: indexes,
				itemToKey: (index) => inputs.itemToKey(inputs.items[index]!),
				itemToView: (index) => inputs.itemToView(inputs.items[index]!, { isStuck: false }),
				dynamicRowHeights: true,
				itemToEstimatedRowHeightPx: () => model.estimatedRowHeightPx,
				rowElement: "div",
				contentAlignment: "End",
				containerAttributes: childAttributes([
					h.Style({
						overflow: "auto",
						flex: "1 1 0%",
						"min-height": "0px",
						"overflow-anchor": "none",
					}),
				]),
			},
			toParentMessage: inputs.toParentMessage,
		}),
	]
}
