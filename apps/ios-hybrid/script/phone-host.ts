// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the phone app alone decides, as services for the shared screens (`shared-screens/app/hosted`,
 * `phone/`): the signed-in context, the sidebar's own menus, the app's requests, and the platform's
 * ports (clipboard, files, the system browser). Everything else is shared.
 */
import { HazelApiClientLayer } from "@hazel/client-data"
import { AppContext, ChatHost } from "@hazel/shared-screens/app/hosted"
import { type AppRequestHandlers, appRequestsOn } from "@hazel/shared-screens/app/requests"
import { ComposerFiles, ComposerRequests, Drafts } from "@hazel/shared-screens/chat/composer/host"
import { noLiveConnection } from "@hazel/shared-screens/chat/rich/live-replies"
import { makePhoneNavigation } from "@hazel/shared-screens/phone/navigation"
import { Effect, Layer, Match, Stream } from "effect"
import { ClipboardJsc } from "../../../packages/client-data/src/platform/jsc/index.ts"
import { appShell } from "./shell"

/** The one navigation queue: the shell follows it, the host's paths (push, deep link) join it. */
export const navigation = Effect.runSync(makePhoneNavigation)

/** Not answered on the phone yet, by name, in the log: each arrives with the screen that needs it. */
const later = (what: string) => () => Effect.sync(() => console.log(`[hazel] not on iOS yet: ${what}`))

const requests = (signOut: Effect.Effect<void>): AppRequestHandlers => ({
	LoadPage: ({ href }) => Effect.sync(() => appShell().openUrl(href)),
	ShowToast: later("ShowToast"),
	OpenModal: ({ modal }) => later(`OpenModal ${modal._tag}`)(),
	OpenCommandPalette: later("OpenCommandPalette"),
	SignOut: () => signOut,
	CreateDm: later("CreateDm"),
	SetTheme: later("SetTheme"),
	SetSoundSettings: later("SetSoundSettings"),
	SetKeybindings: later("SetKeybindings"),
	RefreshCurrentUser: later("RefreshCurrentUser"),
	CheckForUpdate: later("CheckForUpdate"),
	InstallUpdate: later("InstallUpdate"),
})

/** No files until the photo picker (N4): a pick is empty, nothing uploads. */
const noFiles = Layer.succeed(ComposerFiles, {
	pick: Effect.succeed([]),
	dropped: Effect.succeed([]),
	upload: () => Stream.empty,
	release: () => Effect.void,
})

/** Every service the phone's screens need beyond the data platform (`PlatformJsc`, `ClientData`). */
export const phoneHostLayer = (context: AppContext["Service"], signOut: Effect.Effect<void>) =>
	Layer.mergeAll(
		Layer.succeed(AppContext, context),
		Layer.succeed(ChatHost, {
			sidebarAction: (action) =>
				Match.valueTags(action, {
					AccountMenu: ({ key }) => (key === "sign-out" ? signOut : later(`account menu ${key}`)()),
					OrgMenu: ({ key }) => later(`org menu ${key}`)(),
					// The phone shows no hint (`hintDismissed`).
					DismissHint: () => Effect.void,
				}),
			messageRequest: (_channelId, request) => later(`message ${request._tag}`)(),
			composeDm: later("compose DM")(),
			live: noLiveConnection,
		}),
		appRequestsOn(requests(signOut)),
		ClipboardJsc,
		ComposerRequests.layer,
		Drafts.layer,
		noFiles,
		HazelApiClientLayer,
	).pipe(Layer.provideMerge(navigation.layer((url) => Effect.sync(() => appShell().openUrl(url)))))
