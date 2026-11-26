// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "./styles.css"
import "@hazel/ui/tokens.css"

import { Renderer, Router } from "@effect/ui"
import { BrowserRouter } from "@effect/ui/html"
import * as WebHost from "@hazel/ui/web/host"
import { Clock, Effect, Layer } from "effect"
import { setSessionBearerProvider } from "~/lib/session-bearer"
import { initNativeNotifications } from "~/lib/native-notifications"
import { detectPlatform } from "~/lib/keybindings/key-combo"
import { desktopAuthClient } from "./platform/desktop"
import { desktopSessionBearer } from "./platform/desktop-auth"
import { NotificationSinks } from "./app/notification-sinks"
import { handOffPaint, installPaintCapture, paintStorage } from "./app/paint"
import { loadRememberedUser } from "./app/remembered-user"
import * as AiPanel from "./assistant"
import { installImageViewerMorph } from "./chat/viewer/morph"
import { installChannelPrefetch } from "./core/db/channel-prefetch"
import { localCacheHost } from "./core/db/local-cache-host"
import { loadKeybindingOverrides } from "./keybindings"
import { loadSoundSettings } from "./notification-sound"
import { loadPages } from "./page/registry"
import { HazelRpcLive } from "./rpc"
import { HazelAuthClientLive } from "./auth/client"
import { App, type Boot } from "./root/app"
import { commandsLayer } from "./root/commands"
import { AppRoutes } from "./root/routes"
import { loadIsCreateChannelHintDismissed } from "./shell/channels-sidebar"
import { loadThemePreference, resolveSystemTheme } from "./theme"
import { MOBILE_QUERY } from "./ui/viewport"

/** Read before the first render, so a stored theme, the viewport or a dismissed hint never flash. */
const boot: Effect.Effect<Boot> = Effect.all({
	themePreference: loadThemePreference,
	systemTheme: Effect.sync(resolveSystemTheme),
	soundSettings: loadSoundSettings,
	keybindingOverrides: loadKeybindingOverrides,
	keyboardPlatform: Effect.sync(detectPlatform),
	sessionStartMs: Clock.currentTimeMillis,
	isMobile: Effect.sync(() => globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false),
	isCreateChannelHintDismissed: loadIsCreateChannelHintDismissed,
	rememberedUser: loadRememberedUser,
	aiPanel: AiPanel.loadStored,
})

/**
 * `index.html`'s `#app` gives its place to the shell's mount point; the shell draws its own `#app`
 * inside it (the paint and the native shells look it up by id).
 */
const mountPoint = (): HTMLElement => {
	const placeholder = document.getElementById("app")!
	const container = document.createElement("div")
	container.style.display = "contents"
	placeholder.replaceWith(container)
	return container
}

/** The app's services, shared by the shell's Commands and its children. */
const services = Layer.mergeAll(HazelRpcLive, HazelAuthClientLive, NotificationSinks.layer)

const start = () => {
	const container = mountPoint()
	const main = Layer.effectDiscard(
		Renderer.mount(
			App,
			Effect.all({ route: Router.currentRoute(AppRoutes), boot }),
			container,
		),
	).pipe(
		Layer.provide(commandsLayer),
		Layer.provide(
			Layer.mergeAll(
				WebHost.layer(),
				// Today's navigation: no scroll restoration, announcement or focus move of the Router's own.
				BrowserRouter.layer({ routes: AppRoutes, scroll: false, announce: false, focus: false }),
			),
		),
		Layer.provide(services),
	)
	// The kit visuals converted from Foldkit widen the view's requirements to `any`; every service
	// the tree needs is provided above.
	Layer.launch(main as Layer.Layer<never>).pipe(Effect.runFork)
}

// The desktop app has no API cookie: its requests carry its own session as a bearer.
if (desktopAuthClient !== null) setSessionBearerProvider(desktopSessionBearer)
installImageViewerMorph()
// The dev server loads every page area first, so a page's own chunk never shows its placeholder.
if (import.meta.env.DEV)
	loadPages().then(start, (error: unknown) => {
		console.error("[dev] a page area did not load; reload to try again", error)
		document.getElementById("app")!.textContent = "A page area did not load. Reload to try again."
	})
else start()
// The last screen, drawn by `index.html` before this script loaded, until the app draws its own;
// and this screen, for the next load. The native apps draw no `index.html`.
if (localCacheHost() === undefined) {
	handOffPaint(document)
	const storage = paintStorage()
	if (storage !== null) installPaintCapture(document, storage)
}
installChannelPrefetch()
// Desktop only: native notification permission (a no-op in the browser).
initNativeNotifications().catch((error: unknown) =>
	console.error("[desktop] native notifications did not start:", error),
)
