// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the phone app alone decides, as the services the shared screens ask for: the session, the
 * install, the app's requests, each feature's host (`SidebarHost`, `DmsHost`, `MessageListHost`) and
 * the platform's ports. Everything else is shared (`shared-screens/src/*\/hosted.ts`, `phone/`).
 */
import { HazelApiClientLayer } from "@hazel/client-data"
import type { CurrentUser } from "@hazel/domain"
import type { OrganizationId } from "@hazel/schema"
import { Install } from "@hazel/shared-screens/app/install"
import { type AppRequestHandlers, appRequestsOn } from "@hazel/shared-screens/app/requests"
import { SidebarHost } from "@hazel/shared-screens/channel-sidebar/hosted"
import { MessageListHost } from "@hazel/shared-screens/chat/hosted"
import { ComposerFiles, ComposerRequests, Drafts } from "@hazel/shared-screens/chat/composer/host"
import { LiveConnection, noLiveConnection } from "@hazel/shared-screens/chat/rich/live-replies"
import { DmsHost } from "@hazel/shared-screens/dms/hosted"
import { makePhoneNavigation } from "@hazel/shared-screens/phone/navigation"
import { ShellIntent } from "@hazel/shared-screens/phone/PhoneShell"
import { makePhoneSession } from "@hazel/shared-screens/phone/session"
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

const requests = (signOut: Effect.Effect<void>, refreshUser: Effect.Effect<void>): AppRequestHandlers => ({
	ShowToast: ({ toast }) => Effect.sync(() => navigation.intend(ShellIntent.Toast({ toast }))),
	// A full load (after joining a workspace): the app starts over, with every query and sync.
	LoadPage: () => Effect.sync(() => appShell().restart()),
	OpenModal: ({ modal }) => notYet(modal._tag),
	OpenCommandPalette: () => notYet("Search"),
	SignOut: () => signOut,
	CreateDm: () => notYet("Starting a conversation"),
	SetTheme: () => notYet("Themes"),
	SetSoundSettings: () => notYet("Notification sounds"),
	SetKeybindings: () => notYet("Keyboard shortcuts"),
	RefreshCurrentUser: () => refreshUser,
	// The App Store updates the app.
	CheckForUpdate: () => Effect.void,
	InstallUpdate: () => Effect.void,
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
		openAttachment: () => notYet("Opening attachments"),
		retry: () => notYet("Retrying a message"),
		jumpToReply: () => Effect.void,
	}),
	Layer.succeed(LiveConnection, noLiveConnection),
)

export interface PhoneContext {
	readonly me: CurrentUser.Schema
	readonly organizationId: OrganizationId
	readonly cdnUrl: string
	readonly linkPreviewUrl: string
}

/** Every service the phone's screens need beyond the data platform (`PlatformJsc`, `ClientData`). */
export const phoneHostLayer = (context: PhoneContext, signOut: Effect.Effect<void>) =>
	Layer.unwrap(
		Effect.map(makePhoneSession(context.me, context.organizationId), (session) =>
			Layer.mergeAll(
				session.layer,
				Layer.succeed(Install, { cdnUrl: context.cdnUrl, linkPreviewUrl: context.linkPreviewUrl }),
				appRequestsOn(requests(signOut, session.refreshUser)),
				featureHosts,
				ClipboardJsc,
				ComposerRequests.layer,
				Drafts.layer,
				noFiles,
				HazelApiClientLayer,
			),
		),
	).pipe(Layer.provideMerge(navigation.layer((url) => Effect.sync(() => appShell().openUrl(url)))))
