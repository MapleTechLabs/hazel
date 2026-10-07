import type { Page } from "playwright"

/**
 * In-page probes for the chat list benchmark. Each function runs inside the page through
 * `page.evaluate`, so it must be self-contained. Both apps render one `[data-id]` element per
 * message, and the scroller is the nearest scrollable ancestor of a message.
 */

export interface FrameStats {
	readonly frameMs: ReadonlyArray<number>
	readonly blankFrames: number
	readonly longTasks: number
	readonly longTaskMs: number
	readonly scrolledPx: number
	readonly maxRowsInDom: number
}

/** Init script: records when the first message row enters the DOM (ms since navigation start). */
export const installFirstRowProbe = () => {
	const observer = new MutationObserver(() => {
		if (document.querySelector("[data-id]")) {
			;(window as unknown as { __firstRowAt: number }).__firstRowAt = performance.now()
			observer.disconnect()
		}
	})
	observer.observe(document, { childList: true, subtree: true })
}

/** Waits for the list to render and settle; returns the first-row time. */
export const prepareList = async (page: Page): Promise<number> => {
	await page.waitForSelector("[data-id]", { timeout: 30_000 })
	return page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				let timer = setTimeout(done, 600)
				const observer = new MutationObserver(() => {
					clearTimeout(timer)
					timer = setTimeout(done, 600)
				})
				observer.observe(document.body, { childList: true, subtree: true, attributes: true })
				function done() {
					observer.disconnect()
					resolve((window as unknown as { __firstRowAt?: number }).__firstRowAt ?? Number.NaN)
				}
			}),
	)
}

/** Scrolls `speed` px per frame for `seconds`, recording rAF intervals, blank frames and long tasks. */
export const measureFrames = (
	page: Page,
	options: { readonly direction: 1 | -1; readonly seconds: number; readonly speed: number },
): Promise<FrameStats> =>
	page.evaluate(async ({ direction, seconds, speed }) => {
		const row = document.querySelector("[data-id]")
		let scroller = row?.parentElement ?? null
		while (
			scroller &&
			!(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
		)
			scroller = scroller.parentElement
		if (!scroller) throw new Error("no scroller")
		const rect = scroller.getBoundingClientRect()
		const probe = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
		let longTasks = 0
		let longTaskMs = 0
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				longTasks++
				longTaskMs += entry.duration
			}
		})
		observer.observe({ type: "longtask", buffered: false })
		const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
		const frameMs: number[] = []
		let blankFrames = 0
		let scrolledPx = 0
		let maxRowsInDom = 0
		let last = await nextFrame()
		const end = last + seconds * 1000
		for (;;) {
			const before = scroller.scrollTop
			scroller.scrollTop = before + direction * speed
			scrolledPx += Math.abs(scroller.scrollTop - before)
			const now = await nextFrame()
			frameMs.push(now - last)
			last = now
			const hit = document.elementFromPoint(probe.x, probe.y)
			if (!hit?.closest("[data-id], [data-list-key], [data-index]")) blankFrames++
			maxRowsInDom = Math.max(maxRowsInDom, scroller.querySelectorAll("[data-id]").length)
			if (now > end) break
		}
		observer.disconnect()
		return { frameMs, blankFrames, longTasks, longTaskMs, scrolledPx, maxRowsInDom }
	}, options)

export interface PrependAnchorStats {
	readonly anchorId: string
	readonly prependedPx: number
	readonly maxDeviationPx: number
	readonly framesOver1px: number
	readonly missingFrames: number
	/** Per frame: scrollTop, scrollHeight, deviation (px). */
	readonly trace: ReadonlyArray<readonly [number, number, number]>
}

/**
 * Picks the message under a probe near the top, scrolls into the load-older threshold and holds
 * still while the older page lands. Deviation = how far the anchor moved beyond our own scrolling.
 */
export const measurePrependAnchor = (page: Page): Promise<PrependAnchorStats> =>
	page.evaluate(async () => {
		const row = document.querySelector("[data-id]")
		let scroller = row?.parentElement ?? null
		while (
			scroller &&
			!(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
		)
			scroller = scroller.parentElement
		if (!scroller) throw new Error("no scroller")
		const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
		const viewport = scroller.clientHeight
		const rect = scroller.getBoundingClientRect()
		// Start one viewport from the top (outside the half-viewport threshold) and let rows render.
		scroller.scrollTop = viewport
		for (let frame = 0; frame < 15; frame++) await nextFrame()
		const anchorElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 60)?.closest("[data-id]")
		const anchorId = anchorElement?.getAttribute("data-id")
		if (!anchorElement || !anchorId) throw new Error("no anchor row under the probe")
		const relativeTop = () => {
			const element = document.querySelector(`[data-id="${anchorId}"]`)
			return element ? element.getBoundingClientRect().top - rect.top : undefined
		}
		const startTop = relativeTop()!
		const startHeight = scroller.scrollHeight
		let ownScroll = 0
		let maxDeviationPx = 0
		let framesOver1px = 0
		let missingFrames = 0
		const trace: Array<readonly [number, number, number]> = []
		const sample = () => {
			const top = relativeTop()
			if (top === undefined) {
				missingFrames++
				return
			}
			const deviation = Math.abs(top - (startTop + ownScroll))
			trace.push([Math.round(scroller.scrollTop), scroller.scrollHeight, Math.round(top - (startTop + ownScroll))])
			maxDeviationPx = Math.max(maxDeviationPx, deviation)
			if (deviation > 1) framesOver1px++
		}
		for (let step = 0; step < 6; step++) {
			const before = scroller.scrollTop
			scroller.scrollTop = before - 80
			ownScroll += before - scroller.scrollTop
			await nextFrame()
			sample()
		}
		for (let frame = 0; frame < 90; frame++) {
			await nextFrame()
			sample()
		}
		return {
			anchorId,
			prependedPx: Math.round(scroller.scrollHeight - startHeight),
			maxDeviationPx: Math.round(maxDeviationPx * 10) / 10,
			framesOver1px,
			missingFrames,
			trace,
		}
	})
