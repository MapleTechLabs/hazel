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
	/** scrollTop / scrollHeight before and after the run. */
	readonly geometry: readonly [number, number, number, number]
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
			!(
				scroller.scrollHeight > scroller.clientHeight + 1 &&
				/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
			)
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
		const startGeometry = [scroller.scrollTop, scroller.scrollHeight] as const
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
		const geometry = [...startGeometry, scroller.scrollTop, scroller.scrollHeight].map(Math.round) as [
			number,
			number,
			number,
			number,
		]
		return { frameMs, blankFrames, longTasks, longTaskMs, scrolledPx, maxRowsInDom, geometry }
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
			!(
				scroller.scrollHeight > scroller.clientHeight + 1 &&
				/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
			)
		)
			scroller = scroller.parentElement
		if (!scroller) throw new Error("no scroller")
		const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
		const viewport = scroller.clientHeight
		const rect = scroller.getBoundingClientRect()
		// Start one viewport from the top (outside the half-viewport threshold) and let rows render.
		scroller.scrollTop = viewport
		for (let frame = 0; frame < 15; frame++) await nextFrame()
		const anchorElement = document
			.elementFromPoint(rect.left + rect.width / 2, rect.top + 60)
			?.closest("[data-id]")
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
			trace.push([
				Math.round(scroller.scrollTop),
				scroller.scrollHeight,
				Math.round(top - (startTop + ownScroll)),
			])
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

export interface LiveUpdateStats {
	readonly newMessageMs: ReadonlyArray<number>
	readonly stuckToBottom: number
	readonly newMessageVisible: number
	readonly reactionAddMs: ReadonlyArray<number>
	readonly reactionRemoveMs: ReadonlyArray<number>
}

/**
 * Pushes messages (then a reaction toggle on each) through the fixture's live events while the
 * reader sits at the bottom; times each until it shows in the DOM and checks the list followed it.
 */
export const measureLiveUpdates = (
	page: Page,
	options: { readonly pushUrl: string; readonly channelId: string; readonly authorId: string; readonly nowMs: number; readonly count: number; readonly idBase: number },
): Promise<LiveUpdateStats> =>
	page.evaluate(async ({ pushUrl, channelId, authorId, nowMs, count, idBase }) => {
		const row = document.querySelector("[data-id]")
		let scroller = row?.parentElement ?? null
		while (
			scroller &&
			!(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
		)
			scroller = scroller.parentElement
		if (!scroller) throw new Error("no scroller")
		const list = scroller
		const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
		const until = async (condition: () => boolean) => {
			const started = performance.now()
			while (!condition()) {
				if (performance.now() - started > 5000) return Number.NaN
				await nextFrame()
			}
			return performance.now()
		}
		const push = (body: unknown) => fetch(pushUrl, { method: "POST", body: JSON.stringify(body) })
		const uuid = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${String(idBase + index).padStart(12, "0")}`
		list.scrollTop = list.scrollHeight
		for (let frame = 0; frame < 20; frame++) await nextFrame()

		const newMessageMs: number[] = []
		const reactionAddMs: number[] = []
		const reactionRemoveMs: number[] = []
		let stuckToBottom = 0
		let newMessageVisible = 0
		for (let index = 1; index <= count; index++) {
			const id = uuid("eeeeeeee", index)
			const began = performance.now()
			await push({
				table: "messages",
				operation: "insert",
				row: {
					id,
					channelId,
					conversationId: null,
					authorId,
					content: `Live message ${index} arriving at the bottom`,
					embeds: null,
					replyToMessageId: null,
					threadChannelId: null,
					createdAt: new Date(nowMs + index * 1000).toISOString(),
					updatedAt: null,
					deletedAt: null,
				},
			})
			newMessageMs.push((await until(() => document.querySelector(`[data-id="${id}"]`) !== null)) - began)
			for (let frame = 0; frame < 15; frame++) await nextFrame()
			if (list.scrollHeight - list.clientHeight - list.scrollTop <= 2) stuckToBottom++
			const element = document.querySelector(`[data-id="${id}"]`)
			if (element && element.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1) newMessageVisible++

			const reactionId = uuid("dddddddd", index)
			const reaction = { id: reactionId, messageId: id, channelId, conversationId: null, userId: authorId, emoji: "🚀", createdAt: new Date(nowMs).toISOString() }
			const hasRocket = () => (document.querySelector(`[data-id="${id}"]`)?.textContent ?? "").includes("🚀")
			const addBegan = performance.now()
			await push({ table: "message_reactions", operation: "insert", row: reaction })
			reactionAddMs.push((await until(hasRocket)) - addBegan)
			const removeBegan = performance.now()
			await push({ table: "message_reactions", operation: "delete", row: reaction })
			reactionRemoveMs.push((await until(() => !hasRocket())) - removeBegan)
		}
		return { newMessageMs, stuckToBottom, newMessageVisible, reactionAddMs, reactionRemoveMs }
	}, options)
