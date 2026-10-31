import { getTauriOpener } from "@hazel/desktop/bridge"
import {
	clampHtmlRenderHeight,
	HTML_RENDER_DEFAULT_THEMES,
	type HtmlRenderTheme,
	type HtmlRenderThemeVariable,
	htmlRenderFitHeight,
	htmlRenderThemeFragment,
	htmlRenderThemeMessage,
	readHtmlRenderContentHeight,
	isHtmlRenderPointerLeft,
	readHtmlRenderLinkRequest,
} from "@hazel/domain/html-render"
import { ChannelId, HtmlRenderId, MessageId } from "@hazel/schema"
import { Clock, Effect, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"
import { catchCommon } from "../data/actions"
import { HazelRpc } from "../rpc"
import * as Modal from "../ui/modal"

/**
 * HTML renders (`MessageEmbed.html`): a bot's sandboxed page, framed from a short-lived signed URL
 * (`message.htmlRenderUrl`). The page keeps one URL per message and render, and one display state per
 * inline frame of it (the message list's, and the thread panel's when the message heads an open thread);
 * the frames talk to the app over `postMessage` (`@hazel/domain/html-render`), which the bridge Stream reads.
 */

/** Inline frames taller than this show "Show more". */
export const HTML_RENDER_INLINE_MAX_HEIGHT = 600
/** Fullscreen re-mints a URL with less life left than this. */
const MIN_URL_LIFE_MS = 5 * 60_000

// MODEL

/** A render as one message shows it: URLs are minted per message and render. */
export const RenderRef = Schema.Struct({ channelId: ChannelId, messageId: MessageId, renderId: HtmlRenderId })
export type RenderRef = typeof RenderRef.Type

export const renderKey = (ref: Pick<RenderRef, "messageId" | "renderId">): string =>
	`${ref.messageId}/${ref.renderId}`

/**
 * Where an inline frame shows: the message list, or the thread panel's original message. The same
 * render can show in both at once, at different widths, so each keeps its own heights.
 */
export const FrameSurface = Schema.Literals(["list", "thread"])
export type FrameSurface = typeof FrameSurface.Type

/** A frame: an inline one on its surface, or the fullscreen dialog's. */
export const FrameMode = Schema.Literals(["list", "thread", "fullscreen"])
export type FrameMode = typeof FrameMode.Type

/** An inline frame's state key: its surface and render. */
export const frameKey = (surface: FrameSurface, ref: Pick<RenderRef, "messageId" | "renderId">): string =>
	`${surface}:${renderKey(ref)}`

const isSurface = (mode: FrameMode): mode is FrameSurface => mode !== "fullscreen"

export const HtmlRenderThemeSchema = Schema.Struct({
	appearance: Schema.Literals(["light", "dark"]),
	variables: Schema.Record(Schema.String, Schema.String),
})

/** The render's signed URL, shared by its frames: `url` is the latest mint. */
export const UrlState = defineTaggedUnion({
	Loading: {},
	Failed: {},
	Ready: {
		url: Schema.String,
		expiresAt: Schema.Number,
		isMinting: Schema.Boolean,
	},
})
export type UrlState = typeof UrlState.Type

/** One inline frame of a render. */
export const FrameState = Schema.Struct({
	/** What the frame loaded and keeps; null until a URL is at hand. */
	src: Schema.NullOr(Schema.String),
	srcExpiresAt: Schema.Number,
	/** The page's own height (`size-changed`), once it reported one. */
	contentHeight: Schema.NullOr(Schema.Number),
	isExpanded: Schema.Boolean,
	/** The frame fired `load`: it shows, with the app's color scheme. */
	isLoaded: Schema.Boolean,
})
export type FrameState = typeof FrameState.Type

export const Fullscreen = Schema.Struct({
	ref: RenderRef,
	title: Schema.String,
	/** Null until a URL with enough life left is at hand. */
	src: Schema.NullOr(Schema.String),
	isFailed: Schema.Boolean,
	isLoaded: Schema.Boolean,
	modal: Modal.Model,
})
export type Fullscreen = typeof Fullscreen.Type

export const Model = Schema.Struct({
	/** By `renderKey`. */
	urls: Schema.Record(Schema.String, UrlState),
	/** By `frameKey`. */
	frames: Schema.Record(Schema.String, FrameState),
	/** The app's tokens as the page's variables; null until first read. */
	theme: Schema.NullOr(HtmlRenderThemeSchema),
	fullscreen: Schema.NullOr(Fullscreen),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ urls: {}, frames: {}, theme: null, fullscreen: null })

export const FULLSCREEN_MODAL_ID = "html-render-fullscreen"

// MESSAGE

export const MintPurpose = Schema.Literals(["Inline", "Fullscreen"])
export type MintPurpose = typeof MintPurpose.Type

export const Message = defineMessageUnion({
	MountedFrame: { ref: RenderRef, surface: FrameSurface, nowMs: Schema.Number },
	LoadedFrame: { ref: RenderRef, mode: FrameMode },
	SucceededMintUrl: { ref: RenderRef, purpose: MintPurpose, url: Schema.String, expiresAt: Schema.Number },
	FailedMintUrl: { ref: RenderRef, purpose: MintPurpose },
	ReportedContentHeight: {
		messageId: MessageId,
		renderId: HtmlRenderId,
		surface: FrameSurface,
		height: Schema.Number,
	},
	RequestedOpenLink: { url: Schema.String },
	ChangedAppTheme: { theme: HtmlRenderThemeSchema },
	ClickedToggleExpanded: { ref: RenderRef, surface: FrameSurface },
	ClickedFullscreen: { ref: RenderRef, title: Schema.String },
	GotFullscreenModalMessage: { message: Modal.Message },
	CompletedPostTheme: {},
	CompletedOpenLink: {},
	/** The pointer left a frame: the app saw none of its moves while it was over it. */
	PointerLeftFrame: {},
	CompletedMarkPointerOutside: {},
})
export type Message = typeof Message.Type

// HEIGHT

export interface FrameHeight {
	/** The page's whole height. */
	readonly fitted: number
	/** What the frame's surface shows of it. */
	readonly shown: number
	readonly isTall: boolean
}

/** The embed's height until the page reports its own; inline display stops at the cap unless expanded. */
export const frameHeightOf = (initialHeight: number, state: FrameState | undefined): FrameHeight => {
	const fitted =
		state?.contentHeight == null
			? clampHtmlRenderHeight(initialHeight)
			: htmlRenderFitHeight(state.contentHeight)
	const isTall = fitted > HTML_RENDER_INLINE_MAX_HEIGHT
	return {
		fitted,
		shown: isTall && !(state?.isExpanded ?? false) ? HTML_RENDER_INLINE_MAX_HEIGHT : fitted,
		isTall,
	}
}

// THEME

/** Hazel's semantic token behind each page variable (`styles.css`). */
const THEME_TOKENS: Record<Exclude<HtmlRenderThemeVariable, "--font-sans" | "--font-mono">, string> = {
	"--background": "--bg",
	"--foreground": "--fg",
	"--muted": "--muted",
	"--muted-foreground": "--muted-fg",
	"--card": "--overlay",
	"--card-foreground": "--overlay-fg",
	"--border": "--border",
	"--ring": "--ring",
	"--primary": "--primary",
	"--primary-foreground": "--primary-fg",
	"--secondary": "--secondary",
	"--secondary-foreground": "--secondary-fg",
	"--accent": "--primary",
	"--accent-foreground": "--primary-fg",
	"--destructive": "--danger",
	"--destructive-foreground": "--danger-fg",
	"--warning": "--warning",
	"--warning-foreground": "--warning-fg",
	"--success": "--success",
	"--success-foreground": "--success-fg",
	"--code-background": "--muted",
	"--code-foreground": "--secondary-fg",
	"--chart-1": "--chart-1",
	"--chart-2": "--chart-2",
	"--chart-3": "--chart-3",
	"--chart-4": "--chart-4",
	"--chart-5": "--chart-5",
	"--radius": "--radius-lg",
}

/** The app's Inter stack (`--font-sans` in `styles.css`, whose `--font-inter` the frame cannot read). */
const FONT_SANS =
	'Inter, "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"'
const FONT_MONO =
	'"Geist Mono", ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace'

/**
 * The page theme from the app's tokens; `readToken` returns a token's computed value. A token that
 * reads empty keeps the default theme's value.
 */
export const themeFromTokens = (
	appearance: HtmlRenderTheme["appearance"],
	readToken: (token: string) => string,
): HtmlRenderTheme => {
	const fallback = HTML_RENDER_DEFAULT_THEMES[appearance].variables
	const variables: Partial<Record<HtmlRenderThemeVariable, string>> = {
		"--font-sans": FONT_SANS,
		"--font-mono": FONT_MONO,
	}
	for (const [name, token] of Object.entries(THEME_TOKENS) as Array<[HtmlRenderThemeVariable, string]>) {
		const value = readToken(token).trim()
		const resolved = value === "" ? fallback[name] : value
		if (resolved !== undefined) variables[name] = resolved
	}
	return { appearance, variables }
}

const readDocumentTheme = (): HtmlRenderTheme => {
	const root = document.documentElement
	const style = getComputedStyle(root)
	return themeFromTokens(root.classList.contains("dark") ? "dark" : "light", (token) =>
		style.getPropertyValue(token),
	)
}

const themeOf = (model: Model): HtmlRenderTheme => model.theme ?? HTML_RENDER_DEFAULT_THEMES.dark

/** The frame's src: the signed URL with the theme in its fragment, applied before first paint. */
export const frameSrc = (url: string, theme: HtmlRenderTheme): string =>
	`${url.split("#", 1)[0]}${htmlRenderThemeFragment(theme)}`

// UPDATE

export interface UpdateReturn {
	readonly model: Model
	readonly commands?: ReadonlyArray<Command.Command<Message, never, HazelRpc>>
}

const setUrl = (model: Model, key: string, url: UrlState): Model =>
	modifyFields(model, { urls: (urls) => ({ ...urls, [key]: url }) })

const setFrame = (model: Model, key: string, frame: FrameState): Model =>
	modifyFields(model, { frames: (frames) => ({ ...frames, [key]: frame }) })

const NEW_FRAME: FrameState = {
	src: null,
	srcExpiresAt: 0,
	contentHeight: null,
	isExpanded: false,
	isLoaded: false,
}

const isFullscreenOf = (fullscreen: Fullscreen | null, ref: Pick<RenderRef, "messageId" | "renderId">) =>
	fullscreen !== null && renderKey(fullscreen.ref) === renderKey(ref)

/**
 * A frame entered the DOM. One still on a live src keeps it. Otherwise it waits for a URL (no src,
 * not loaded): the render's minted one while it has life left, else a fresh mint. Only waiting
 * frames take a mint, so a frame shown elsewhere never reloads.
 */
const mountFrame = (model: Model, ref: RenderRef, surface: FrameSurface, nowMs: number): UpdateReturn => {
	const key = renderKey(ref)
	const fkey = frameKey(surface, ref)
	const url = model.urls[key]
	const frame = model.frames[fkey]
	if (frame?.src != null && frame.srcExpiresAt > nowMs) return { model }
	const waiting = { ...(frame ?? NEW_FRAME), src: null, isLoaded: false }
	const withFrame =
		frame !== undefined && frame.src === null && !frame.isLoaded ? model : setFrame(model, fkey, waiting)
	if (url === undefined || url._tag === "Failed")
		return {
			model: setUrl(withFrame, key, UrlState.Loading()),
			commands: [MintHtmlRenderUrl({ ref, purpose: "Inline" })],
		}
	if (url._tag === "Loading") return { model: withFrame }
	if (url.expiresAt - nowMs > MIN_URL_LIFE_MS)
		return {
			model: setFrame(withFrame, fkey, {
				...waiting,
				src: frameSrc(url.url, themeOf(model)),
				srcExpiresAt: url.expiresAt,
			}),
		}
	return {
		model: setUrl(withFrame, key, { ...url, isMinting: true }),
		commands: url.isMinting ? [] : [MintHtmlRenderUrl({ ref, purpose: "Inline" })],
	}
}

/** The render's frames on every surface. */
const framesOf = (model: Model, ref: Pick<RenderRef, "messageId" | "renderId">) =>
	FrameSurface.literals.flatMap((surface) => {
		const key = frameKey(surface, ref)
		const frame = model.frames[key]
		return frame === undefined ? [] : [{ key, frame }]
	})

/**
 * An inline mint loads into the render's waiting frames (no src: `mountFrame`); a frame that has one,
 * even an expired one it already loaded, keeps it and does not reload. A fullscreen mint leaves the
 * frames alone.
 */
const succeedMint = (
	model: Model,
	ref: RenderRef,
	purpose: MintPurpose,
	url: string,
	expiresAt: number,
): Model => {
	const withUrl = setUrl(model, renderKey(ref), UrlState.Ready({ url, expiresAt, isMinting: false }))
	const withFrames =
		purpose === "Inline"
			? framesOf(withUrl, ref).reduce(
					(next, { key, frame }) =>
						frame.src !== null
							? next
							: setFrame(next, key, {
									...frame,
									src: frameSrc(url, themeOf(model)),
									srcExpiresAt: expiresAt,
								}),
					withUrl,
				)
			: withUrl
	const fullscreen = withFrames.fullscreen
	return purpose === "Fullscreen" &&
		fullscreen !== null &&
		isFullscreenOf(fullscreen, ref) &&
		fullscreen.src === null
		? modifyFields(withFrames, {
				fullscreen: () =>
					modifyFields(fullscreen, {
						src: () => frameSrc(url, themeOf(withFrames)),
						isFailed: () => false,
					}),
			})
		: withFrames
}

const failMint = (model: Model, ref: RenderRef, purpose: MintPurpose): Model => {
	const key = renderKey(ref)
	const url = model.urls[key]
	const withState =
		url === undefined
			? model
			: setUrl(
					model,
					key,
					url._tag === "Ready"
						? { ...url, isMinting: false }
						: purpose === "Inline"
							? UrlState.Failed()
							: url,
				)
	const fullscreen = withState.fullscreen
	return purpose === "Fullscreen" &&
		fullscreen !== null &&
		isFullscreenOf(fullscreen, ref) &&
		fullscreen.src === null
		? modifyFields(withState, { fullscreen: () => modifyFields(fullscreen, { isFailed: () => true }) })
		: withState
}

/** Opens the dialog on the latest URL, or on a fresh one when it has under five minutes left. */
const openFullscreen = (model: Model, ref: RenderRef, title: string, nowMs: number): UpdateReturn => {
	const key = renderKey(ref)
	const url = model.urls[key]
	const isFresh = url?._tag === "Ready" && url.expiresAt - nowMs > MIN_URL_LIFE_MS
	const opened = modifyFields(model, {
		fullscreen: () => ({
			ref,
			title,
			src: isFresh ? frameSrc(url.url, themeOf(model)) : null,
			isFailed: false,
			isLoaded: false,
			modal: Modal.initOpen(FULLSCREEN_MODAL_ID),
		}),
	})
	if (isFresh) return { model: opened }
	const minting = url?._tag === "Ready" ? setUrl(opened, key, { ...url, isMinting: true }) : opened
	return { model: minting, commands: [MintHtmlRenderUrl({ ref, purpose: "Fullscreen" })] }
}

const loadFrame = (model: Model, ref: RenderRef, mode: FrameMode): UpdateReturn => {
	const commands = [PostHtmlRenderTheme({ theme: themeOf(model), key: renderKey(ref), mode })]
	const fullscreen = model.fullscreen
	if (!isSurface(mode))
		return fullscreen !== null && isFullscreenOf(fullscreen, ref) && !fullscreen.isLoaded
			? {
					model: modifyFields(model, {
						fullscreen: () => modifyFields(fullscreen, { isLoaded: () => true }),
					}),
					commands,
				}
			: { model, commands }
	const key = frameKey(mode, ref)
	const frame = model.frames[key]
	return frame !== undefined && !frame.isLoaded
		? { model: setFrame(model, key, { ...frame, isLoaded: true }), commands }
		: { model, commands }
}

const isSameTheme = Schema.toEquivalence(HtmlRenderThemeSchema)

/** `nowMs` is the app clock, for the fullscreen URL check. */
export const update = (model: Model, message: Message, nowMs: number): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		MountedFrame: ({ ref, surface, nowMs: mountedAtMs }) => mountFrame(model, ref, surface, mountedAtMs),
		LoadedFrame: ({ ref, mode }) => loadFrame(model, ref, mode),
		SucceededMintUrl: ({ ref, purpose, url, expiresAt }) => ({
			model: succeedMint(model, ref, purpose, url, expiresAt),
		}),
		FailedMintUrl: ({ ref, purpose }) => ({ model: failMint(model, ref, purpose) }),
		ReportedContentHeight: ({ messageId, renderId, surface, height }) => {
			const key = frameKey(surface, { messageId, renderId })
			const frame = model.frames[key]
			return frame === undefined || frame.contentHeight === height
				? { model }
				: { model: setFrame(model, key, { ...frame, contentHeight: height }) }
		},
		RequestedOpenLink: ({ url }) => ({ model, commands: [OpenHtmlRenderLink({ url })] }),
		ChangedAppTheme: ({ theme }) =>
			model.theme !== null && isSameTheme(model.theme, theme)
				? { model }
				: {
						model: modifyFields(model, { theme: () => theme }),
						commands: [PostHtmlRenderTheme({ theme, key: null, mode: null })],
					},
		ClickedToggleExpanded: ({ ref, surface }) => {
			const key = frameKey(surface, ref)
			const frame = model.frames[key]
			return frame === undefined
				? { model }
				: { model: setFrame(model, key, { ...frame, isExpanded: !frame.isExpanded }) }
		},
		ClickedFullscreen: ({ ref, title }) => openFullscreen(model, ref, title, nowMs),
		GotFullscreenModalMessage: ({ message: modalMessage }) => {
			const fullscreen = model.fullscreen
			if (fullscreen === null) return { model }
			const result = Modal.update(fullscreen.modal, modalMessage)
			return {
				model: modifyFields(model, {
					fullscreen: () => (result.model.isOpen ? { ...fullscreen, modal: result.model } : null),
				}),
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotFullscreenModalMessage({ message: inner }),
				),
			}
		},
		CompletedPostTheme: () => ({ model }),
		CompletedOpenLink: () => ({ model }),
		PointerLeftFrame: () => ({ model, commands: [MarkPointerOutside()] }),
		CompletedMarkPointerOutside: () => ({ model }),
	})

// BRIDGE

export const RENDER_ID_ATTRIBUTE = "data-html-render-id"
export const MESSAGE_ID_ATTRIBUTE = "data-html-render-message-id"
export const MODE_ATTRIBUTE = "data-html-render-mode"

/** One of our frames, as the bridge sees it. */
export interface BridgeFrame {
	readonly renderId: string
	readonly messageId: string
	readonly mode: FrameMode
	readonly window: unknown
	/** The frame has focus: a link request is the reader's click, not the page's script. */
	readonly isFocused: boolean
}

const decodeHeightTarget = Schema.decodeUnknownOption(
	Schema.Struct({ messageId: MessageId, renderId: HtmlRenderId }),
)

/**
 * The Message a `message` event stands for: only events from one of our frames' windows count;
 * inline frames report heights, to their own surface's state, and a link opens only from the focused
 * frame while the reader acts.
 */
export const frameMessageOf = (
	event: { readonly source: unknown; readonly data: unknown },
	frames: ReadonlyArray<BridgeFrame>,
	hasUserActivation: boolean,
): Message | undefined => {
	if (event.source === null || event.source === undefined) return undefined
	const frame = frames.find((candidate) => candidate.window !== null && candidate.window === event.source)
	if (frame === undefined) return undefined
	const height = readHtmlRenderContentHeight(event.data)
	if (height !== undefined) {
		const target = decodeHeightTarget({ messageId: frame.messageId, renderId: frame.renderId })
		return isSurface(frame.mode) && Option.isSome(target)
			? Message.ReportedContentHeight({ ...target.value, surface: frame.mode, height })
			: undefined
	}
	if (isHtmlRenderPointerLeft(event.data)) return Message.PointerLeftFrame()
	const url = readHtmlRenderLinkRequest(event.data)
	return url !== undefined && frame.isFocused && hasUserActivation
		? Message.RequestedOpenLink({ url })
		: undefined
}

const frameElements = (): ReadonlyArray<HTMLIFrameElement> => [
	...document.querySelectorAll<HTMLIFrameElement>(`iframe[${RENDER_ID_ATTRIBUTE}]`),
]

const renderKeyOf = (frame: Element) =>
	`${frame.getAttribute(MESSAGE_ID_ATTRIBUTE) ?? ""}/${frame.getAttribute(RENDER_ID_ATTRIBUTE) ?? ""}`

const isFrameMode = Schema.is(FrameMode)

/** A frame without a known mode counts as fullscreen: its heights are never heard. */
const frameModeOf = (frame: Element): FrameMode => {
	const mode = frame.getAttribute(MODE_ATTRIBUTE)
	return isFrameMode(mode) ? mode : "fullscreen"
}

const bridgeFrames = (): ReadonlyArray<BridgeFrame> =>
	frameElements().map((frame) => ({
		renderId: frame.getAttribute(RENDER_ID_ATTRIBUTE) ?? "",
		messageId: frame.getAttribute(MESSAGE_ID_ATTRIBUTE) ?? "",
		mode: frameModeOf(frame),
		window: frame.contentWindow,
		isFocused: document.activeElement === frame,
	}))

/**
 * At most one link per activation window (about 5s): the desktop opener does not consume the
 * gesture the way `window.open` does.
 */
const LINK_COOLDOWN_MS = 5_000
let lastLinkAt = Number.NEGATIVE_INFINITY

/** The frames' `postMessage`s, as Messages. Without the activation API, no link opens. */
export const bridgeStream: Stream.Stream<Message> = Dom.streamFromEventFilterMap({
	target: () => window,
	type: "message",
	filterMapEvent: (event) => {
		const message = frameMessageOf(event, bridgeFrames(), navigator.userActivation?.isActive ?? false)
		if (message?._tag === "RequestedOpenLink") {
			const now = performance.now()
			if (now - lastLinkAt < LINK_COOLDOWN_MS) return Option.none()
			lastLinkAt = now
		}
		return Option.fromNullishOr(message)
	},
})

/** The app's theme now and after every change to the root's class or style (mode, brand, gray, radius). */
export const themeStream: Stream.Stream<Message> = Stream.callback<Message>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const emit = () =>
				Queue.offerUnsafe(queue, Message.ChangedAppTheme({ theme: readDocumentTheme() }))
			let frame: number | null = null
			const observer = new MutationObserver(() => {
				if (frame !== null) return
				frame = requestAnimationFrame(() => {
					frame = null
					emit()
				})
			})
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["class", "style"],
			})
			emit()
			return () => {
				observer.disconnect()
				if (frame !== null) cancelAnimationFrame(frame)
			}
		}),
		(release) => Effect.sync(release),
	).pipe(Effect.andThen(Effect.never)),
)

// COMMAND

/** A message gone, or no longer showing the render, is the error state like any other failure. */
export const MintHtmlRenderUrl = Command.define("MintHtmlRenderUrl", {
	args: { ref: RenderRef, purpose: MintPurpose },
	messages: [Message.SucceededMintUrl, Message.FailedMintUrl],
	execute: ({ ref, purpose }) =>
		HazelRpc.use((rpc) => rpc("message.htmlRenderUrl", ref)).pipe(
			Effect.map(({ url, expiresAt }) => Message.SucceededMintUrl({ ref, purpose, url, expiresAt })),
			Effect.catchTag("MessageNotFoundError", () =>
				Effect.succeed(Message.FailedMintUrl({ ref, purpose })),
			),
			catchCommon(() => Message.FailedMintUrl({ ref, purpose })),
		),
})

/** Posts the theme to our frames (all, or one render's in one mode). The frame's origin is opaque: `"*"`. */
export const PostHtmlRenderTheme = Command.define("PostHtmlRenderTheme", {
	args: {
		theme: HtmlRenderThemeSchema,
		/** A `renderKey`, or every frame. */
		key: Schema.NullOr(Schema.String),
		mode: Schema.NullOr(FrameMode),
	},
	messages: [Message.CompletedPostTheme],
	execute: ({ theme, key, mode }) =>
		Effect.sync(() => {
			const message = htmlRenderThemeMessage(theme)
			for (const frame of frameElements()) {
				if (key !== null && renderKeyOf(frame) !== key) continue
				if (mode !== null && frameModeOf(frame) !== mode) continue
				frame.contentWindow?.postMessage(message, "*")
			}
			return Message.CompletedPostTheme()
		}),
})

/** A page's link: the system browser in the desktop app, a new tab on the web. */
export const OpenHtmlRenderLink = Command.define("OpenHtmlRenderLink", {
	args: { url: Schema.String },
	messages: [Message.CompletedOpenLink],
	execute: ({ url }) => {
		const opener = getTauriOpener()
		return (
			opener === undefined
				? Effect.sync(() => void window.open(url, "_blank", "noopener,noreferrer"))
				: Effect.tryPromise(() => opener.openUrl(url)).pipe(
						Effect.catchTag("UnknownError", (error) =>
							Effect.logWarning("Opening a link failed", error),
						),
					)
		).pipe(Effect.as(Message.CompletedOpenLink()))
	},
})

/** Set on the root while the pointer is outside the app after leaving a frame (`styles.css`). */
export const POINTER_OUTSIDE_ATTRIBUTE = "data-html-render-pointer-outside"

/**
 * The pointer left a frame, maybe straight out of the window: the browser can keep the app's
 * `:hover` on the frame's row until the app sees the pointer again, so row hover is off until then.
 */
export const MarkPointerOutside = Command.define("MarkPointerOutside", {
	messages: [Message.CompletedMarkPointerOutside],
	execute: Effect.sync(() => {
		const root = document.documentElement
		if (!root.hasAttribute(POINTER_OUTSIDE_ATTRIBUTE)) {
			root.setAttribute(POINTER_OUTSIDE_ATTRIBUTE, "")
			window.addEventListener("pointermove", () => root.removeAttribute(POINTER_OUTSIDE_ATTRIBUTE), {
				once: true,
			})
		}
		return Message.CompletedMarkPointerOutside()
	}),
})

// MOUNT

/** Frames within this distance of the viewport mint their URL. */
const NEAR_VIEWPORT_MARGIN = "600px 0px"

/**
 * On the frame's box: it came near the viewport (first render, or scrolled back into the list).
 * Without IntersectionObserver it counts as soon as it mounts.
 */
export const FrameMounted = Mount.define("HtmlRenderFrameMounted", {
	args: { ref: RenderRef, surface: FrameSurface },
	messages: [Message.MountedFrame],
	execute: ({ element, ref, surface }) =>
		Effect.callback<void>((resume) => {
			if (typeof IntersectionObserver === "undefined") return resume(Effect.void)
			const observer = new IntersectionObserver(
				(entries) => {
					if (!entries.some((entry) => entry.isIntersecting)) return
					observer.disconnect()
					resume(Effect.void)
				},
				{ rootMargin: NEAR_VIEWPORT_MARGIN },
			)
			observer.observe(element)
			return Effect.sync(() => observer.disconnect())
		}).pipe(
			Effect.andThen(Clock.currentTimeMillis),
			Effect.map((nowMs) => Message.MountedFrame({ ref, surface, nowMs })),
		),
})
