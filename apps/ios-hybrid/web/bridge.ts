/**
 * The page's side of the SwiftUI shell (`HazelHybrid/WebBridge.swift`):
 *
 * - The tab bar island (`data-native="tab-bar"`, `web-foldkit/src/shell/mobile.ts`) goes to the shell
 *   as data; the shell draws it as a Liquid Glass bar, and a press there clicks the item it stands for.
 * - `__HAZEL_SYSTEM_UI__` (`web-foldkit/src/platform/system-ui.ts`): haptics, and the swipe from the
 *   left edge that goes back, both done natively.
 */
import type { SystemUi } from "../../web-foldkit/src/platform/system-ui"
import { hex, iconKey, iconsRendering, takeNewIcons, whenIconsRasterize } from "./look"
import { type ComposerLook, pressAction, readComposer, send, setDraft } from "./composer-capture"
import { chooseRowMenu, noteMutations, pressHit, readList, steer } from "./list-capture"
import { chooseFromMenu, press, readScreen, type TreeNode } from "./semantic-tree"

type Tab = {
	id: string
	title: string
	symbol: string | null
	selected: boolean
	badge: number | null
	/** The tab's own icon as the web draws it (`look.ts` `iconKey`), and its text colour. */
	image: string | null
	color: string | null
}

type ShellMessage =
	| { type: "tabs"; tabs: Array<Tab> }
	| { type: "haptic"; kind: string }
	| { type: "swipeBack"; enabled: boolean }
	| { type: "overlay"; open: boolean }
	| { type: "thread"; open: boolean }
	| { type: "ready" }
	| { type: "screen"; screen: TreeNode | null }
	| { type: "icons"; icons: Record<string, string> }
	| { type: "composer"; composer: ComposerLook | null }
	/** The message list, as a JSON string: the shell decodes it off its main thread. */
	| { type: "list"; json: string | null }
	| { type: "log"; level: string; text: string }

/** A command for the shell (`web/host.ts`): its name and arguments. */
export type HostRequest = { command: string; args: Record<string, unknown> }
/** The shell's answer: `{ value }`, or `{ error }` when the command failed. */
export type HostAnswer = { value?: unknown; error?: string }

type Webkit = {
	messageHandlers?: {
		hazel?: { postMessage: (message: ShellMessage) => void }
		/** Asks the shell and answers (`HostBridge.swift`, `web/host.ts`). */
		host?: { postMessage: (body: HostRequest) => Promise<HostAnswer> }
	}
}

declare global {
	interface Window {
		/** WebKit's script message handlers, in a `WKWebView` (the shell's `WebBridge`). */
		webkit?: Webkit
	}
}

const post = (message: ShellMessage) => window.webkit?.messageHandlers?.hazel?.postMessage(message)

const TAB_BAR = '[data-native="tab-bar"]'

/** How long the page's semantic tree must stay unchanged before its first native frame. */
const SETTLE_MS = 250
/** How long a page with no native screen (an unconverted one, or still loading) waits before it shows as itself. */
const UNCONVERTED_SETTLE_MS = 1500

const readTabs = (): Array<Tab> => {
	const bar = document.querySelector(TAB_BAR)
	if (bar === null) return []
	return Array.from(bar.querySelectorAll<HTMLElement>("[data-native-item]")).map((item) => ({
		id: item.dataset.nativeItem ?? "",
		title: item.dataset.nativeItem ?? "",
		symbol: item.dataset.nativeSymbol ?? null,
		selected: item.dataset.nativeSelected === "true",
		badge: item.dataset.nativeBadge === undefined ? null : Number(item.dataset.nativeBadge),
		image: tabIcon(item),
		color: hex(getComputedStyle(item).color),
	}))
}

/** A tab's icon: its first SVG (not the unread badge), rasterized in the tab's own colour. */
const tabIcon = (item: HTMLElement): string | null => {
	const svg = item.querySelector("svg")
	return svg === null ? null : (iconKey(svg) ?? null)
}

/** Follows `href` as a press on a link in the app would, so Foldkit's router takes it. */
const follow = (href: string) => {
	const link = document.createElement("a")
	link.href = href
	link.style.display = "none"
	document.getElementById("app")?.appendChild(link)
	link.click()
	link.remove()
}

/** The page's console, in the app's log (`log stream --predicate 'subsystem == "sh.hazel.hybrid"'`). */
export const forwardConsole = () => {
	const text = (args: ReadonlyArray<unknown>) =>
		args
			.map((arg) =>
				arg instanceof Error
					? `${arg.name}: ${arg.message}\n${arg.stack}`
					: typeof arg === "string"
						? arg
						: safeJson(arg),
			)
			.join(" ")
	for (const level of ["log", "info", "warn", "error"] as const) {
		const original = console[level].bind(console)
		console[level] = (...args: Array<unknown>) => {
			original(...args)
			post({ type: "log", level, text: text(args) })
		}
	}
	addEventListener("error", (event) =>
		post({ type: "log", level: "error", text: `${event.message} at ${event.filename}:${event.lineno}` }),
	)
	// A picture that failed to load (its error does not bubble: caught on the way down).
	addEventListener(
		"error",
		(event) => {
			if (event.target instanceof HTMLImageElement)
				post({ type: "log", level: "warn", text: `[image] failed ${event.target.currentSrc}` })
		},
		true,
	)
	addEventListener("unhandledrejection", (event) =>
		post({ type: "log", level: "error", text: `unhandled: ${text([event.reason])}` }),
	)
}

const safeJson = (value: unknown) => {
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/**
 * Hosts that serve pictures only to web apps they know (Brandfetch's logo CDN refuses a page with no
 * web origin, as `hazel://app` is): their pictures go through the shell, which fetches them as the
 * web app (`RemotePicture` in `SchemeHandler.swift`).
 */
const PROXIED_HOSTS = new Set(["cdn.brandfetch.io"])

const proxyPicture = (image: HTMLImageElement) => {
	const src = image.getAttribute("src")
	if (src === null || !src.startsWith("https://")) return
	if (PROXIED_HOSTS.has(new URL(src).host))
		image.setAttribute("src", `hazel://app/__remote?u=${encodeURIComponent(src)}`)
}

const proxyPictures = () => {
	// A page on the web app's origin sends its own referrer: those hosts serve it as they are.
	if (location.protocol === "https:") return
	for (const image of Array.from(document.images)) proxyPicture(image)
	new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes" && record.target instanceof HTMLImageElement)
				proxyPicture(record.target)
			for (const node of Array.from(record.addedNodes)) {
				if (node instanceof HTMLImageElement) proxyPicture(node)
				else if (node instanceof Element) node.querySelectorAll("img").forEach(proxyPicture)
			}
		}
	}).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] })
}

/**
 * A web overlay is open (the command palette, a dialog, a popover): it draws in the page, so the
 * shell shows the page while it is (`ShellView`), not the native screen over it.
 */
const overlayIsOpen = () =>
	Array.from(document.querySelectorAll('dialog[open], [role="dialog"]')).some((element) =>
		element.checkVisibility({ checkVisibilityCSS: true }),
	)

/** The thread panel covers its channel (on a phone it is the whole page). */
const threadIsOpen = () =>
	Array.from(document.querySelectorAll("[data-thread-panel]")).some((element) =>
		element.checkVisibility({ checkVisibilityCSS: true }),
	)

export const installBridge = () => {
	proxyPictures()
	// The island keeps its room (the page lays out as it would with its own bar), the shell's
	// glass bar is drawn over it.
	const style = document.createElement("style")
	// The message list is drawn natively over its own place (`list-capture.ts`): the web's stays
	// laid out underneath, unseen.
	style.textContent = `${TAB_BAR} { visibility: hidden !important; }
		:root:not([data-shell-overlay]) [data-list-count] { visibility: hidden !important; }
		:root:not([data-shell-overlay]) [data-ui="composer"]:not([data-thread-panel] *) { opacity: 0 !important; pointer-events: none !important; }
		* { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }`
	document.head.appendChild(style)

	// Launch timing: the first message row on screen (`[shell] launch` is the app's own start).
	let sawFirstRow = false
	new MutationObserver((_, observer) => {
		if (sawFirstRow || document.querySelector("[data-id]") === null) return
		sawFirstRow = true
		observer.disconnect()
		post({
			type: "log",
			level: "info",
			text: `[timing] first message row at ${Math.round(performance.now())}ms after navigation start`,
		})
	}).observe(document.documentElement, { subtree: true, childList: true })

	let lastTabs = ""
	let lastListFrame = ""
	let lastComposer = ""
	let lastListCount = -1
	let lastScreen = ""
	let wasOverlayOpen = false
	let wasThreadOpen = false
	let hasShown = false
	let settle: ReturnType<typeof setTimeout> | undefined
	let scheduled = false
	const sync = () => {
		scheduled = false
		const tabs = JSON.stringify(readTabs())
		const screen = readScreen()
		const list = readList()
		const composer = JSON.stringify(readComposer())
		// A thread over its channel: the shell shows it as a page of its own (pushed, swiped back).
		const isThreadOpen = threadIsOpen()
		if (isThreadOpen !== wasThreadOpen) {
			wasThreadOpen = isThreadOpen
			post({ type: "thread", open: isThreadOpen })
		}
		const isOverlayOpen = overlayIsOpen()
		if (isOverlayOpen !== wasOverlayOpen) {
			wasOverlayOpen = isOverlayOpen
			// Under a web overlay the shell shows the page, so the page shows its own list and
			// composer again (the native ones step aside).
			document.documentElement.toggleAttribute("data-shell-overlay", isOverlayOpen)
			post({ type: "overlay", open: isOverlayOpen })
		}
		// Icons first: the tabs and the tree that name them come after.
		const icons = takeNewIcons()
		if (Object.keys(icons).length > 0) post({ type: "icons", icons })
		if (tabs !== lastTabs) {
			lastTabs = tabs
			post({ type: "tabs", tabs: JSON.parse(tabs) })
		}
		if (composer !== lastComposer) {
			lastComposer = composer
			post({ type: "composer", composer: JSON.parse(composer) })
		}
		if (list === "gone") post({ type: "list", json: null })
		else if (list !== null) {
			const frame = JSON.stringify(list.frame)
			if (
				list.rows.length > 0 ||
				list.order !== undefined ||
				frame !== lastListFrame ||
				list.count !== lastListCount
			) {
				lastListFrame = frame
				lastListCount = list.count
				post({ type: "list", json: JSON.stringify(list) })
			}
		}
		const json = JSON.stringify(screen)
		if (json === lastScreen) return
		lastScreen = json
		if (hasShown) {
			post({ type: "screen", screen })
			return
		}
		// The first native frame waits for the page to settle: its fonts loaded (the looks are
		// measured in them) and no change for a moment (the lists arrive in a few steps), so the
		// screen does not draw half-filled and then jump.
		clearTimeout(settle)
		settle = setTimeout(
			() => {
				void Promise.all([document.fonts.ready, iconsRendering()]).then(() => {
					hasShown = true
					lastScreen = ""
					sync()
				})
			},
			screen === null ? UNCONVERTED_SETTLE_MS : SETTLE_MS,
		)
	}
	// A rasterized icon changes the tree that names it.
	whenIconsRasterize(() => {
		if (scheduled) return
		scheduled = true
		requestAnimationFrame(sync)
	})
	new MutationObserver((records) => {
		noteMutations(records)
		if (scheduled) return
		scheduled = true
		requestAnimationFrame(sync)
	}).observe(document.documentElement, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	})

	// A press's own haptic (`pressFeedback`), as the finger lifts.
	document.addEventListener(
		"pointerup",
		(event) => {
			const target = event.target instanceof Element ? event.target : null
			const kind = target?.closest<HTMLElement>("[data-native-feedback]")?.dataset.nativeFeedback
			if (kind !== undefined) post({ type: "haptic", kind })
		},
		{ capture: true, passive: true },
	)

	// The swipe back:the latest `setSwipeBack` wins, and an `onBack` one before plain chevrons.
	type Back = { id: number; href: string; onBack?: () => void }
	let backs: Array<Back> = []
	let nextId = 0
	const current = () => backs.findLast((b) => b.onBack !== undefined) ?? backs.at(-1)
	const announce = () => post({ type: "swipeBack", enabled: backs.length > 0 })

	const systemUi: SystemUi = {
		feedback: (kind) => post({ type: "haptic", kind }),
		setSwipeBack: (href, onBack) => {
			const back = { id: nextId++, href, onBack }
			backs.push(back)
			announce()
			return () => {
				backs = backs.filter((b) => b.id !== back.id)
				announce()
			}
		},
	}
	Object.assign(globalThis, {
		// The native list draws the message list from every row the page lays out.
		__HAZEL_SYSTEM_UI__: { ...systemUi, drawsLists: true },
		__hazelHybrid: {
			press,
			chooseFromMenu,
			listSteer: steer,
			composerDraft: setDraft,
			composerSend: send,
			composerAction: pressAction,
			listPress: pressHit,
			listChoose: chooseRowMenu,
			selectTab: (id: string) => {
				const item = document.querySelector<HTMLElement>(
					`${TAB_BAR} [data-native-item="${CSS.escape(id)}"]`,
				)
				item?.click()
			},
			swipeBack: () => {
				const back = current()
				if (back === undefined) return
				if (back.onBack !== undefined) back.onBack()
				else follow(back.href)
			},
		},
	})
	post({ type: "ready" })
}
