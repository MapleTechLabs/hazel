import { describe, expect, it } from "vitest"

import { installShims } from "./shims"

describe("installShims", () => {
	it("keeps in-app navigation in history and opens other origins outside the app", () => {
		const opened: Array<string> = []
		const { location } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/a",
			openUrl: (href) => opened.push(href),
		})
		location.assign("/b")
		expect(location.pathname).toBe("/b")

		location.assign("https://example.com/docs")
		window.open("mailto:ada@example.com", "_blank")
		window.open("javascript:alert(1)", "_blank")
		expect(location.href).toBe("http://app.hazel.test/b")
		expect(opened).toEqual(["https://example.com/docs", "mailto:ada@example.com"])
	})

	it("keeps <html>'s inline custom properties and reports each change", () => {
		const { rootStyle, onRootStyle } = installShims({
			width: 800,
			height: 600,
			dark: false,
			url: "http://app.hazel.test/",
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
})
