// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	forgetPaint,
	handOffPaint,
	hasLiveScreen,
	PAINT_KEY,
	paintStorage,
	savePaint,
	takePaint,
} from "./paint"
import { hazelPaintBoot } from "./paint-boot.js"

const USER = { id: "11111111-1111-4111-8111-111111111111" }
const PATH = "/acme/chat/22222222-2222-4222-8222-222222222222"

let media = { mobile: false, dark: false }

const shell = (page: string) => `
	<div id="app" data-paint="shell" data-paint-user="${USER.id}">
		<aside><a href="/acme/chat/x" id="general">general</a></aside>
		<main><div class="flex overflow-y-auto" style="height:10px">${page}</div></main>
		<div role="dialog">a menu that was open</div>
	</div>`

beforeEach(() => {
	media = { mobile: false, dark: false }
	window.matchMedia = ((query: string) => ({
		matches: query.includes("max-width") ? media.mobile : query.includes("dark") ? media.dark : false,
	})) as typeof window.matchMedia
	localStorage.clear()
	localStorage.setItem("hazel:last-user", JSON.stringify(USER))
	window.history.replaceState(null, "", PATH)
	document.documentElement.className = "dark"
	document.documentElement.removeAttribute("style")
	document.body.innerHTML = shell("<p>hello from the cache</p>")
})

afterEach(() => {
	vi.useRealTimers()
})

/** A new load of the page: the boot script's two halves, with only an empty `#app` in the body. */
const load = () => {
	document.documentElement.className = ""
	document.body.innerHTML = '<div id="app"></div>'
	const boot = hazelPaintBoot(window)
	boot.read()
	boot.show()
	return document.querySelector<HTMLElement>("[data-hazel-paint]")
}

describe("taking the paint", () => {
	test("keeps the org shell, its scroll offsets and theme, and leaves out what was open over it", () => {
		// jsdom keeps no layout: the offsets a browser would report.
		const scroller = document.querySelector<HTMLElement>(".overflow-y-auto")!
		Object.defineProperty(scroller, "scrollTop", { value: 120 })
		Object.defineProperty(scroller, "scrollLeft", { value: 4 })
		const paint = takePaint(document, localStorage, 1000)!
		expect(paint).toMatchObject({ userId: USER.id, path: PATH, theme: "dark", isMobile: false })
		expect(paint.html).toContain("hello from the cache")
		expect(paint.html).not.toContain("a menu that was open")
		expect(paint.html).toContain('data-paint-scroll="120 4"')
	})

	test("nothing while the app shows its loader, a list still loading, or no one is remembered", () => {
		document.body.innerHTML = '<div id="app"><div data-paint="loader"></div></div>'
		expect(takePaint(document, localStorage, 0)).toBeNull()
		document.body.innerHTML = shell('<div data-paint="loading"></div>')
		expect(takePaint(document, localStorage, 0)).toBeNull()
		document.body.innerHTML = shell("<p>rows</p>")
		localStorage.removeItem("hazel:last-user")
		expect(takePaint(document, localStorage, 0)).toBeNull()
	})

	test("never under another user than the one the screen was drawn for", () => {
		// User B signed in (in this tab before its reload, or in another), while A's screen shows.
		localStorage.setItem(
			"hazel:last-user",
			JSON.stringify({ id: "33333333-3333-4333-8333-333333333333" }),
		)
		savePaint(document, localStorage)
		expect(localStorage.getItem(PAINT_KEY)).toBeNull()
		// A screen that names no user is no one's.
		localStorage.setItem("hazel:last-user", JSON.stringify(USER))
		document.getElementById("app")!.removeAttribute("data-paint-user")
		expect(takePaint(document, localStorage, 0)).toBeNull()
	})

	test("no storage where reading it throws", () => {
		const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get: () => {
				throw new DOMException("blocked", "SecurityError")
			},
		})
		try {
			expect(paintStorage()).toBeNull()
		} finally {
			Object.defineProperty(window, "localStorage", descriptor)
		}
		expect(paintStorage()).toBe(localStorage)
	})

	test("a screen too large to be worth reading is not kept", () => {
		document.body.innerHTML = shell(`<p>${"x".repeat(1_600_000)}</p>`)
		savePaint(document, localStorage)
		expect(localStorage.getItem(PAINT_KEY)).toBeNull()
	})

	test("goes with the session", () => {
		savePaint(document, localStorage)
		expect(localStorage.getItem(PAINT_KEY)).not.toBeNull()
		forgetPaint()
		expect(localStorage.getItem(PAINT_KEY)).toBeNull()
	})
})

describe("drawing the paint on the next load", () => {
	test("draws the last screen, inert and without ids, in its theme", () => {
		savePaint(document, localStorage)
		const paint = load()
		expect(paint).not.toBeNull()
		expect(paint!.textContent).toContain("hello from the cache")
		expect(paint!.hasAttribute("inert")).toBe(true)
		expect(paint!.querySelector("[id]")).toBeNull()
		expect(document.getElementById("app")!.childElementCount).toBe(0)
		expect(document.documentElement.classList.contains("dark")).toBe(true)
	})

	test("`/` resumes the painted page", () => {
		savePaint(document, localStorage)
		window.history.replaceState(null, "", "/?from=pwa")
		expect(load()).not.toBeNull()
		expect(window.location.pathname).toBe(PATH)
		expect(window.location.search).toBe("?from=pwa")
	})

	test("`/` stays put while a sign-in goes back to where it started", () => {
		savePaint(document, localStorage)
		sessionStorage.setItem("hazel:auth:return-to", "/auth/desktop?attempt=a")
		window.history.replaceState(null, "", "/")
		expect(load()).toBeNull()
		expect(window.location.pathname).toBe("/")
		sessionStorage.clear()
	})

	test("not on another page, for another user, at another layout or system theme", () => {
		savePaint(document, localStorage)
		window.history.replaceState(null, "", "/acme/settings")
		expect(load()).toBeNull()

		window.history.replaceState(null, "", PATH)
		localStorage.setItem("hazel:last-user", JSON.stringify({ id: "someone-else" }))
		expect(load()).toBeNull()

		localStorage.setItem("hazel:last-user", JSON.stringify(USER))
		media.mobile = true
		expect(load()).toBeNull()

		media = { mobile: false, dark: true }
		expect(load()).toBeNull()

		localStorage.removeItem("hazel:last-user")
		media.dark = false
		expect(load()).toBeNull()
	})

	test("drops what could run or load a document", () => {
		const root = document.createElement("div")
		root.innerHTML = `
			<img src="x" onerror="alert(1)">
			<a href=" javascript:alert(1)">link</a>
			<a href="/acme/chat">safe</a>
			<script>alert(1)</script>
			<iframe srcdoc="<script>alert(1)</script>"></iframe>
			<div contenteditable="true" autofocus id="x">draft</div>`
		hazelPaintBoot(window).sanitize(root)
		const html = root.innerHTML
		expect(html).not.toMatch(/onerror|javascript:|<script|<iframe|contenteditable|autofocus|id=/)
		expect(html).toContain('href="/acme/chat"')
		expect(html).toContain("draft")
	})
})

describe("handing off to the app", () => {
	test("stays while the app shows its loader or loads the list, and goes once it draws the screen", async () => {
		savePaint(document, localStorage)
		const paint = load()!
		handOffPaint(document)
		const live = document.getElementById("app")!
		live.innerHTML = '<div data-paint="loader"></div>'
		expect(hasLiveScreen(document)).toBe(false)
		live.outerHTML = shell('<div data-paint="loading"></div>')
		expect(hasLiveScreen(document)).toBe(false)
		document.querySelector('[data-paint="loading"]')!.replaceWith(document.createElement("p"))
		expect(hasLiveScreen(document)).toBe(true)
		await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)))
		expect(paint.isConnected).toBe(false)
	})

	test("an empty container is not the app's screen yet; a screen of another kind is", () => {
		document.body.innerHTML = '<div id="app"></div>'
		expect(hasLiveScreen(document)).toBe(false)
		document.body.innerHTML = '<div id="app"><p>Couldn\'t load your account</p></div>'
		expect(hasLiveScreen(document)).toBe(true)
	})

	test("goes at the first key once the live shell is up, though its list is still loading", () => {
		savePaint(document, localStorage)
		const paint = load()!
		handOffPaint(document)
		document.getElementById("app")!.innerHTML = '<div data-paint="loader"></div>'
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }))
		expect(paint.isConnected).toBe(true)
		document.getElementById("app")!.outerHTML = shell('<div data-paint="loading"></div>')
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }))
		expect(paint.isConnected).toBe(false)
	})

	test("the app's script starts after the paint's first frame, at once without one", () => {
		vi.useFakeTimers()
		const started = () => document.head.querySelectorAll('script[src="/entry.js"]').length
		document.body.innerHTML = '<div id="app"></div>'
		const bare = hazelPaintBoot(window)
		bare.read()
		bare.show()
		bare.start("/entry.js")
		expect(started()).toBe(1)
		document.head.querySelector('script[src="/entry.js"]')!.remove()

		document.body.innerHTML = shell("<p>rows</p>")
		savePaint(document, localStorage)
		const boot = hazelPaintBoot(window)
		document.body.innerHTML = '<div id="app"></div>'
		boot.read()
		boot.show()
		boot.start("/entry.js")
		expect(started()).toBe(0)
		vi.advanceTimersByTime(100)
		expect(started()).toBe(1)
	})

	test("goes six seconds after it appears, though the app's script never runs", () => {
		vi.useFakeTimers()
		savePaint(document, localStorage)
		const paint = load()!
		vi.advanceTimersByTime(5999)
		expect(paint.isConnected).toBe(true)
		vi.advanceTimersByTime(1)
		expect(paint.isConnected).toBe(false)
	})

	test("goes after a while even when the app never draws the screen", () => {
		vi.useFakeTimers()
		savePaint(document, localStorage)
		const paint = load()!
		handOffPaint(document, 6000)
		vi.advanceTimersByTime(5999)
		expect(paint.isConnected).toBe(true)
		vi.advanceTimersByTime(1)
		expect(paint.isConnected).toBe(false)
	})
})
