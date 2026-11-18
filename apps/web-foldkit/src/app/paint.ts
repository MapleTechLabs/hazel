/**
 * The last screen's paint: the app's markup as it last showed the org shell, kept in
 * `localStorage` so the next load draws it before the app's script has even loaded
 * (`./paint-boot.js`, inlined in `index.html`). The live app starts underneath it as before; the
 * paint goes as soon as the app has drawn its own screen in place of the loader
 * (`handOffPaint`), which with the local cache (`core/db/local-cache.ts`) is the same rows.
 *
 * It is taken whenever the page is hidden or left, and every half minute while the screen
 * changes, for the remembered user only (`./remembered-user.ts`), and goes with them.
 */

import { Option, Schema } from "effect"

export const PAINT_KEY = "hazel:paint"
const USER_KEY = "hazel:last-user"
const VERSION = 1

/** A paint larger than this is not kept: reading it would cost the load more than it saves. */
export const MAX_PAINT_CHARS = 1_500_000
/**
 * The longest the paint stays up when the app never draws the screen in place of its loader. The
 * boot script holds the same limit from when the paint appears (`paint-boot.js`), so a slow script
 * cannot extend it; this one only applies where the paint was drawn without it (tests).
 */
export const MAX_PAINT_MS = 6000
const SAVE_EVERY_MS = 30_000

/** Elements whose scroll offsets the paint keeps (Tailwind's overflow utilities). */
const SCROLLERS =
	'[class*="overflow-y-auto"],[class*="overflow-auto"],[class*="overflow-x-auto"],[class*="overflow-y-scroll"]'

/** What the paint never keeps: overlays, menus, toasts and the like. */
const TRANSIENT =
	'dialog,[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[popover],[data-paint-skip]'

/**
 * The marks the app's view sets: the org shell, its loader, and a message list still loading; and
 * a page whose code has not loaded yet (`app/view.ts`, `pageBody`).
 */
export const PAINT_SHELL = '[data-paint="shell"]'
const PAINT_WAITING = '[data-paint="loader"],[data-paint="loading"],[data-page-placeholder]'

export interface StoredPaint {
	readonly v: number
	readonly userId: string
	readonly path: string
	readonly html: string
	readonly theme: string | null
	readonly rootStyle: string
	readonly isMobile: boolean
	readonly isSystemDark: boolean
	readonly savedAtMs: number
}

const decodeRememberedUser = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Struct({ id: Schema.String })),
)

const rememberedUserId = (storage: Storage): string | null =>
	Option.match(decodeRememberedUser(storage.getItem(USER_KEY)), {
		onNone: () => null,
		onSome: (user) => user.id,
	})

/** The paint of `doc`'s org shell, or `null` when the app shows something else or no one is remembered. */
export const takePaint = (doc: Document, storage: Storage, nowMs: number): StoredPaint | null => {
	const live = doc.getElementById("app")
	const userId = rememberedUserId(storage)
	if (live === null || userId === null || !live.matches(PAINT_SHELL)) return null
	// The screen must be the remembered user's own: after a switch of user (in this tab or
	// another), the page can still show the previous one's rows.
	if (live.getAttribute("data-paint-user") !== userId) return null
	if (live.querySelector(PAINT_WAITING) !== null) return null
	const copy = live.cloneNode(true) as HTMLElement
	// Same selector on the same tree: the copies line up with the originals.
	const scrollers = live.querySelectorAll(SCROLLERS)
	const copies = copy.querySelectorAll(SCROLLERS)
	scrollers.forEach((element, index) => {
		if (element.scrollTop !== 0 || element.scrollLeft !== 0)
			copies[index]?.setAttribute("data-paint-scroll", `${element.scrollTop} ${element.scrollLeft}`)
	})
	for (const element of copy.querySelectorAll(TRANSIENT)) element.remove()
	const html = copy.outerHTML
	if (html.length > MAX_PAINT_CHARS) return null
	const root = doc.documentElement
	const view = doc.defaultView
	return {
		v: VERSION,
		userId,
		path: view?.location.pathname ?? "/",
		html,
		theme: root.classList.contains("dark") ? "dark" : root.classList.contains("light") ? "light" : null,
		rootStyle: root.style.cssText,
		isMobile: view?.matchMedia("(max-width: 767px)").matches ?? false,
		isSystemDark: view?.matchMedia("(prefers-color-scheme: dark)").matches ?? false,
		savedAtMs: nowMs,
	}
}

/** Keeps the current screen's paint, or none when there is nothing to keep. */
export const savePaint = (doc: Document, storage: Storage): void => {
	try {
		// A page event (hidden, left), outside any update.
		// oxlint-disable-next-line foldkit/no-impure-call-at-decision-time
		const paint = takePaint(doc, storage, Date.now())
		// Another screen (signed out, an error) is not the last screen to resume.
		if (paint === null) {
			if (rememberedUserId(storage) === null) storage.removeItem(PAINT_KEY)
			return
		}
		storage.setItem(PAINT_KEY, JSON.stringify(paint))
	} catch {
		// Full or blocked storage: the next load starts at the loader, as without a paint.
		try {
			storage.removeItem(PAINT_KEY)
		} catch {}
	}
}

/** The session ended: its screen goes with it. */
export const forgetPaint = (): void => {
	try {
		globalThis.localStorage?.removeItem(PAINT_KEY)
	} catch {}
}

/** Whether the live app has drawn a screen of its own: neither nothing yet, nor a loader. */
export const hasLiveScreen = (doc: Document): boolean => {
	const live = doc.getElementById("app")
	return live !== null && live.firstElementChild !== null && live.querySelector(PAINT_WAITING) === null
}

/**
 * Takes the paint down once the live app has drawn its own screen, or after `MAX_PAINT_MS`; and
 * at the first press or key once the live shell is up, so input never lands on the inert copy
 * while a channel's messages are still on their way. Returns a function that takes it down at once.
 */
export const handOffPaint = (doc: Document, maxMs: number = MAX_PAINT_MS): (() => void) => {
	const paint = doc.querySelector("[data-hazel-paint]")
	if (paint === null) return () => {}
	let frame = 0
	const view = doc.defaultView
	const done = () => {
		observer.disconnect()
		clearTimeout(timeout)
		cancelAnimationFrame(frame)
		view?.removeEventListener("pointerdown", onInput, true)
		view?.removeEventListener("keydown", onInput, true)
		paint.remove()
	}
	const onInput = () => {
		if (doc.getElementById("app")?.matches(PAINT_SHELL)) done()
	}
	view?.addEventListener("pointerdown", onInput, true)
	view?.addEventListener("keydown", onInput, true)
	const check = () => {
		frame = 0
		// Gone already: the boot script's own limit took it down.
		if (!paint.isConnected || hasLiveScreen(doc)) done()
	}
	const observer = new MutationObserver(() => {
		if (frame === 0) frame = requestAnimationFrame(check)
	})
	observer.observe(doc.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["data-paint"],
	})
	const timeout = setTimeout(done, maxMs)
	return done
}

/** `localStorage`, or `null` where reading it throws (blocked storage, a partitioned frame). */
export const paintStorage = (): Storage | null => {
	try {
		return globalThis.localStorage ?? null
	} catch {
		return null
	}
}

/** Keeps the screen's paint while the page lives: when hidden or left, and now and then as it changes. */
export const installPaintCapture = (doc: Document, storage: Storage): void => {
	const view = doc.defaultView
	if (view === null) return
	let isDirty = true
	const save = () => {
		isDirty = false
		savePaint(doc, storage)
	}
	new MutationObserver(() => {
		isDirty = true
	}).observe(doc.body, { childList: true, subtree: true, characterData: true })
	doc.addEventListener("visibilitychange", () => {
		if (doc.visibilityState === "hidden") save()
	})
	view.addEventListener("pagehide", save)
	const idle = (callback: () => void) =>
		"requestIdleCallback" in view
			? view.requestIdleCallback(callback, { timeout: 5000 })
			: setTimeout(callback, 0)
	setInterval(() => {
		if (isDirty && doc.visibilityState === "visible") idle(save)
	}, SAVE_EVERY_MS)
}
