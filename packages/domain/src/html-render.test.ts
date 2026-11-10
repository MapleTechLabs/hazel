import { describe, expect, it } from "vitest"
import {
	findViewportHeightUnit,
	htmlRenderThemeFragment,
	HTML_RENDER_DEFAULT_THEMES,
	injectHtmlRenderBootstrap,
	readHtmlRenderContentHeight,
	isHtmlRenderInlineRequest,
	isHtmlRenderPointerLeft,
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

	it("replaces the bootstrap a page was stored with, where it stood", () => {
		const page = injectHtmlRenderBootstrap(
			"<!doctype html><html><head><title>x</title></head><h1>Hi</h1>",
		)
		expect(injectHtmlRenderBootstrap(page)).toBe(page)
		// A page published before the display modes: its old stylesheet and script go.
		const earlier = page.replace(
			/<style id="hazel-theme">[\s\S]*?<\/script>/,
			'<style id="hazel-theme">html{padding:8px}</style><script>window.old=1</script>',
		)
		expect(earlier).not.toBe(page)
		expect(injectHtmlRenderBootstrap(earlier)).toBe(page)
	})

	it("replaces an earlier bootstrap only where it was put, at the start of the head", () => {
		const earlier = '<style id="hazel-theme">html{padding:8px}</style><script>window.old=1</script>'
		// The same text in a comment, a script and the body is the page's own.
		const page = `<!-- ${earlier} --><html><head><title>x</title></head><body><textarea>${earlier}</textarea><pre>${earlier.replaceAll("<", "&lt;")}</pre>${earlier}</body></html>`
		const injected = injectHtmlRenderBootstrap(page)
		expect(injected.startsWith(`<!-- ${earlier} --><html><head><meta charset="utf-8">`)).toBe(true)
		// All four copies are still there.
		expect(injected.match(/window\.old=1/g)).toHaveLength(4)
		// And today's went into the head.
		expect(injected).toContain(
			'<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style id="hazel-theme">:root{color-scheme:dark',
		)
		expect(injectHtmlRenderBootstrap(injected)).toBe(injected)

		// A page with no head got one of its own: its bootstrap is found there on the way back.
		for (const bare of [
			"<h1>Hi</h1>",
			"<!doctype html><h1>Hi</h1>",
			'<html lang="en"><body>x</body></html>',
		]) {
			const once = injectHtmlRenderBootstrap(bare)
			expect(injectHtmlRenderBootstrap(once)).toBe(once)
			const old = once.replace(/<style id="hazel-theme">[\s\S]*?<\/script>/, earlier)
			expect(injectHtmlRenderBootstrap(old)).toBe(once)
		}
	})

	it("keeps an inline page's root from scrolling, and lets a fullscreen one scroll in view", () => {
		const page = injectHtmlRenderBootstrap("<h1>Hi</h1>")
		expect(page).toContain("html[data-hazel-display=inline]{overflow:hidden}")
		expect(page).toContain("html[data-hazel-display=fullscreen]{padding:16px;scrollbar-width:thin")
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

		expect(isHtmlRenderPointerLeft({ jsonrpc: "2.0", method: "hazel/notifications/pointer-left" })).toBe(
			true,
		)
		expect(isHtmlRenderPointerLeft({ method: "hazel/notifications/pointer-left" })).toBe(false)

		const display = {
			jsonrpc: "2.0",
			id: 1,
			method: "ui/request-display-mode",
			params: { mode: "inline" },
		}
		expect(isHtmlRenderInlineRequest(display)).toBe(true)
		expect(isHtmlRenderInlineRequest({ ...display, params: { mode: "fullscreen" } })).toBe(false)
		expect(isHtmlRenderInlineRequest(size)).toBe(false)
	})

	it("carries the theme in the URL fragment", () => {
		const fragment = htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.light)
		expect(fragment.startsWith("#hazel-theme=")).toBe(true)
		expect(JSON.parse(decodeURIComponent(fragment.slice("#hazel-theme=".length)))).toEqual(
			HTML_RENDER_DEFAULT_THEMES.light,
		)
	})

	it("names the display mode after the theme, when the app gives one", () => {
		const theme = htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.light)
		expect(htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.light, "inline")).toBe(
			`${theme}&hazel-display=inline`,
		)
		expect(htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.light, "fullscreen")).toBe(
			`${theme}&hazel-display=fullscreen`,
		)
	})
})
