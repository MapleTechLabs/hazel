import { NotificationId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { UrlRequest } from "foldkit/navigation"
import { Url } from "foldkit/url"
import { CommonReason } from "~/lib/error-messages"
import * as CommandPalette from "../overlay/command-palette"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { Message as PageMessage } from "../page/registry"
import { AppRoute } from "../route"
import { CurrentUser, Member, Organization } from "../session"
import * as Platform from "../platform"
import { DesktopMenuItem } from "../platform/desktop-menu"
import * as Updates from "../platform/updates"
import * as Shell from "../shell/model"
import { ResolvedTheme } from "../theme"

/** What the API said about the session, when it answered. */
export const SessionAnswer = Schema.Literals(["SignedIn", "SignedOut"])
export type SessionAnswer = typeof SessionAnswer.Type

export const Message = defineMessageUnion({
	ClickedLink: { request: UrlRequest },
	ChangedUrl: { url: Url },
	CompletedNavigateInternal: {},
	CompletedReplaceUrl: {},
	CompletedLoadExternal: {},
	ChangedSystemTheme: { theme: ResolvedTheme },
	/** `useSidebar().isMobile`: the `(max-width: 767px)` media query changed. */
	ChangedViewport: { isMobile: Schema.Boolean },
	CompletedApplyTheme: {},
	CompletedSaveThemePreference: {},
	FailedSaveThemePreference: {},
	CompletedSaveSoundSettings: {},
	FailedSaveSoundSettings: {},
	/** The member's latest notifications (newest first), for the sound and native sinks. */
	UpdatedRecentNotifications: { ids: Schema.Array(NotificationId) },
	CompletedDeliverNotifications: {},
	ChangedAuth: { auth: SessionAnswer },
	/** The API did not answer the session check: nothing is known about the session. */
	FailedCheckSession: { reason: CommonReason },
	PressedRetrySession: {},
	/** The API refused to exchange the session for an access token. */
	RejectedSession: {},
	SucceededFetchCurrentUser: { user: CurrentUser },
	FailedFetchCurrentUser: { reason: CommonReason },
	PressedRetryCurrentUser: {},
	CompletedWarmAccessToken: {},
	SucceededSignOut: {},
	FailedSignOut: { reason: CommonReason },
	/** The organization query for `orgSlug` answered (found or not). */
	UpdatedOrganization: { orgSlug: Schema.String, organization: Schema.NullOr(Organization) },
	/** The organization query for `orgSlug` has not loaded after a while, or its source failed. */
	StalledOrganization: { orgSlug: Schema.String },
	PressedReload: {},
	CompletedReload: {},
	/** The user's row in `organizationId` (null when they have none). */
	UpdatedMember: { organizationId: OrganizationId, member: Schema.NullOr(Member) },
	TickedClock: { nowMs: Schema.Number },
	ClickedLayoutTab: { route: AppRoute },
	GotPageMessage: { message: PageMessage },
	GotShellMessage: { message: Shell.Message },
	GotModalMessage: { message: Modal.Message },
	GotCommandPaletteMessage: { message: CommandPalette.Message },
	GotToastsMessage: { message: Toasts.Message },
	GotPlatformMessage: { message: Platform.Message },
	GotUpdatesMessage: { message: Updates.Message },
	/** A desktop app menu item (`menu-*` events from the Tauri host). */
	PressedDesktopMenuItem: { item: DesktopMenuItem },
	/** A legacy `useAppHotkey` binding fired (`lib/hotkeys/hotkey-registry.ts` id). */
	PressedHotkey: { actionId: LayoutHotkeyActionId },
})
export type Message = typeof Message.Type
