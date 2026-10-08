/**
 * Splits a DevTools timeline trace's renderer main-thread time into script, style, layout, paint,
 * GC and other, by self time (nested events are subtracted from their parents).
 */

export interface TraceEvent {
	readonly ph: string
	readonly name: string
	readonly pid: number
	readonly tid: number
	readonly ts: number
	readonly dur?: number
	readonly args?: { readonly name?: string }
}

export const TRACE_CATEGORIES = [
	"toplevel",
	"devtools.timeline",
	"disabled-by-default-devtools.timeline",
	"v8.execute",
	"blink",
]

type Category = "script" | "style" | "layout" | "paint" | "gc" | "other"

const categoryOf = (name: string): Category => {
	if (
		/^(FunctionCall|EvaluateScript|TimerFire|EventDispatch|RunMicrotasks|FireAnimationFrame|v8\.|V8\.|CompileScript|ParseHTML|XHR|FireIdleCallback)/.test(
			name,
		)
	)
		return "script"
	if (/^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet)/.test(name)) return "style"
	if (/^(Layout|UpdateLayout)$/.test(name)) return "layout"
	if (
		/^(Paint|PrePaint|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit|PaintImage|RasterTask|Decode)/.test(
			name,
		)
	)
		return "paint"
	if (/GC|GarbageCollect/.test(name)) return "gc"
	return "other"
}

export type TraceSplit = Record<"busy" | "script" | "style" | "layout" | "paint" | "gc" | "other", number>

/** Milliseconds per category on every CrRendererMain thread in the trace. */
export const splitTrace = (events: ReadonlyArray<TraceEvent>): TraceSplit => {
	const mainThreads = new Set(
		events
			.filter(
				(event) =>
					event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain",
			)
			.map((event) => `${event.pid}:${event.tid}`),
	)
	const split: TraceSplit = { busy: 0, script: 0, style: 0, layout: 0, paint: 0, gc: 0, other: 0 }
	const byThread = new Map<string, TraceEvent[]>()
	for (const event of events) {
		const key = `${event.pid}:${event.tid}`
		if (event.ph !== "X" || !event.dur || !mainThreads.has(key)) continue
		const list = byThread.get(key) ?? []
		list.push(event)
		byThread.set(key, list)
	}
	for (const list of byThread.values()) {
		list.sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0))
		const stack: Array<{ end: number; category: Category; self: number }> = []
		const close = (until: number) => {
			while (stack.length && stack[stack.length - 1]!.end <= until) {
				const done = stack.pop()!
				split[done.category] += done.self / 1000
			}
		}
		for (const event of list) {
			const dur = event.dur ?? 0
			close(event.ts)
			const parent = stack[stack.length - 1]
			if (parent) parent.self -= Math.min(dur, parent.end - event.ts)
			else split.busy += dur / 1000
			stack.push({ end: event.ts + dur, category: categoryOf(event.name), self: dur })
		}
		close(Number.POSITIVE_INFINITY)
	}
	return split
}

/** The renderer main thread that ran our rAF probe (other renderers in the trace are ignored). */
const pageMainThread = (events: ReadonlyArray<TraceEvent>) => {
	const mains = events
		.filter(
			(event) =>
				event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain",
		)
		.map((event) => `${event.pid}:${event.tid}`)
	const rafCount = new Map<string, number>()
	for (const event of events)
		if (event.name === "FireAnimationFrame") {
			const key = `${event.pid}:${event.tid}`
			rafCount.set(key, (rafCount.get(key) ?? 0) + 1)
		}
	return mains.sort((a, b) => (rafCount.get(b) ?? 0) - (rafCount.get(a) ?? 0))[0]
}

/**
 * Main-thread work per frame: top-level task time between consecutive animation frames. This is the
 * number that has to fit in 8.33 ms for 120 fps, independent of the 60 Hz headless vsync.
 */
export const frameCosts = (events: ReadonlyArray<TraceEvent>): ReadonlyArray<number> => {
	const main = pageMainThread(events)
	if (main === undefined) return []
	const onMain = events.filter(
		(event) => `${event.pid}:${event.tid}` === main && event.ph === "X" && event.dur,
	)
	const starts = onMain
		.filter((event) => event.name === "FireAnimationFrame")
		.map((event) => event.ts)
		.sort((a, b) => a - b)
	const topLevel: Array<[number, number]> = []
	let coveredUntil = 0
	for (const event of [...onMain].sort((a, b) => a.ts - b.ts)) {
		const end = event.ts + (event.dur ?? 0)
		if (event.ts >= coveredUntil) topLevel.push([event.ts, end])
		else if (end > coveredUntil) topLevel[topLevel.length - 1]![1] = end
		coveredUntil = Math.max(coveredUntil, end)
	}
	const costs: number[] = []
	let cursor = 0
	for (let frame = 0; frame + 1 < starts.length; frame++) {
		const [from, to] = [starts[frame]!, starts[frame + 1]!]
		while (cursor < topLevel.length && topLevel[cursor]![1] <= from) cursor++
		let busy = 0
		for (let i = cursor; i < topLevel.length && topLevel[i]![0] < to; i++)
			busy += Math.min(to, topLevel[i]![1]) - Math.max(from, topLevel[i]![0])
		costs.push(busy / 1000)
	}
	return costs
}

/** `splitTrace` restricted to the page's main thread. */
export const splitPageTrace = (events: ReadonlyArray<TraceEvent>): TraceSplit => {
	const main = pageMainThread(events)
	return splitTrace(
		events.filter(
			(event) =>
				`${event.pid}:${event.tid}` === main &&
				(event.ph === "X" || (event.ph === "M" && event.name === "thread_name")),
		),
	)
}
