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
})
