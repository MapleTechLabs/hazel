/**
 * In-page probes for the perf suite (`perf.ts`). `installPerfProbes` runs as an init script and
 * exposes `window.__perf`; everything inside must be self-contained. Times are `performance.now()`.
 */

export interface FrameRun {
	readonly frameMs: ReadonlyArray<number>
	readonly blankFrames: number
	readonly longTasks: number
	readonly longTaskMs: number
	readonly scrolledPx: number
}

export interface ReadyResult {
	/** Input event timestamp to the first frame where the condition held, plus a post-paint task. */
	readonly ms: number
	readonly frames: number
	/** Frames between input and ready where no message row was in the DOM (blank or spinner). */
	readonly blankFrames: number
	readonly timedOut: boolean
}

/** What "ready" means: a visible element matching `selector`, a visible row from `ids`, or `text`. */
export interface ReadySpec {
	readonly selector?: string
	readonly ids?: ReadonlyArray<string>
	readonly text?: string
	/** For typing: the focused editor's text length reaches this. */
	readonly editorLength?: number
}

export interface LoadMarks {
	readonly fcp: number
	readonly firstRow: number
	readonly tti: number
	readonly longTasks: number
}

/** Builds the probe API; injected as `window.__perf = (createPerfProbes)()` before any app code. */
export const createPerfProbes = () => {
	const longTasks: Array<readonly [number, number]> = []
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) longTasks.push([entry.startTime, entry.duration])
	}).observe({ type: "longtask", buffered: true })
	let lastInputAt = 0
	for (const type of ["pointerdown", "keydown"])
		window.addEventListener(type, (event) => (lastInputAt = event.timeStamp), { capture: true })
	let firstRowAt = Number.NaN
	const rowObserver = new MutationObserver(() => {
		if (document.querySelector("[data-id]")) {
			firstRowAt = performance.now()
			rowObserver.disconnect()
		}
	})
	rowObserver.observe(document, { childList: true, subtree: true })

	const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
	const afterPaint = () =>
		new Promise<number>((resolve) => {
			const channel = new MessageChannel()
			channel.port1.onmessage = () => resolve(performance.now())
			channel.port2.postMessage(null)
		})
	const visible = (element: Element | null) => {
		if (!element) return false
		const rect = element.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
	}
	const ready = (spec: {
		selector?: string
		ids?: ReadonlyArray<string>
		text?: string
		editorLength?: number
	}) => {
		if (spec.selector && !Array.from(document.querySelectorAll(spec.selector)).some(visible)) return false
		if (spec.ids) {
			const wanted = new Set(spec.ids)
			const rows = Array.from(document.querySelectorAll("[data-id]"))
			if (!rows.some((row) => wanted.has(row.getAttribute("data-id") ?? "") && visible(row)))
				return false
		}
		if (spec.text) {
			const literal = JSON.stringify(spec.text).replace(/^"|"$/g, "")
			const hit = document.evaluate(
				`//*[contains(text(), "${literal}")]`,
				document.body,
				null,
				XPathResult.FIRST_ORDERED_NODE_TYPE,
				null,
			).singleNodeValue
			if (!(hit instanceof Element) || !visible(hit)) return false
		}
		if (spec.editorLength !== undefined) {
			const active = document.activeElement
			const length =
				active instanceof HTMLTextAreaElement
					? active.value.length
					: (active?.textContent ?? "").length
			if (length < spec.editorLength) return false
		}
		return true
	}
	const scrollerOf = (start: Element | null) => {
		let element = start?.parentElement ?? null
		while (
			element &&
			!(
				element.scrollHeight > element.clientHeight + 1 &&
				/(auto|scroll)/.test(getComputedStyle(element).overflowY)
			)
		)
			element = element.parentElement
		return element
	}

	let recording: { stop: () => void; result: Promise<FrameRun> } | undefined
	const perf = {
		lastInputAt: () => lastInputAt,
		scrollerRect: (selector: string) => {
			const scroller = scrollerOf(document.querySelector(selector))
			if (!scroller) return undefined
			const rect = scroller.getBoundingClientRect()
			return {
				x: rect.left + rect.width / 2,
				y: rect.top + rect.height / 2,
				top: scroller.scrollTop,
				height: scroller.scrollHeight,
				client: scroller.clientHeight,
			}
		},
		scrollTo: (selector: string, where: "top" | "bottom" | number) => {
			const scroller = scrollerOf(document.querySelector(selector))
			if (!scroller) throw new Error(`no scroller for ${selector}`)
			scroller.scrollTop = where === "top" ? 0 : where === "bottom" ? scroller.scrollHeight : where
		},
		/** Records rAF intervals until `stopFrames`; a frame is blank when no row is under the probe. */
		startFrames: (options: { probeSelector: string; rowSelector: string }) => {
			const scroller = scrollerOf(document.querySelector(options.probeSelector))
			const rect = scroller?.getBoundingClientRect()
			const probe = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
			const startLongTasks = longTasks.length
			let stopped = false
			const result = (async (): Promise<FrameRun> => {
				const frameMs: number[] = []
				let blankFrames = 0
				let scrolledPx = 0
				let lastTop = scroller?.scrollTop ?? 0
				let last = await nextFrame()
				while (!stopped) {
					const now = await nextFrame()
					frameMs.push(now - last)
					last = now
					if (scroller) {
						scrolledPx += Math.abs(scroller.scrollTop - lastTop)
						lastTop = scroller.scrollTop
					}
					if (probe && !document.elementFromPoint(probe.x, probe.y)?.closest(options.rowSelector))
						blankFrames++
				}
				const tasks = longTasks.slice(startLongTasks)
				return {
					frameMs,
					blankFrames,
					longTasks: tasks.length,
					longTaskMs: tasks.reduce((sum, [, duration]) => sum + duration, 0),
					scrolledPx,
				}
			})()
			recording = { stop: () => (stopped = true), result }
		},
		stopFrames: async () => {
			const current = recording
			if (!current) throw new Error("not recording")
			current.stop()
			recording = undefined
			return current.result
		},
		/** Armed before the input; resolves once `spec` holds, measured from the input's timestamp. */
		waitReady: async (spec: Parameters<typeof ready>[0], timeoutMs: number) => {
			const armedAt = performance.now()
			let frames = 0
			let blankFrames = 0
			while (!ready(spec)) {
				if (performance.now() - armedAt > timeoutMs)
					return { ms: Number.NaN, frames, blankFrames, timedOut: true }
				await nextFrame()
				if (lastInputAt > armedAt) {
					frames++
					if (!document.querySelector("[data-id]")) blankFrames++
				}
			}
			const paintedAt = await afterPaint()
			return { ms: paintedAt - lastInputAt, frames, blankFrames, timedOut: false }
		},
		/** FCP, first message row, and a TTI estimate: end of the last long task before a 2 s quiet window. */
		loadMarks: async () => {
			const fcpEntry = performance.getEntriesByName("first-contentful-paint")[0]
			const fcp = fcpEntry?.startTime ?? Number.NaN
			for (;;) {
				const lastEnd = longTasks.reduce(
					(end, [start, duration]) => Math.max(end, start + duration),
					0,
				)
				const from = Math.max(lastEnd, firstRowAt, fcp)
				if (performance.now() - from >= 2000)
					return { fcp, firstRow: firstRowAt, tti: from, longTasks: longTasks.length }
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		},
	}
	return perf
}

export type PerfProbes = ReturnType<typeof createPerfProbes>

declare global {
	interface Window {
		__perf: PerfProbes
	}
}

export const perfProbesInitScript = `window.__perf = (${createPerfProbes.toString()})()`
