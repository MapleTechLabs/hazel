import { describe, expect, it } from "vitest"
import {
	findViewportHeightUnit,
	htmlRenderThemeFragment,
	HTML_RENDER_DEFAULT_THEMES,
	injectHtmlRenderBootstrap,
	readHtmlRenderContentHeight,
	readHtmlRenderLinkRequest,
} from "./html-render"

const BOOTSTRAP = '<style id="hazel-theme">'

describe("injectHtmlRenderBootstrap", () => {
	it("goes first in an existing head", () => {
		const page = injectHtmlRenderBootstrap(
			"<!doctype html><html><head><title>x</title></head><body></body></html>",
		)
		expect(page.indexOf(BOOTSTRAP)).toBeGreaterThan(page.indexOf("<head>"))
		expect(page.indexOf(BOOTSTRAP)).toBeLessThan(page.indexOf("<title>"))
	})

	it("adds a head to a fragment or a page without one", () => {
		expect(injectHtmlRenderBootstrap("<h1>Hi</h1>")).toMatch(
			/^<!doctype html><head>.*<\/head><h1>Hi<\/h1>$/s,
		)
		const html = injectHtmlRenderBootstrap('<html lang="en"><body>x</body></html>')
		expect(html.startsWith('<html lang="en"><head><meta charset="utf-8">')).toBe(true)
	})

	it("ignores a head inside comments, scripts and templates", () => {
		const page = injectHtmlRenderBootstrap(
			'<!-- <head> --><script>"<head>"</script><template><head></template><h1>x</h1>',
		)
		expect(page.startsWith("<!doctype html><head>")).toBe(true)
	})

	it("keeps the page's own charset and viewport", () => {
		const page = injectHtmlRenderBootstrap(
			'<head><meta charset="utf-8"><meta name="viewport" content="width=500"></head>',
		)
		expect(page.match(/charset/g)).toHaveLength(1)
		expect(page.match(/name="viewport"/g)).toHaveLength(1)
	})
})

describe("findViewportHeightUnit", () => {
	it("finds vh units in stylesheets and style attributes", () => {
		expect(findViewportHeightUnit("<style>.a{height:50vh}</style>")).toBe("50vh")
		expect(findViewportHeightUnit('<div style="min-height: 100dvh">')).toBe("100dvh")
		expect(findViewportHeightUnit("<style>.a{height:60vmax}.b{height:10svb}</style>")).toBe("60vmax")
	})

	it("ignores comments, text, vw and base64 data", () => {
		expect(findViewportHeightUnit("<!-- <style>.a{height:50vh}</style> --><p>100vh</p>")).toBeUndefined()
		expect(findViewportHeightUnit("<style>.a{width:100vw}</style>")).toBeUndefined()
		expect(
			findViewportHeightUnit("<style>.a{background:url(data:image/png;base64,QQ1vh)}</style>"),
		).toBeUndefined()
	})
})

describe("bridge", () => {
	it("reads size and link notifications, and nothing else", () => {
		const size = { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 312 } }
		expect(readHtmlRenderContentHeight(size)).toBe(312)
		expect(readHtmlRenderContentHeight({ ...size, params: { height: -1 } })).toBeUndefined()
		expect(readHtmlRenderContentHeight("312")).toBeUndefined()

		const link = { jsonrpc: "2.0", id: 1, method: "ui/open-link", params: { url: "https://hazel.sh" } }
		expect(readHtmlRenderLinkRequest(link)).toBe("https://hazel.sh")
		expect(readHtmlRenderLinkRequest({ ...link, params: { url: "javascript:alert(1)" } })).toBeUndefined()
	})

	it("carries the theme in the URL fragment", () => {
		const fragment = htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.light)
		expect(fragment.startsWith("#hazel-theme=")).toBe(true)
		expect(JSON.parse(decodeURIComponent(fragment.slice("#hazel-theme=".length)))).toEqual(
			HTML_RENDER_DEFAULT_THEMES.light,
		)
	})
})
