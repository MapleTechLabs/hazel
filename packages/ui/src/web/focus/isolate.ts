/**
 * A modal overlay's hold on the page behind it (lane A3, today's `isolateOverlay`): scroll locks and the
 * rest turns `inert` and `aria-hidden`, both reference counted so nested overlays share them.
 */

interface ScrollLock {
	count: number
	readonly overflow: string
	readonly paddingRight: string
	readonly stop: () => void
}

const scrollLocks = new WeakMap<Document, ScrollLock>()

const scrolls = (element: Element) => {
	const view = element.ownerDocument.defaultView
	if (view === null) return false
	const overflowY = view.getComputedStyle(element).overflowY
	return (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight
}

const isIOS = (view: Window) => {
	const { platform, maxTouchPoints } = view.navigator
	return /iPhone/i.test(platform) || (/Mac/i.test(platform) && maxTouchPoints > 0)
}

/** Locks the page's scroll (Foldkit's `Dom.lockScroll`): `overflow: hidden` with the scrollbar's width kept. */
export const lockScroll = (document: Document): (() => void) => {
	const existing = scrollLocks.get(document)
	if (existing !== undefined) existing.count += 1
	else {
		const root = document.documentElement
		const view = document.defaultView
		const { overflow, paddingRight } = root.style
		const scrollbar = view === null ? 0 : view.innerWidth - root.clientWidth
		root.style.overflow = "hidden"
		if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`
		// iOS Safari scrolls the page under `overflow: hidden`: a touch outside a scroll box is held.
		const onTouchMove = (event: TouchEvent) => {
			const target = event.composedPath()[0]
			let node = target instanceof Element ? target : null
			while (node !== null && node !== root) {
				if (scrolls(node)) return
				node = node.parentElement
			}
			event.preventDefault()
		}
		const touch = view !== null && isIOS(view)
		if (touch) document.addEventListener("touchmove", onTouchMove, { passive: false })
		const stop = () => {
			if (touch) document.removeEventListener("touchmove", onTouchMove)
		}
		scrollLocks.set(document, { count: 1, overflow, paddingRight, stop })
	}
	let released = false
	return () => {
		if (released) return
		released = true
		const lock = scrollLocks.get(document)
		if (lock === undefined) return
		lock.count -= 1
		if (lock.count > 0) return
		scrollLocks.delete(document)
		document.documentElement.style.overflow = lock.overflow
		document.documentElement.style.paddingRight = lock.paddingRight
		lock.stop()
	}
}

interface Marked {
	count: number
	readonly ariaHidden: string | null
	readonly inert: boolean
}

const marks = new WeakMap<Element, Marked>()

const mark = (element: HTMLElement) => {
	const existing = marks.get(element)
	if (existing !== undefined) {
		existing.count += 1
		return
	}
	marks.set(element, { count: 1, ariaHidden: element.getAttribute("aria-hidden"), inert: element.inert })
	element.setAttribute("aria-hidden", "true")
	element.inert = true
}

const unmark = (element: HTMLElement) => {
	const marked = marks.get(element)
	if (marked === undefined) return
	marked.count -= 1
	if (marked.count > 0) return
	marks.delete(element)
	if (marked.ariaHidden === null) element.removeAttribute("aria-hidden")
	else element.setAttribute("aria-hidden", marked.ariaHidden)
	element.inert = marked.inert
}

/** The siblings of `keep` and of each of its ancestors up to the body: everything else on the page. */
const outside = (keep: Element): ReadonlyArray<HTMLElement> => {
	const found: Array<HTMLElement> = []
	let node: Element = keep
	const body = keep.ownerDocument.body
	while (node.parentElement !== null && node !== body) {
		for (const sibling of node.parentElement.children)
			if (sibling !== node && sibling instanceof HTMLElement && sibling.tagName !== "SCRIPT")
				found.push(sibling)
		if (node.parentElement === body) break
		node = node.parentElement
	}
	return found
}

/** Makes everything outside `keep` inert and hidden from assistive technology (Foldkit's `Dom.inertOthers`). */
export const inertOthers = (keep: Element): (() => void) => {
	const marked = outside(keep)
	for (const element of marked) mark(element)
	let released = false
	return () => {
		if (released) return
		released = true
		for (const element of marked) unmark(element)
	}
}

/** Scroll lock and inert outside `keep`, released together. */
export const isolate = (keep: Element): (() => void) => {
	const unlock = lockScroll(keep.ownerDocument)
	const restore = inertOthers(keep)
	return () => {
		restore()
		unlock()
	}
}
