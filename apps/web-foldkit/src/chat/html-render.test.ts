import {
	HTML_RENDER_DEFAULT_THEMES,
	HTML_RENDER_THEME_VARIABLES,
	htmlRenderThemeFragment,
} from "@hazel/domain/html-render"
import { ChannelId, HtmlRenderId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { htmlRendersOf, messageRowData, toDeriveContext } from "../page/chat/derive"
import { emptyLookups } from "../page/chat/lookups"
import type { ChatMessage } from "../page/chat/rows"
import { streamingHtml } from "./embeds/live-view"
import * as HtmlRender from "./html-render"

/**
 * HTML render frames: heights, URL caching, the list and thread surfaces, the fullscreen re-mint, the
 * theme and the bridge filter.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const messageId = Schema.decodeSync(MessageId)(uuid(2))
const otherMessageId = Schema.decodeSync(MessageId)(uuid(3))
const renderId = Schema.decodeSync(HtmlRenderId)(uuid(4))
const ref: HtmlRender.RenderRef = { channelId, messageId, renderId }
const key = HtmlRender.renderKey(ref)
const listKey = HtmlRender.frameKey("list", ref)
const threadKey = HtmlRender.frameKey("thread", ref)

const MINUTE = 60_000
const URL_A = "https://uploads.hazel.sh/html/a?sig=1"
const URL_B = "https://uploads.hazel.sh/html/a?sig=2"

const step = (model: HtmlRender.Model, message: HtmlRender.Message, nowMs = 0) =>
	HtmlRender.update(model, message, nowMs)

const commandsOf = (result: HtmlRender.UpdateReturn) =>
	(result.commands ?? []).map((command) => ({ name: command.name, args: command.args }))

const mount = (nowMs: number, surface: HtmlRender.FrameSurface = "list", target = ref) =>
	HtmlRender.Message.MountedFrame({ ref: target, surface, nowMs })

const reportHeight = (height: number, surface: HtmlRender.FrameSurface = "list") =>
	HtmlRender.Message.ReportedContentHeight({ messageId, renderId, surface, height })

/** A render minted at `nowMs` 0 for its list frame, valid for an hour. */
const minted = (): HtmlRender.Model => {
	const mounted = step(HtmlRender.init(), mount(0)).model
	return step(
		mounted,
		HtmlRender.Message.SucceededMintUrl({ ref, purpose: "Inline", url: URL_A, expiresAt: 60 * MINUTE }),
	).model
}

const readyOf = (model: HtmlRender.Model) => {
	const url = model.urls[key]
	if (url?._tag !== "Ready") throw new Error("not ready")
	return url
}

const frameOf = (model: HtmlRender.Model, surface: HtmlRender.FrameSurface = "list") => {
	const frame = model.frames[HtmlRender.frameKey(surface, ref)]
	if (frame === undefined) throw new Error("no frame")
	return frame
}

describe("frameHeightOf", () => {
	const state = (contentHeight: number | null, isExpanded = false): HtmlRender.FrameState => ({
		src: null,
		srcExpiresAt: 0,
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
		const first = step(HtmlRender.init(), mount(0))
		expect(first.model.urls[key]?._tag).toBe("Loading")
		expect(commandsOf(first)).toEqual([{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Inline" } }])
		const second = step(first.model, mount(10))
		expect(second.model).toBe(first.model)
		expect(commandsOf(second)).toEqual([])
	})

	test("renders are cached per message: the same render in another message mints its own URL", () => {
		const other = { ...ref, messageId: otherMessageId }
		const result = step(minted(), mount(0, "list", other))
		expect(commandsOf(result)).toEqual([
			{ name: "MintHtmlRenderUrl", args: { ref: other, purpose: "Inline" } },
		])
		expect(readyOf(result.model).url).toBe(URL_A)
	})

	test("the minted URL becomes the frame's src, with the theme in its fragment", () => {
		const frame = frameOf(minted())
		expect(frame.src).toBe(`${URL_A}${htmlRenderThemeFragment(HTML_RENDER_DEFAULT_THEMES.dark)}`)
		expect(frame.srcExpiresAt).toBe(60 * MINUTE)
	})

	test("remounting with a live URL keeps the cached src and mints nothing", () => {
		const model = minted()
		const result = step(model, mount(30 * MINUTE))
		expect(result.model).toBe(model)
		expect(commandsOf(result)).toEqual([])
	})

	test("remounting after the URL expired mints again and the new frame loads the new URL", () => {
		const expired = step(minted(), mount(61 * MINUTE))
		expect(commandsOf(expired)).toEqual([{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Inline" } }])
		const again = step(expired.model, mount(61 * MINUTE))
		expect(commandsOf(again)).toEqual([])
		const reminted = step(
			again.model,
			HtmlRender.Message.SucceededMintUrl({
				ref,
				purpose: "Inline",
				url: URL_B,
				expiresAt: 121 * MINUTE,
			}),
			61 * MINUTE,
		).model
		expect(frameOf(reminted).src?.startsWith(URL_B)).toBe(true)
	})

	test("a failed mint shows the error, and the next mount retries", () => {
		const mounted = step(HtmlRender.init(), mount(0)).model
		const failed = step(mounted, HtmlRender.Message.FailedMintUrl({ ref, purpose: "Inline" })).model
		expect(failed.urls[key]?._tag).toBe("Failed")
		const retried = step(failed, mount(0))
		expect(retried.model.urls[key]?._tag).toBe("Loading")
		expect(commandsOf(retried)).toHaveLength(1)
	})

	test("size changes fit the frame; the same height again changes nothing", () => {
		const resized = step(minted(), reportHeight(900)).model
		expect(frameOf(resized).contentHeight).toBe(900)
		const same = step(resized, reportHeight(900))
		expect(same.model).toBe(resized)
	})

	test("Show more and Show less toggle the render", () => {
		const toggle = HtmlRender.Message.ClickedToggleExpanded({ ref, surface: "list" })
		const expanded = step(minted(), toggle).model
		expect(frameOf(expanded).isExpanded).toBe(true)
		const collapsed = step(expanded, toggle).model
		expect(frameOf(collapsed).isExpanded).toBe(false)
	})

	test("the inline frame's load shows it and posts the theme to it", () => {
		const result = step(minted(), HtmlRender.Message.LoadedFrame({ ref, mode: "list" }))
		expect(frameOf(result.model).isLoaded).toBe(true)
		expect(commandsOf(result)).toEqual([
			{
				name: "PostHtmlRenderTheme",
				args: { theme: HTML_RENDER_DEFAULT_THEMES.dark, key, mode: "list" },
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
			57 * MINUTE,
		).model
		expect(reminted.fullscreen?.src?.startsWith(URL_B)).toBe(true)
		expect(frameOf(reminted).src).toBe(frameOf(model).src)
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
		expect(failed.urls[key]?._tag).toBe("Ready")
	})
})

describe("surfaces", () => {
	/** The list frame minted and loaded; then the thread panel opens on the same message at 10 minutes. */
	const withThread = () => {
		const listed = step(minted(), HtmlRender.Message.LoadedFrame({ ref, mode: "list" })).model
		return step(listed, mount(10 * MINUTE, "thread"))
	}

	test("a thread frame takes the URL the list minted, without minting again", () => {
		const result = withThread()
		expect(commandsOf(result)).toEqual([])
		expect(Object.keys(result.model.urls)).toEqual([key])
		expect(frameOf(result.model, "thread").src).toBe(frameOf(result.model, "list").src)
		expect(frameOf(result.model, "thread").isLoaded).toBe(false)
	})

	test("one mint fills both frames when they mount before it lands", () => {
		const first = step(HtmlRender.init(), mount(0))
		const second = step(first.model, mount(0, "thread"))
		expect(commandsOf(first)).toHaveLength(1)
		expect(commandsOf(second)).toEqual([])
		const ready = step(
			second.model,
			HtmlRender.Message.SucceededMintUrl({
				ref,
				purpose: "Inline",
				url: URL_A,
				expiresAt: 60 * MINUTE,
			}),
		).model
		expect(frameOf(ready, "list").src?.startsWith(URL_A)).toBe(true)
		expect(frameOf(ready, "thread").src?.startsWith(URL_A)).toBe(true)
	})

	test("a thread frame's height, expansion and load leave the list frame's state alone", () => {
		const opened = withThread().model
		const list = frameOf(opened, "list")
		const resized = step(opened, reportHeight(1400, "thread")).model
		const expanded = step(
			resized,
			HtmlRender.Message.ClickedToggleExpanded({ ref, surface: "thread" }),
		).model
		const loaded = step(expanded, HtmlRender.Message.LoadedFrame({ ref, mode: "thread" })).model
		expect(loaded.frames[listKey]).toBe(list)
		expect(loaded.frames[threadKey]).toMatchObject({
			contentHeight: 1400,
			isExpanded: true,
			isLoaded: true,
		})
		const listResized = step(loaded, reportHeight(500, "list")).model
		expect(frameOf(listResized, "thread").contentHeight).toBe(1400)
		expect(frameOf(listResized, "list").contentHeight).toBe(500)
	})

	test("a re-mint for an expired thread frame keeps the list frame on its live src", () => {
		const opened = withThread().model
		const listSrc = frameOf(opened, "list").src
		const reopened = step(opened, mount(58 * MINUTE, "thread"))
		expect(reopened.model).toBe(opened)
		const late = step(modifyThread(opened, { srcExpiresAt: 0, src: null }), mount(58 * MINUTE, "thread"))
		expect(commandsOf(late)).toEqual([{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Inline" } }])
		const reminted = step(
			late.model,
			HtmlRender.Message.SucceededMintUrl({
				ref,
				purpose: "Inline",
				url: URL_B,
				expiresAt: 118 * MINUTE,
			}),
			58 * MINUTE,
		).model
		expect(frameOf(reminted, "list").src).toBe(listSrc)
		expect(frameOf(reminted, "thread").src?.startsWith(URL_B)).toBe(true)
	})

	test("after the URL expires, a newly mounted thread frame re-mints and the loaded list frame keeps its src", () => {
		const opened = step(withThread().model, HtmlRender.Message.LoadedFrame({ ref, mode: "list" })).model
		const listSrc = frameOf(opened, "list").src
		// The panel was closed and opens again at 61 min: its frame mounts with an expired src.
		const late = step(opened, mount(61 * MINUTE, "thread"), 61 * MINUTE)
		expect(commandsOf(late)).toEqual([{ name: "MintHtmlRenderUrl", args: { ref, purpose: "Inline" } }])
		expect(frameOf(late.model, "thread")).toMatchObject({ src: null, isLoaded: false })
		const reminted = step(
			late.model,
			HtmlRender.Message.SucceededMintUrl({
				ref,
				purpose: "Inline",
				url: URL_B,
				expiresAt: 121 * MINUTE,
			}),
			61 * MINUTE,
		).model
		expect(frameOf(reminted, "list")).toMatchObject({ src: listSrc, isLoaded: true })
		expect(frameOf(reminted, "thread").src?.startsWith(URL_B)).toBe(true)
	})

	test("fullscreen opens from the thread frame on the shared URL", () => {
		const result = step(
			withThread().model,
			HtmlRender.Message.ClickedFullscreen({ ref, title: "Report" }),
			20 * MINUTE,
		)
		expect(commandsOf(result)).toEqual([])
		expect(result.model.fullscreen?.src?.startsWith(URL_A)).toBe(true)
	})
})

const modifyThread = (model: HtmlRender.Model, patch: Partial<HtmlRender.FrameState>): HtmlRender.Model => ({
	...model,
	frames: { ...model.frames, [threadKey]: { ...frameOf(model, "thread"), ...patch } },
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
	const threadWindow = { name: "thread" }
	const fullscreenWindow = { name: "fullscreen" }
	const frames: ReadonlyArray<HtmlRender.BridgeFrame> = [
		{ renderId, messageId, mode: "list", window: inlineWindow, isFocused: true },
		{ renderId, messageId, mode: "thread", window: threadWindow, isFocused: false },
		{ renderId, messageId, mode: "fullscreen", window: fullscreenWindow, isFocused: false },
		{ renderId, messageId: otherMessageId, mode: "list", window: null, isFocused: false },
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

	test("an inline frame's size change goes to its render on its own surface", () => {
		expect(HtmlRender.frameMessageOf({ source: inlineWindow, data: size(300) }, frames, true)).toEqual(
			reportHeight(300, "list"),
		)
		expect(HtmlRender.frameMessageOf({ source: threadWindow, data: size(700) }, frames, true)).toEqual(
			reportHeight(700, "thread"),
		)
	})

	test("an unfocused inline frame opens no link", () => {
		expect(
			HtmlRender.frameMessageOf({ source: threadWindow, data: link("https://hazel.sh") }, frames, true),
		).toBeUndefined()
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
		const model = step(minted(), reportHeight(1200)).model
		const context = toDeriveContext(emptyLookups, undefined, {
			unfurls: {},
			liveStates: {},
			htmlRenders: model,
			appearance: "light",
		})
		const [row] = messageRowData(message, "standalone", [], context).htmlRenders
		expect(row).toMatchObject({
			status: "Ready",
			src: frameOf(model).src,
			fittedHeight: 1200,
			shownHeight: 600,
			isTall: true,
			appearance: "light",
		})
	})

	test("the thread surface's rows read its own frame: the list's height is not its", () => {
		const model = step(step(minted(), reportHeight(1200)).model, mount(0, "thread")).model
		const context = toDeriveContext(emptyLookups, undefined, {
			unfurls: {},
			liveStates: {},
			htmlRenders: model,
		})
		const [row] = htmlRendersOf(context, message, "thread")
		expect(row).toMatchObject({ status: "Ready", src: frameOf(model, "thread").src, fittedHeight: 320 })
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
