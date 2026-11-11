import { describe, expect, it } from "vitest"

import { cssEscape, installShims, makeRootAwareMutationObserver } from "./shims"

describe("installShims", () => {
	it("answers a 2D canvas probe with no context, as a browser without canvas does", () => {
		installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		expect(document.createElement("canvas").getContext("2d")).toBeNull()
	})

	it("reports the app's version as the web build does, so the sidebar's label matches", () => {
		installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+$/)
	})

	it("hands idle callbacks a deadline, as idle work reads its time left", async () => {
		installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		const remaining = await new Promise<number>((done) =>
			requestIdleCallback((deadline) => done(deadline.timeRemaining())),
		)
		expect(remaining).toBeGreaterThan(0)
	})

	it("lets the app's live-region announcer build its detached nodes (a combo box announces picks)", async () => {
		installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		const { announce } = await import("../../web-foldkit/src/ui/aria/announcer")
		announce("Berlin selected")
		const [region] = document.body.childNodes
		expect(region instanceof HTMLElement ? region.dataset.liveAnnouncer : undefined).toBe("true")
	})

	it("loads the page anew on a full page load when the runtime can, as a browser does", () => {
		const loaded: Array<string> = []
		const opened: Array<string> = []
		const { location } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/sign-in",
			openUrl: (href) => opened.push(href),
			copyText: () => {},
			loadDocument: (href) => loaded.push(href),
		})
		location.assign("/")
		location.reload()
		location.assign("https://example.com/")
		expect(loaded).toEqual(["http://app.hazel.test/", "http://app.hazel.test/sign-in"])
		expect(opened).toEqual(["https://example.com/"])
		expect(location.pathname).toBe("/sign-in")
	})

	it("keeps in-app navigation in history and opens other origins outside the app", () => {
		const opened: Array<string> = []
		const { location } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/a",
			openUrl: (href) => opened.push(href),
			copyText: () => {},
		})
		location.assign("/b")
		expect(location.pathname).toBe("/b")

		location.assign("https://example.com/docs")
		window.open("mailto:ada@example.com", "_blank")
		window.open("javascript:alert(1)", "_blank")
		expect(location.href).toBe("http://app.hazel.test/b")
		expect(opened).toEqual(["https://example.com/docs", "mailto:ada@example.com"])
	})

	it("tells only the window's capturing scroll listeners that an element scrolled", () => {
		const { dispatchElementScroll } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		const heard: Array<string> = []
		const capturing = () => heard.push("capturing")
		const bubbling = () => heard.push("bubbling")
		window.addEventListener("scroll", capturing, { capture: true, passive: true })
		window.addEventListener("scroll", bubbling, { passive: true })
		dispatchElementScroll()
		expect(heard).toEqual(["capturing"])
		window.removeEventListener("scroll", capturing, { capture: true })
		dispatchElementScroll()
		expect(heard).toEqual(["capturing"])
		window.removeEventListener("scroll", bubbling)
	})

	it("keeps <html>'s inline custom properties and reports each change", () => {
		const { rootStyle, onRootStyle } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		let changes = 0
		onRootStyle(() => changes++)
		document.documentElement.style.setProperty("--color-brand-600", "var(--color-violet-600)")
		document.documentElement.style.setProperty("--color-brand-600", "var(--color-violet-600)")
		expect(rootStyle.get("--color-brand-600")).toBe("var(--color-violet-600)")
		document.documentElement.style.removeProperty("--color-brand-600")
		expect(rootStyle.has("--color-brand-600")).toBe(false)
		expect(changes).toBe(2)
	})

	it("keeps the attributes the app sets on <html>, as it marks the pointer outside a frame", () => {
		installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		const root = document.documentElement
		expect(root.hasAttribute("data-html-render-pointer-outside")).toBe(false)
		root.setAttribute("data-html-render-pointer-outside", "")
		expect(root.hasAttribute("data-html-render-pointer-outside")).toBe(true)
		expect(root.getAttribute("data-html-render-pointer-outside")).toBe("")
		root.removeAttribute("data-html-render-pointer-outside")
		expect(root.getAttribute("data-html-render-pointer-outside")).toBeNull()
	})

	it("tells a MutationObserver on <html> when the theme changes, and leaves other targets to the bridge", () => {
		const { onRootStyle } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
			openUrl: () => {},
			copyText: () => {},
		})
		const observed: Array<unknown> = []
		class Elements {
			observe(target: Node) {
				observed.push(target)
			}
			disconnect() {
				observed.push("disconnected")
			}
		}
		const Observer = makeRootAwareMutationObserver(Elements, document.documentElement, onRootStyle)
		let changes = 0
		const observer = new Observer(() => changes++)
		observer.observe(document.documentElement)
		document.documentElement.classList.add("dark")
		expect(changes).toBe(1)
		const other = document.body
		observer.observe(other)
		expect(observed).toEqual([other])
		observer.disconnect()
		document.documentElement.classList.remove("dark")
		expect(changes).toBe(1)
		expect(observed).toEqual([other, "disconnected"])
	})

	it("escapes selector identifiers as CSS.escape does", () => {
		expect(cssEscape("popover-r1:2")).toBe("popover-r1\\:2")
		expect(cssEscape("1st")).toBe("\\31 st")
		expect(cssEscape("-")).toBe("\\-")
		expect(cssEscape("a b")).toBe("a\\ b")
	})
})
