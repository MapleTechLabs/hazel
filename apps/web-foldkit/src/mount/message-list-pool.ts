import { Schema } from "effect"

/**
 * `@legendapp/list`'s container pool (`calculateItemsInView`, `findAvailableContainers` and the
 * sticky header handling of 3.0.0-beta.41), ported so the rendered rows, their DOM order (one
 * `<div>` per container, in container order) and the pinned divider match legacy exactly.
 * Velocity is taken as 0: legacy derives it from `Date.now()`, which is frozen in captures. Legacy
 * passes `onViewableItemsChanged`, which turns off the scroll bounds check, so every pass is full.
 */

/** `drawDistance` of the legacy `MessageVirtualList`. */
export const DRAW_DISTANCE_PX = 300
const INITIAL_POOL_RATIO = 2

export const Pool = Schema.Struct({
	/** `containerItemKey${i}`: the row each container holds; `null` for an empty container. */
	slots: Schema.Array(Schema.NullOr(Schema.String)),
	/** `stickyContainerPool`, in insertion order (a JS Set). */
	stickySlots: Schema.Array(Schema.Number),
	/** `numContainersPooled`: containers rendered, empty ones included. */
	pooledCount: Schema.Number,
})
export type Pool = typeof Pool.Type

export const emptyPool: Pool = { slots: [], stickySlots: [], pooledCount: 0 }

export interface PoolInputs {
	readonly keys: ReadonlyArray<string>
	readonly stickyIndexes: ReadonlyArray<number>
	readonly indexByKey: ReadonlyMap<string, number>
	/** `offsets[i]` is the top of row i, `offsets[n]` the total height. */
	readonly offsets: Float64Array
	readonly scrollTop: number
	readonly viewportHeight: number
	readonly estimatedItemSize: number
	/** Keys changed: containers of removed rows are freed. */
	readonly isDataChange: boolean
}

export interface Calculation {
	/** The same object when no container changed. */
	readonly pool: Pool
	/** `activeStickyIndex` as a key: the divider rendered `position: sticky`. */
	readonly activeStickyKey: string | null
}

/** First row whose bottom is below `y` (binary search over the offsets). */
const firstRowEndingAfter = (offsets: Float64Array, count: number, y: number): number | null => {
	let low = 0
	let high = count
	while (low < high) {
		const middle = (low + high) >>> 1
		if (offsets[middle + 1]! > y) high = middle
		else low = middle + 1
	}
	return low < count ? low : null
}

/** `startBuffered` and `endBuffered`: the buffered window, contiguous from the first visible row. */
const findStartAndEnd = (inputs: PoolInputs, scroll: number, top: number, bottom: number) => {
	const { offsets, keys } = inputs
	const startNoBuffer = firstRowEndingAfter(offsets, keys.length, scroll)
	const startBuffered = firstRowEndingAfter(offsets, keys.length, top)
	let endBuffered: number | null = null
	if (startNoBuffer !== null)
		for (let i = startNoBuffer; i < keys.length && offsets[i]! <= bottom; i++) endBuffered = i
	return { startBuffered, endBuffered }
}

/** One `calculateItemsInView` pass; `undefined` when nothing is rendered yet. */
export const calculate = (pool: Pool, inputs: PoolInputs): Calculation | undefined => {
	const { keys, offsets, viewportHeight, indexByKey } = inputs
	if (keys.length === 0 || viewportHeight === 0) return undefined
	let slots = [...pool.slots]
	let pooledCount = pool.pooledCount
	// doInitialAllocateContainers
	if (slots.length === 0) {
		const count = Math.ceil((viewportHeight + DRAW_DISTANCE_PX * 2) / inputs.estimatedItemSize)
		slots = Array.from({ length: count }, () => null)
		pooledCount = count * INITIAL_POOL_RATIO
	}
	const totalSize = offsets[keys.length]!
	let scroll = Math.round(inputs.scrollTop)
	if (scroll + viewportHeight > totalSize) scroll = Math.max(0, totalSize - viewportHeight)
	const stickyArray = inputs.stickyIndexes
	let currentStickyIdx = -1
	for (let i = stickyArray.length - 1; i >= 0; i--)
		if (scroll >= offsets[stickyArray[i]!]!) {
			currentStickyIdx = i
			break
		}
	const activeStickyKey = currentStickyIdx >= 0 ? keys[stickyArray[currentStickyIdx]!]! : null
	const isNearTop = scroll < Math.max(50, DRAW_DISTANCE_PX)
	const bufferTop = DRAW_DISTANCE_PX * (isNearTop ? 0.5 : 1.5)
	const bufferBottom = DRAW_DISTANCE_PX * (isNearTop ? 1.5 : 0.5)
	const top = scroll - bufferTop
	const bottom = scroll + viewportHeight + bufferBottom
	const { startBuffered, endBuffered } = findStartAndEnd(inputs, scroll, top, bottom)

	const stickySlots = new Set(pool.stickySlots)
	const slotByKey = new Map<string, number>()
	slots.forEach((key, slot) => key !== null && slotByKey.set(key, slot))
	const pendingRemoval: number[] = []
	if (inputs.isDataChange)
		slots.forEach((key, slot) => key !== null && !indexByKey.has(key) && pendingRemoval.push(slot))

	if (startBuffered !== null && endBuffered !== null) {
		const stickySet = new Set(stickyArray)
		const needed: number[] = []
		for (let i = startBuffered; i <= endBuffered; i++) if (!slotByKey.has(keys[i]!)) needed.push(i)
		// handleStickyActivation: the current divider and the one before it.
		const activeIndexes = new Set(
			[...stickySlots].flatMap((slot) => {
				const index = slots[slot] === null ? undefined : indexByKey.get(slots[slot]!)
				return index !== undefined && stickySet.has(index) ? [index] : []
			}),
		)
		for (let offset = 0; offset <= 1; offset++) {
			const idx = currentStickyIdx - offset
			if (idx < 0 || activeIndexes.has(stickyArray[idx]!)) continue
			const index = stickyArray[idx]!
			if (
				!slotByKey.has(keys[index]!) &&
				(index < startBuffered || index > endBuffered) &&
				!needed.includes(index)
			)
				needed.push(index)
		}
		if (needed.length > 0) {
			const available = findAvailable(
				slots,
				stickySlots,
				needed,
				stickySet,
				startBuffered,
				endBuffered,
				pendingRemoval,
				indexByKey,
			)
			needed.forEach((index, n) => {
				const slot = available[n]!
				const key = keys[index]!
				while (slots.length <= slot) slots.push(null)
				const oldKey = slots[slot]
				if (oldKey !== null && oldKey !== undefined && oldKey !== key) slotByKey.delete(oldKey)
				slots[slot] = key
				slotByKey.set(key, slot)
				if (stickySet.has(index)) stickySlots.add(slot)
				else stickySlots.delete(slot)
			})
			if (slots.length > pooledCount) pooledCount = Math.ceil(slots.length * 1.5)
		}
	}
	recycleStickies(slots, stickySlots, stickyArray, inputs, scroll, currentStickyIdx, pendingRemoval)
	for (const slot of pendingRemoval) {
		slots[slot] = null
		stickySlots.delete(slot)
	}
	const isUnchanged =
		pooledCount === pool.pooledCount &&
		slots.length === pool.slots.length &&
		slots.every((key, slot) => key === pool.slots[slot]) &&
		stickySlots.size === pool.stickySlots.length &&
		pool.stickySlots.every((slot) => stickySlots.has(slot))
	return {
		pool: isUnchanged ? pool : { slots, stickySlots: [...stickySlots], pooledCount },
		activeStickyKey,
	}
}

/** `findAvailableContainers`, including its quirks (new sticky and overflow containers can collide). */
const findAvailable = (
	slots: ReadonlyArray<string | null>,
	stickySlots: Set<number>,
	needed: ReadonlyArray<number>,
	stickySet: ReadonlySet<number>,
	startBuffered: number,
	endBuffered: number,
	pendingRemoval: number[],
	indexByKey: ReadonlyMap<string, number>,
): number[] => {
	const count = slots.length
	const result: number[] = []
	const pending = new Set(pendingRemoval)
	for (const _ of needed.filter((index) => stickySet.has(index))) {
		const reused = [...stickySlots].find(
			(slot) => (slots[slot] === null || pending.has(slot)) && !result.includes(slot),
		)
		if (reused !== undefined) {
			result.push(reused)
			pending.delete(reused)
		} else {
			const slot = count + result.filter((index) => index >= count).length
			result.push(slot)
			stickySlots.add(slot)
		}
	}
	for (let slot = 0; slot < count && result.length < needed.length; slot++) {
		if (stickySlots.has(slot)) continue
		const isPending = slots[slot] !== null && pending.has(slot)
		if (slots[slot] === null || isPending) {
			pending.delete(slot)
			result.push(slot)
		}
	}
	const outOfView: Array<{ distance: number; slot: number }> = []
	for (let slot = 0; slot < count && result.length < needed.length; slot++) {
		const key = slots[slot]
		if (stickySlots.has(slot) || key === null || key === undefined) continue
		const index = indexByKey.get(key)
		if (index === undefined || (index >= startBuffered && index <= endBuffered)) continue
		outOfView.push({
			distance: index < startBuffered ? startBuffered - index : index - endBuffered,
			slot,
		})
	}
	const remaining = needed.length - result.length
	if (remaining > 0) {
		if (outOfView.length > remaining) {
			outOfView.sort((a, b) => b.distance - a.distance)
			outOfView.length = remaining
		}
		for (const { slot } of outOfView) result.push(slot)
		const stillNeeded = needed.length - result.length
		for (let i = 0; i < stillNeeded; i++) result.push(count + i)
	}
	pendingRemoval.length = 0
	pendingRemoval.push(...pending)
	return result.sort((a, b) => a - b)
}

/** `handleStickyRecycling`: dividers far above the viewport give their container back. */
const recycleStickies = (
	slots: ReadonlyArray<string | null>,
	stickySlots: Set<number>,
	stickyArray: ReadonlyArray<number>,
	inputs: PoolInputs,
	scroll: number,
	currentStickyIdx: number,
	pendingRemoval: number[],
) => {
	for (const slot of stickySlots) {
		const key = slots[slot]
		const index = key === null || key === undefined ? undefined : inputs.indexByKey.get(key)
		if (index === undefined) continue
		const arrayIdx = stickyArray.indexOf(index)
		if (arrayIdx === -1) {
			stickySlots.delete(slot)
			continue
		}
		if (arrayIdx >= currentStickyIdx - 1 && arrayIdx <= currentStickyIdx + 1) continue
		const next = stickyArray[arrayIdx + 1]
		const shouldRecycle = next
			? scroll > inputs.offsets[next]! + DRAW_DISTANCE_PX * 2
			: scroll > inputs.offsets[index + 1]! + DRAW_DISTANCE_PX * 3
		if (shouldRecycle) pendingRemoval.push(slot)
	}
}
