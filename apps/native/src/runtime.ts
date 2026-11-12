/**
 * Hazel on Rune: boots the web app's own init/update/view/subscriptions and renders through a
 * Foldkit RenderTarget to the native host, against a `NativePlatform` (`src/platform.ts`).
 *
 * Boot, in order: the config (`config.ts`), the browser surface (`shims.ts`), the Tauri APIs the
 * host answers (`desktop-bridge.ts`), the data source (`data-source.ts`), the app's modules and
 * stylesheet, the element bridge and render target, and last the host connection.
 */
import { Option } from "effect"
import { makeElementBridge, makeRuneTarget, type HostToRuntime } from "@hazel/foldkit-rune"
import { readConfig } from "./config"
import { installDataSource } from "./data-source"
import { describeLink, makeDesktopBridge } from "./desktop-bridge"
import { followLink, installDocumentBridge, messageTrail } from "./document-bridge"
import { makeFrameEvents } from "./frames"
import { EDITOR_MOUNT, IMMEDIATE_MOUNTS, POINTER_MOUNTS, PROXY_MOUNTS, STYLED_MOUNTS } from "./mounts"
import { type EditableEvent, makePendingEdits } from "./pending-edits"
import { nativeOverlays } from "./overlay"
import type { NativePlatform } from "./platform"
import { installShims, openExternal } from "./shims"

/** The editor's headless DOM loads once boot goes quiet: this long without a commit… */
const HEADLESS_DOM_QUIET_MS = 250
/** …or this long after boot, whichever comes first. */
const HEADLESS_DOM_LATEST_MS = 2000

export const startRuntime = async (platform: NativePlatform) => {
	const config = readConfig(process.env)
	const debug = config.debug ? platform.log : undefined

	// What the web app reads as `import.meta.env` (under Bun, `process.env`): a production build,
	// as the web app ships, unless `HAZEL_DEV=1`; and the backend it talks to.
	if (!config.dev) process.env.PROD = "true"
	process.env.VITE_BACKEND_URL = config.backendUrl

	// The platform's own (iOS's), else the host's: Rune opens links and copies on every desktop.
	const openUrl = platform.openUrl ?? ((url: string) => transport.send({ t: "open", url }))
	const copyText = platform.copyText ?? ((text: string) => transport.send({ t: "copy", text }))

	// Live mode opens the app's own landing route; the fixture's channel exists only offline.
	const offline = config.dataMode === "offline" ? await import("./offline-session") : undefined
	const startPath = config.path ?? offline?.startPath ?? "/"
	const shims = installShims({
		width: config.width,
		height: config.height,
		dark: config.dark,
		url: `${config.origin}${startPath}`,
		openUrl,
		copyText,
		// Live, a full page load (after sign-in or sign-out) boots a fresh runtime, as a browser does.
		loadDocument:
			config.dataMode === "live"
				? (href) => {
						const next = new URL(href)
						transport.send({ t: "reload", path: `${next.pathname}${next.search}${next.hash}` })
					}
				: undefined,
		// Only live data keeps what the app stores; the offline fixture starts the same every time.
		storage: config.dataMode === "live" ? platform.storage : undefined,
	})
	platform.onExit?.(shims.flushStorage)

	/** The Tauri APIs the host answers: the keychain sign-in, and updates where it offers them. */
	const desktopBridge = makeDesktopBridge({
		send: (request) => transport.send(request),
		updates: config.updates,
		version: config.version,
		notifications: config.notifications,
		openUrl: (url) => {
			const target = URL.parse(url)
			if (target !== null) openExternal(target, openUrl)
		},
	})
	if (config.keychainSession || config.updates || config.notifications)
		Object.assign(window, { __TAURI__: desktopBridge.tauri })

	await installDataSource(config, platform, offline)

	const { Layer } = await import("effect")
	const { Runtime } = await import("foldkit")
	const app = await import("../../web-foldkit/src/main")
	// The editor root's class: the composer field takes its padding, text size and minimum height.
	const { EDITABLE_CLASS } = await import("../../web-foldkit/src/editor/editor-view")
	const { ResourcesLive } = await import("../../web-foldkit/src/rpc")
	const { NotificationSinks } = await import("../../web-foldkit/src/app/notification-sinks")
	const PendingAnnouncement = await import("../../web-foldkit/src/ui/aria/pending-announcement")
	const composer = await import("./composer")

	const styles = await platform.loadStyles()
	const onLink = (href: string) => {
		debug?.(`[link] ${href}`)
		followLink(href)
	}

	/** Mounts that observe geometry run against host-backed element proxies; the editor gets a headless DOM. */
	const bridge = makeElementBridge({
		mounts: PROXY_MOUNTS,
		immediateMounts: IMMEDIATE_MOUNTS,
		pointerTargets: POINTER_MOUNTS,
		domMounts: new Map([[EDITOR_MOUNT, composer.makeEditorElement]]),
		send: (command) => transport.send(command),
		onObserve: () => rune.refreshObserved(),
		styledMounts: new Set(STYLED_MOUNTS),
		onRestyle: () => rune.refreshObserved(),
		onScroll: () => shims.dispatchElementScroll(),
		// `rune` is created below; a Mount clicks only after the first commit.
		onClick: (path) => rune.click(path),
		onRemove: (path) => documentBridge.removed(path),
	})
	const isDark = () => (shims.rootTheme() ?? (rune.env.dark ? "dark" : "light")) === "dark"
	const documentBridge = installDocumentBridge({ bridge, styles, isDark, onRootStyle: shims.onRootStyle })

	let headlessDomTimer: ReturnType<typeof setTimeout> | undefined
	let isHeadlessDomRequested = false
	const bootedAt = performance.now()
	const scheduleHeadlessDom = () => {
		if (isHeadlessDomRequested) return
		clearTimeout(headlessDomTimer)
		const sinceBoot = performance.now() - bootedAt
		const wait = Math.max(0, Math.min(HEADLESS_DOM_QUIET_MS, HEADLESS_DOM_LATEST_MS - sinceBoot))
		headlessDomTimer = setTimeout(() => {
			isHeadlessDomRequested = true
			const domShims = ["Element", "HTMLElement", "Node"].map(
				(name) => (globalThis as Record<string, unknown>)[name],
			)
			composer.loadHeadlessDom(
				{ document, shims: domShims },
				() => rune.refreshObserved(),
				// The host keys an editor's native field `<path>/field` (`build_editable`).
				(path) => transport.send({ t: "focus", key: `${path}/field` }),
			)
		}, wait)
	}

	/** Applies a native field's edit to its editor; `false` while the editor has not mounted yet. */
	const applyEdit = (path: string, event: EditableEvent) => {
		const mount = bridge.domMountAt(path)
		if (mount === undefined) return false
		return Option.match(composer.applyEditorEvent(mount.args, event), {
			onNone: () => false,
			onSome: (isFieldBehind) => {
				// The editor's text is other than the field's: a key it handled (undo), or typing it
				// reshaped (a list marker, a picked mention). The field takes it, caret and all.
				if (isFieldBehind) rune.refreshObserved()
				return true
			},
		})
	}
	const pendingEdits = makePendingEdits({ apply: applyEdit, onDrained: () => rune.refreshObserved() })

	const rune = makeRuneTarget({
		styles,
		overlays: nativeOverlays,
		bridge,
		// A field with edits still queued keeps the text the user typed, not the empty editor's.
		editableText: (path) => {
			const queued = pendingEdits.queuedText(path)
			if (queued !== undefined) return queued
			const mount = bridge.domMountAt(path)
			return mount === undefined ? undefined : composer.editorText(mount.args)
		},
		// Queued edits keep the field's own caret; otherwise it follows the editor's.
		editableCaret: (path) => {
			if (pendingEdits.queuedText(path) !== undefined) return undefined
			const mount = bridge.domMountAt(path)
			return mount === undefined ? undefined : composer.editorCaret(mount.args)
		},
		onLink,
		// The app's resolved theme (its Light/Dark/System setting) on `<html>`, over the host's appearance.
		theme: shims.rootTheme,
		// The editor root's own classes; ProseMirror's state classes on it carry no layout.
		editableClass: () => EDITABLE_CLASS,
		onEditable: (path, event) => {
			// The text's length, not the text: the debug log must not hold what the user typed.
			debug?.(`[editable] key=${event.key ?? "-"} chars=${event.value?.length ?? "-"}`)
			pendingEdits.push(path, event)
		},
		env: { width: config.width, height: config.height, dark: config.dark, inset: config.inset },
		send: (message) => {
			if (config.treesPath) platform.appendLine?.(config.treesPath, JSON.stringify(message))
			return transport.send(message)
		},
		onStats: (stats) => {
			scheduleHeadlessDom()
			if (config.statsPath) {
				const heapUsedMb = platform.memoryUsedMb?.()
				platform.appendLine?.(
					config.statsPath,
					JSON.stringify({ at: performance.now(), heapUsedMb, ...stats }),
				)
			}
		},
	})

	// The theme lands on `<html>` (inline custom properties, the light/dark class): restyle what is on screen with it.
	styles.setRootProperties(shims.rootStyle)
	shims.onRootStyle(() => {
		styles.setRootProperties(shims.rootStyle)
		rune.refreshObserved()
	})

	/** A frame's `load` and its page's messages, as the events the web app listens for. */
	const frameEvents = makeFrameEvents({
		frameAt: (path) => bridge.proxyAt(path),
		fire: (path, event) => rune.fire(path, event),
		window,
		document,
		navigator,
	})

	// Created last: the host writes as soon as it starts, and every handler above must exist by then.
	const transport = platform.connect((message: HostToRuntime) => {
		switch (message.t) {
			case "openUrl":
				platform.log(`[native] opened with ${describeLink(message.url)}`)
				desktopBridge.openedUrl(message.url)
				return
			case "vault":
			case "update":
			case "updateProgress":
			case "notifyPermission":
				desktopBridge.answer(message)
				return
			case "frame":
				frameEvents(message)
				return
			case "windowFocus":
				shims.setWindowFocus(message.focused)
				return
			case "env":
				shims.updateEnv({ width: message.width, height: message.height, dark: message.dark })
				break
			case "event":
				if (message.type === "link" && message.value) return onLink(message.value)
				break
		}
		rune.handleHostMessage(message)
	})

	Runtime.run(
		Runtime.makeApplication({
			Model: app.Model,
			Flags: app.Flags,
			init: app.init,
			update:
				debug === undefined
					? app.update
					: (model, message) => {
							const { tags, leaf } = messageTrail(message)
							const detail =
								tags.includes("GotListMessage") || tags.some((t) => t.startsWith("Failed"))
									? ` ${JSON.stringify(leaf).slice(0, 600)}`
									: ""
							debug(`[msg] ${performance.now().toFixed(0)} ${tags.join("/")}${detail}`)
							return app.update(model, message)
						},
			view: app.view,
			subscriptions: app.subscriptions,
			resources: Layer.mergeAll(ResourcesLive, NotificationSinks.layer, PendingAnnouncement.layer),
			renderTarget: rune.target,
			routing: {
				onUrlRequest: (request) => app.Message.ClickedLink({ request }),
				onUrlChange: (url) => app.Message.ChangedUrl({ url }),
			},
		}),
		{ flags: app.flags },
	)

	// As the web app's entry does: ask once for notifications (the system remembers the answer).
	// Live only: the offline fixture never notifies, and must not put up the system's prompt.
	if (config.notifications && config.dataMode === "live") {
		const { initNativeNotifications } =
			await import("../../web-foldkit/src/core/lib/native-notifications")
		initNativeNotifications().catch((error: unknown) => platform.log(`[notifications] ${String(error)}`))
	}
}
