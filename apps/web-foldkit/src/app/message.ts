import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { UrlRequest } from "foldkit/navigation"
import { Url } from "foldkit/url"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { PageMessage } from "../page/registry"
import { Auth, CurrentUser, Member, Organization } from "../session"
import * as Shell from "../shell/model"
import { ResolvedTheme } from "../theme"

export const Message = defineMessageUnion({
	ClickedLink: { request: UrlRequest },
	ChangedUrl: { url: Url },
	CompletedNavigateInternal: {},
	CompletedReplaceUrl: {},
	CompletedLoadExternal: {},
	ChangedSystemTheme: { theme: ResolvedTheme },
	CompletedApplyTheme: {},
	CompletedSaveThemePreference: {},
	CompletedSaveSoundSettings: {},
	/** The member's latest notifications (newest first), for the sound and native sinks. */
	UpdatedRecentNotifications: { ids: Schema.Array(NotificationId) },
	CompletedDeliverNotifications: {},
	ChangedAuth: { auth: Auth },
	SucceededFetchCurrentUser: { user: CurrentUser },
	FailedFetchCurrentUser: { reason: Schema.String },
	CompletedSignOut: {},
	/** The organization query for `orgSlug` answered (found or not). */
	UpdatedOrganization: { orgSlug: Schema.String, organization: Schema.NullOr(Organization) },
	UpdatedMember: { member: Schema.NullOr(Member) },
	TickedPresenceClock: { nowMs: Schema.Number },
	ClickedLayoutTab: { href: Schema.String },
	GotPageMessage: { message: PageMessage },
	GotShellMessage: { message: Shell.Message },
	GotModalMessage: { message: Modal.Message },
	GotCommandPaletteMessage: { message: CommandPalette.Message },
	GotToastsMessage: { message: Toasts.Message },
	/** A legacy `useAppHotkey` binding fired (`lib/hotkeys/hotkey-registry.ts` id). */
	PressedHotkey: { actionId: Schema.String },
})
export type Message = typeof Message.Type
