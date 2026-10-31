import {
	HTML_RENDER_DEFAULT_THEMES,
	HTML_RENDER_THEME_VARIABLES,
	htmlRenderThemeFragment,
} from "@hazel/domain/html-render"
import { ChannelId, HtmlRenderId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { messageRowData, toDeriveContext } from "../page/chat/derive"
import { emptyLookups } from "../page/chat/lookups"
import type { ChatMessage } from "../page/chat/rows"
import { streamingHtml } from "./embeds/live-view"
import * as HtmlRender from "./html-render"

/** HTML render frames: heights, URL caching, the fullscreen re-mint, the theme and the bridge filter. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const messageId = Schema.decodeSync(MessageId)(uuid(2))
const otherMessageId = Schema.decodeSync(MessageId)(uuid(3))
const renderId = Schema.decodeSync(HtmlRenderId)(uuid(4))
const ref: HtmlRender.RenderRef = { channelId, messageId, renderId }
const key = HtmlRender.renderKey(ref)

const MINUTE = 60_000
const URL_A = "https://uploads.hazel.sh/html/a?sig=1"
const URL_B = "https://uploads.hazel.sh/html/a?sig=2"

const step = (model: HtmlRender.Model, message: HtmlRender.Message, nowMs = 0) =>
	HtmlRender.update(model, message, nowMs)

const commandsOf = (result: HtmlRender.UpdateReturn) =>
	(result.commands ?? []).map((command) => ({ name: command.name, args: command.args }))

/** A render minted at `nowMs` 0, valid for an hour. */
const minted = (): HtmlRender.Model => {
	const mounted = step(HtmlRender.init(), HtmlRender.Message.MountedFrame({ ref, nowMs: 0 })).model
	return step(
		mounted,
		HtmlRender.Message.SucceededMintUrl({ ref, purpose: "Inline", url: URL_A, expiresAt: 60 * MINUTE }),
	).model
}

const readyOf = (model: HtmlRender.Model) => {
	const url = model.renders[key]?.url
	if (url?._tag !== "Ready") throw new Error("not ready")
	return url
}

describe("frameHeightOf", () => {
	const state = (contentHeight: number | null, isExpanded = false): HtmlRender.RenderState => ({
		url: HtmlRender.UrlState.Loading(),
		contentHeight,
		isExpanded,
		isLoaded: true,
	})

	test("the embed's height, clamped, until the page reports its own", () => {
		expect(HtmlRender.frameHeightOf(40, undefined)).toEqual({ fitted: 80, shown: 80, isTall: false })
		expect(HtmlRender.frameHeightOf(320, state(null))).toEqual({ fitted: 320, shown: 320, isTall: false })
	})

	test("a reported height fits the frame to the page", () => {
		expect(HtmlRender.frameHeightOf(320, state(412.4))).toEqual({
			fitted: 413,
			shown: 413,
			isTall: false,
		})
	})

	test("a tall page shows 600px until expanded", () => {
		expect(HtmlRender.frameHeightOf(320, state(1500))).toEqual({ fitted: 1500, shown: 600, isTall: true })
		expect(HtmlRender.frameHeightOf(320, state(1500, true))).toEqual({
			fitted: 1500,
			shown: 1500,
			isTall: true,
		})
	})
})

describe("update", () => {
	test("the first mount mints the URL; another mount while it loads mints nothing", () => {
		const first = step(HtmlRender.init(), HtmlRender.Message.MountedFrame({ ref, nowMs: 0 }))
		expect(first.model.renders[key]?.url._tag).toBe("Loading")
		expect(commandsOf(first)).toEqual([{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Inline" } }])
		const second = step(first.model, HtmlRender.Message.MountedFrame({ ref, nowMs: 10 }))
		expect(second.model).toBe(first.model)
		expect(commandsOf(second)).toEqual([])
	})

	test("renders are cached per message: the same render in another message mints its own URL", () => {
		const other = { ...ref, messageId: otherMessageId }
		const result = step(minted(), HtmlRender.Message.MountedFrame({ ref: other, nowMs: 0 }))
		expect(commandsOf(result)).toEqual([
			{ name: "MintHtmlRenderUrl", args: { ref: other, purpose: "Inline" } },
		])
		expect(readyOf(result.model).url).toBe(URL_A)
	})

	test("the minted URL becomes the frame's src, with the theme in its fragment", () => {
		const ready = readyOf(minted())
		expect(ready.src).toBe(`${URL_A}${htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.dark)}`)
		expect(ready.srcExpiresAt).toBe(60 * MINUTE)
	})

	test("remounting with a live URL keeps the cached src and mints nothing", () => {
		const model = minted()
		const result = step(model, HtmlRender.Message.MountedFrame({ ref, nowMs: 30 * MINUTE }))
		expect(result.model).toBe(model)
		expect(commandsOf(result)).toEqual([])
	})

	test("remounting after the URL expired mints again and the new frame loads the new URL", () => {
		const expired = step(minted(), HtmlRender.Message.MountedFrame({ ref, nowMs: 61 * MINUTE }))
		expect(commandsOf(expired)).toEqual([{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Inline" } }])
		const again = step(expired.model, HtmlRender.Message.MountedFrame({ ref, nowMs: 61 * MINUTE }))
		expect(commandsOf(again)).toEqual([])
		const reminted = step(
			again.model,
			HtmlRender.Message.SucceededMintUrl({
				ref,
				purpose: "Inline",
				url: URL_B,
				expiresAt: 121 * MINUTE,
			}),
		).model
		expect(readyOf(reminted).src.startsWith(URL_B)).toBe(true)
	})

	test("a failed mint shows the error, and the next mount retries", () => {
		const mounted = step(HtmlRender.init(), HtmlRender.Message.MountedFrame({ ref, nowMs: 0 })).model
		const failed = step(mounted, HtmlRender.Message.FailedMintUrl({ ref, purpose: "Inline" })).model
		expect(failed.renders[key]?.url._tag).toBe("Failed")
		const retried = step(failed, HtmlRender.Message.MountedFrame({ ref, nowMs: 0 }))
		expect(retried.model.renders[key]?.url._tag).toBe("Loading")
		expect(commandsOf(retried)).toHaveLength(1)
	})

	test("size changes fit the frame; the same height again changes nothing", () => {
		const resized = step(
			minted(),
			HtmlRender.Message.ReportedContentHeight({ messageId, renderId, height: 900 }),
		).model
		expect(resized.renders[key]?.contentHeight).toBe(900)
		const same = step(
			resized,
			HtmlRender.Message.ReportedContentHeight({ messageId, renderId, height: 900 }),
		)
		expect(same.model).toBe(resized)
	})

	test("Show more and Show less toggle the render", () => {
		const expanded = step(minted(), HtmlRender.Message.ClickedToggleExpanded({ ref })).model
		expect(expanded.renders[key]?.isExpanded).toBe(true)
		const collapsed = step(expanded, HtmlRender.Message.ClickedToggleExpanded({ ref })).model
		expect(collapsed.renders[key]?.isExpanded).toBe(false)
	})

	test("the inline frame's load shows it and posts the theme to it", () => {
		const result = step(minted(), HtmlRender.Message.LoadedFrame({ ref, mode: "inline" }))
		expect(result.model.renders[key]?.isLoaded).toBe(true)
		expect(commandsOf(result)).toEqual([
			{
				name: "PostHtmlRenderTheme",
				args: { theme: HTML_RENDER_DEFAULT_THEMES.dark, key, mode: "inline" },
			},
		])
	})

	test("a theme change is stored and posted to every frame; the same theme again is not", () => {
		const theme = HTML_RENDER_DEFAULT_THEMES.light
		const changed = step(minted(), HtmlRender.Message.ChangedAppTheme({ theme }))
		expect(changed.model.theme).toEqual(theme)
		expect(commandsOf(changed)).toEqual([
			{ name: "PostHtmlRenderTheme", args: { theme, key: null, mode: null } },
		])
		const same = step(changed.model, HtmlRender.Message.ChangedAppTheme({ theme }))
		expect(same.model).toBe(changed.model)
		expect(commandsOf(same)).toEqual([])
	})

	test("fullscreen on a URL with life left opens on it without minting", () => {
		const result = step(
			minted(),
			HtmlRender.Message.ClickedFullscreen({ ref, title: "Report" }),
			40 * MINUTE,
		)
		expect(commandsOf(result)).toEqual([])
		expect(result.model.fullscreen?.src?.startsWith(URL_A)).toBe(true)
	})

	test("fullscreen on a URL about to expire re-mints; the inline frame keeps its src", () => {
		const model = minted()
		const opened = step(
			model,
			HtmlRender.Message.ClickedFullscreen({ ref, title: "Report" }),
			57 * MINUTE,
		)
		expect(opened.model.fullscreen?.src).toBeNull()
		expect(commandsOf(opened)).toEqual([
			{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Fullscreen" } },
		])
		const reminted = step(
			opened.model,
			HtmlRender.Message.SucceededMintUrl({
				ref,
				purpose: "Fullscreen",
				url: URL_B,
				expiresAt: 117 * MINUTE,
			}),
		).model
		expect(reminted.fullscreen?.src?.startsWith(URL_B)).toBe(true)
		expect(readyOf(reminted).src).toBe(readyOf(model).src)
		expect(readyOf(reminted).url).toBe(URL_B)
	})

	test("a failed fullscreen re-mint shows the error in the dialog only", () => {
		const opened = step(
			minted(),
			HtmlRender.Message.ClickedFullscreen({ ref, title: "Report" }),
			59 * MINUTE,
		).model
		const failed = step(opened, HtmlRender.Message.FailedMintUrl({ ref, purpose: "Fullscreen" })).model
		expect(failed.fullscreen?.isFailed).toBe(true)
		expect(failed.renders[key]?.url._tag).toBe("Ready")
	})
})

describe("themeFromTokens", () => {
	const tokens: Record<string, string> = {
		"--bg": "oklch(0.19 0.006 285.885)",
		"--fg": "rgb(250 250 250)",
		"--muted-fg": " rgb(161 161 170) ",
		"--primary": "rgb(127 86 217)",
		"--danger": "rgb(220 38 38)",
		"--radius-lg": "0.5rem",
	}
	const theme = HtmlRender.themeFromTokens("dark", (token) => tokens[token] ?? "")

	test("sets every variable the page expects", () => {
		expect(Object.keys(theme.variables).sort()).toEqual([...HTML_RENDER_THEME_VARIABLES].sort())
		expect(theme.appearance).toBe("dark")
	})

	test("maps Hazel's semantic tokens onto the page's variables", () => {
		expect(theme.variables["--background"]).toBe(tokens["--bg"])
		expect(theme.variables["--foreground"]).toBe(tokens["--fg"])
		expect(theme.variables["--muted-foreground"]).toBe("rgb(161 161 170)")
		expect(theme.variables["--primary"]).toBe(tokens["--primary"])
		expect(theme.variables["--ring"]).toBe(HTML_RENDER_DEFAULT_THEMES.dark.variables["--ring"])
		expect(theme.variables["--destructive"]).toBe(tokens["--danger"])
		expect(theme.variables["--radius"]).toBe("0.5rem")
		expect(theme.variables["--font-sans"]?.startsWith("Inter")).toBe(true)
	})

	test("a token that reads empty keeps the default theme's value", () => {
		expect(theme.variables["--border"]).toBe(HTML_RENDER_DEFAULT_THEMES.dark.variables["--border"])
	})
})

describe("frameMessageOf", () => {
	const inlineWindow = { name: "inline" }
	const fullscreenWindow = { name: "fullscreen" }
	const frames: ReadonlyArray<HtmlRender.BridgeFrame> = [
		{ renderId, messageId, mode: "inline", window: inlineWindow, isFocused: true },
		{ renderId, messageId, mode: "fullscreen", window: fullscreenWindow, isFocused: false },
		{ renderId, messageId: otherMessageId, mode: "inline", window: null, isFocused: false },
	]
	const size = (height: number) => ({
		jsonrpc: "2.0",
		method: "ui/notifications/size-changed",
		params: { height },
	})
	const link = (url: string) => ({
		jsonrpc: "2.0",
		id: "hazel-link-1",
		method: "ui/open-link",
		params: { url },
	})

	test("only our frames' windows are heard", () => {
		expect(HtmlRender.frameMessageOf({ source: {}, data: size(300) }, frames, true)).toBeUndefined()
		expect(
			HtmlRender.frameMessageOf({ source: window_(), data: size(300) }, frames, true),
		).toBeUndefined()
		expect(HtmlRender.frameMessageOf({ source: null, data: size(300) }, frames, true)).toBeUndefined()
	})

	test("an inline frame's size change goes to its render", () => {
		expect(HtmlRender.frameMessageOf({ source: inlineWindow, data: size(300) }, frames, true)).toEqual(
			HtmlRender.Message.ReportedContentHeight({ messageId, renderId, height: 300 }),
		)
	})

	test("the fullscreen frame's size never resizes the inline one", () => {
		expect(
			HtmlRender.frameMessageOf({ source: fullscreenWindow, data: size(300) }, frames, true),
		).toBeUndefined()
	})

	test("a link opens only from the focused frame while the reader acts, and only over http(s)", () => {
		expect(
			HtmlRender.frameMessageOf({ source: inlineWindow, data: link("https://hazel.sh") }, frames, true),
		).toEqual(HtmlRender.Message.RequestedOpenLink({ url: "https://hazel.sh" }))
		expect(
			HtmlRender.frameMessageOf(
				{ source: inlineWindow, data: link("https://hazel.sh") },
				frames,
				false,
			),
		).toBeUndefined()
		expect(
			HtmlRender.frameMessageOf(
				{ source: fullscreenWindow, data: link("https://hazel.sh") },
				frames,
				true,
			),
		).toBeUndefined()
		expect(
			HtmlRender.frameMessageOf(
				{ source: inlineWindow, data: link("javascript:alert(1)") },
				frames,
				true,
			),
		).toBeUndefined()
	})

	test("anything else is ignored", () => {
		for (const data of [null, "size", { method: "ui/notifications/size-changed" }, { jsonrpc: "2.0" }])
			expect(HtmlRender.frameMessageOf({ source: inlineWindow, data }, frames, true)).toBeUndefined()
	})
})

/** A stand-in for some other window (the app's own, another frame's). */
const window_ = () => ({ name: "elsewhere" })

describe("htmlRenders rows", () => {
	const message: ChatMessage = {
		id: messageId,
		channelId,
		authorId: Schema.decodeSync(UserId)(uuid(5)),
		content: "",
		embeds: [{ title: "Report", html: { renderId, title: "Weekly report", height: 320 } }],
		hasEmbeds: true,
		replyToMessageId: null,
		threadChannelId: null,
		createdAtMs: 0,
		updatedAtMs: null,
		isPinned: false,
		author: null,
	}

	test("a row carries its frame: loading before a mint, then the src and the fitted height", () => {
		const loading = messageRowData(message, "standalone", [], toDeriveContext(emptyLookups, undefined))
		expect(loading.htmlRenders).toEqual([
			{
				renderId,
				status: "Loading",
				src: null,
				fittedHeight: 320,
				shownHeight: 320,
				isTall: false,
				isExpanded: false,
				isLoaded: false,
				appearance: "dark",
			},
		])
		const model = step(
			minted(),
			HtmlRender.Message.ReportedContentHeight({ messageId, renderId, height: 1200 }),
		).model
		const context = toDeriveContext(emptyLookups, undefined, {
			unfurls: {},
			liveStates: {},
			htmlRenders: model.renders,
			appearance: "light",
		})
		const [row] = messageRowData(message, "standalone", [], context).htmlRenders
		expect(row).toMatchObject({
			status: "Ready",
			src: readyOf(model).src,
			fittedHeight: 1200,
			shownHeight: 600,
			isTall: true,
			appearance: "light",
		})
	})
})

describe("streamingHtml", () => {
	test("raw HTML in the stream renders as text, never as elements", () => {
		const html = streamingHtml('Hi <script>alert(1)</script> <img src=x onerror="alert(1)"> done')
		expect(html).not.toMatch(/<script/i)
		expect(html).not.toMatch(/<img/i)
		expect(html).toContain("&lt;script&gt;")
	})

	test("text after an inline raw-text tag is escaped too", () => {
		for (const payload of [
			"Done <code> <img/src=x/onerror=alert(1)> after",
			"<pre><img src=x onerror=alert(1)>",
			"<kbd>x</kbd> <img src=x onerror=alert(1)//'>",
			"<script>x</script><img src=x onerror=alert(1)>",
		]) {
			expect(streamingHtml(payload)).not.toMatch(/<(img|code|pre|kbd|script)\b/i)
		}
	})

	test("an HTML block renders as text too", () => {
		const html = streamingHtml(
			'<div onclick="alert(1)">\n<iframe src="https://evil.example"></iframe>\n</div>',
		)
		expect(html).not.toMatch(/<div|<iframe/i)
	})

	test("javascript: and data: links and images are dropped, their text kept", () => {
		const html = streamingHtml(
			"[click](javascript:alert(1)) [x](JaVaScRiPt:alert(1)) [y](<\x01java\tscript:alert(1)>) ![pic](data:image/svg+xml;base64,PHN2Zz4=)",
		)
		expect(html).not.toMatch(/javascript:|data:|<a |<img/i)
		expect(html).toContain("click")
	})

	test("markdown still renders, with safe links", () => {
		const html = streamingHtml("**bold** [docs](https://hazel.sh/docs)")
		expect(html).toContain("<strong>bold</strong>")
		expect(html).toContain(
			'<a href="https://hazel.sh/docs" rel="noopener noreferrer" target="_blank">docs</a>',
		)
	})
})
