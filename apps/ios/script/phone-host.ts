// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the phone app alone decides, as the services the shared screens ask for: the session, the
 * app's requests, each feature's host (`SidebarHost`, `DmsHost`, `MessageListHost`) and
 * the platform's ports. Everything else is shared (`shared-screens/src/*\/hosted.ts`, `phone/`).
 */
import { HazelApiClientLayer } from "@hazel/client-data"
import type { CurrentUser } from "@hazel/domain"
import type { OrganizationId } from "@hazel/schema"
import { type AppRequestHandlers, appRequestsOn } from "@hazel/shared-screens/app/requests"
import { SidebarHost } from "@hazel/shared-screens/channel-sidebar/hosted"
import { MessageListHost } from "@hazel/shared-screens/chat/hosted"
import { ComposerFiles, ComposerRequests, Drafts } from "@hazel/shared-screens/chat/composer/host"
import { LiveConnection, noLiveConnection } from "@hazel/shared-screens/chat/rich/live-replies"
import { DmsHost } from "@hazel/shared-screens/dms/hosted"
import { makePhoneNavigation } from "@hazel/shared-screens/phone/navigation"
import { ShellIntent } from "@hazel/shared-screens/phone/PhoneShell"
import { makePhoneSession } from "@hazel/shared-screens/phone/session"
import { ImageUploads, UploadFailedError } from "@hazel/shared-screens/settings/shared/upload"
import { Effect, Layer, Stream } from "effect"
import { ClipboardJsc } from "../../../packages/client-data/src/platform/jsc/index.ts"
import { appShell } from "./shell"

/** The one navigation queue: the shell follows it, the host's paths (push, deep link) join it. */
export const navigation = Effect.runSync(makePhoneNavigation)

/** A visible "not yet" for what the phone does not do yet (no silent no-op): it names the feature. */
const notYet = (what: string) =>
	Effect.sync(() =>
		navigation.intend(
			ShellIntent.Toast({
				toast: { intent: "info", title: `${what} is not on iPhone yet`, description: null },
			}),
		),
	)

const toast = (title: string, intent: "info" | "error" = "info") =>
	Effect.sync(() => navigation.intend(ShellIntent.Toast({ toast: { intent, title, description: null } })))

const requests = (signOut: Effect.Effect<void>, refreshUser: Effect.Effect<boolean>): AppRequestHandlers => ({
	ShowToast: ({ toast }) => Effect.sync(() => navigation.intend(ShellIntent.Toast({ toast }))),
	// The app starts over at `href`, with every query and sync (after joining a workspace).
	Reload: ({ href }) => Effect.sync(() => appShell().restart(href)),
	// Another page (a download, an OAuth redirect): the system opens it.
	Leave: ({ href }) => Effect.sync(() => appShell().openUrl(href)),
	OpenModal: ({ modal }) => notYet(modal._tag),
	OpenCommandPalette: () => notYet("Search"),
	SignOut: () => signOut,
	CreateDm: () => notYet("Starting a conversation"),
	SetTheme: () => notYet("Themes"),
	SetSoundSettings: () => notYet("Notification sounds"),
	SetKeybindings: () => notYet("Keyboard shortcuts"),
	RefreshCurrentUser: () =>
		Effect.flatMap(refreshUser, (ok) =>
			ok ? Effect.void : toast("Couldn't refresh your profile", "error"),
		),
	// The App Store updates the app.
	CheckForUpdate: () => Effect.void,
	InstallUpdate: () => Effect.void,
})

/** No image uploads until the photo picker (N4): a pick says so and picks nothing. */
const noImageUploads = Layer.succeed(ImageUploads, {
	pick: () => Effect.as(notYet("Uploading images"), null),
	upload: () => Effect.fail(new UploadFailedError({ failure: "NotConfigured" })),
})

/** No files until the photo picker (N4): a pick is empty, nothing uploads. */
const noFiles = Layer.succeed(ComposerFiles, {
	pick: Effect.succeed([]),
	dropped: Effect.succeed([]),
	upload: () => Stream.empty,
	release: () => Effect.void,
})

const featureHosts = Layer.mergeAll(
	// The phone shows no create-channel hint (`hintDismissed`).
	Layer.succeed(SidebarHost, { dismissHint: Effect.void }),
	Layer.succeed(DmsHost, { compose: notYet("Starting a conversation") }),
	Layer.succeed(MessageListHost, {
		deleteMessage: () => notYet("Deleting a message"),
		createIssue: () => notYet("Creating an issue"),
		// Photos open in the lightbox; a file (or a video, until the player) opens in the system's viewer.
		openAttachment: ({ media, index, url }) => {
			// As the viewer reads them: a photo without a url is left out of the list and its index.
			const photos = (media ?? []).filter((each) => each.kind === "image" && (each.url ?? "") !== "")
			const at = photos.findIndex((each) => each === media?.[index])
			return at >= 0
				? Effect.sync(() => navigation.intend(ShellIntent.ShowMedia({ items: photos, index: at })))
				: url === ""
					? Effect.void
					: Effect.sync(() => appShell().openUrl(url))
		},
		retry: () => notYet("Retrying a message"),
		jumpToReply: () => notYet("Jumping to a reply"),
	}),
	Layer.succeed(LiveConnection, noLiveConnection),
)

export interface PhoneContext {
	readonly me: CurrentUser.Schema
	readonly organizationId: OrganizationId
}

/**
 * Every service the phone's screens need beyond the data platform (`PlatformJsc`, `ClientData`),
 * and the session's background work (`prefetch`), which the caller runs for as long as the shell
 * lives: a fiber forked while the layer builds would end with `Renderer.mount`, not with the shell.
 */
export const makePhoneHost = (context: PhoneContext, signOut: Effect.Effect<void>) =>
	Effect.map(makePhoneSession(context.me, context.organizationId), (session) => ({
		prefetch: session.prefetch,
		layer: Layer.mergeAll(
			session.layer,
			noImageUploads,
			appRequestsOn(requests(signOut, session.refreshUser)),
			featureHosts,
			ClipboardJsc,
			ComposerRequests.layer,
			Drafts.layer,
			noFiles,
			HazelApiClientLayer,
		).pipe(Layer.provideMerge(navigation.layer((url) => Effect.sync(() => appShell().openUrl(url))))),
	}))
