// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { UiSchema } from "@effect/ui"
import { AppRequest } from "@hazel/shared-screens/app/requests"
import { NotificationId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { CommonReason } from "~/lib/error-messages"
import { SessionAnswer } from "../app/auth"
import { HostOutSchema } from "../app/context"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import { ToastRequest } from "../overlay/toasts"
import { DesktopMenuItem } from "../platform/desktop-menu"
import { CurrentUser, Member, Organization } from "../session"
import { ResolvedTheme } from "../theme"
import { AppRoute } from "./routes"

/** The shell's messages: the session, the organization, the route, the theme, the keys and the toasts. */
export const AppMessage = UiSchema.TaggedEnum({
	ChangedRoute: { route: AppRoute },
	ChangedSystemTheme: { theme: ResolvedTheme },
	/** `useSidebar().isMobile`: the `(max-width: 767px)` media query changed. */
	ChangedViewport: { isMobile: Schema.Boolean },
	FailedSaveThemePreference: {},
	FailedSaveSoundSettings: {},
	FailedSaveKeybindings: {},
	/** The member's latest notifications (newest first), for the sound and native sinks. */
	UpdatedRecentNotifications: { ids: Schema.Array(NotificationId) },
	/** The user's unread notifications in every organization. */
	UpdatedUnreadMentions: { ids: Schema.Array(NotificationId) },
	ChangedAuth: { auth: SessionAnswer },
	/** The API did not answer the session check: nothing is known about the session. */
	FailedCheckSession: { reason: CommonReason },
	PressedRetrySession: {},
	/** The API refused to exchange the session for an access token. */
	RejectedSession: {},
	SucceededFetchCurrentUser: { user: CurrentUser },
	FailedFetchCurrentUser: { reason: CommonReason },
	PressedRetryCurrentUser: {},
	SucceededSignOut: {},
	FailedSignOut: { reason: CommonReason },
	/** The organization query for `orgSlug` answered (found or not). */
	UpdatedOrganization: { orgSlug: Schema.String, organization: Schema.NullOr(Organization) },
	/** The organization query for `orgSlug` has not loaded after a while, or its source failed. */
	StalledOrganization: { orgSlug: Schema.String },
	PressedReload: {},
	/** The user's row in `organizationId` (null when they have none). */
	UpdatedMember: { organizationId: OrganizationId, member: Schema.NullOr(Member) },
	TickedClock: { nowMs: Schema.Finite },
	/** A Command's own toast (`overlay/background-toasts.ts`), or one a Foldkit part asked for. */
	ReceivedToast: { toast: ToastRequest },
	/** A desktop app menu item (`menu-*` events from the Tauri host). */
	PressedDesktopMenuItem: { item: DesktopMenuItem },
	/** A `$orgSlug/layout.tsx` binding fired. */
	PressedHotkey: { actionId: LayoutHotkeyActionId },
	/** What the Foldkit host asked for, or its state for the frame. */
	ReceivedHostOut: { out: HostOutSchema },
	/** A native page asked the app for something (`native-pages.ts`). */
	ReceivedAppRequest: { request: AppRequest },
	/** The tab bar's search, a section's top bar menu and the nav rail's AI button. */
	PressedMobileSearch: {},
	PressedMobileMenu: {},
	PressedAiPanelToggle: {},
})
export type AppMessage = typeof AppMessage.Type
