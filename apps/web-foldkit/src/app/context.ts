/**
 * What the Effect UI shell (`src/root`) tells the Foldkit host about, and what the host asks of it.
 * The shell owns the route, the session, the organization, the theme and the toasts; the host owns
 * the Foldkit pages and overlays that have not moved yet. Part of the adapter.
 */
import type { Assistant } from "@hazel/domain/models"
import type { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import type { Platform as KeyboardPlatform } from "~/lib/keybindings/key-combo"
import type { Overrides } from "~/lib/keybindings/keymap"
import type { SoundSettings } from "../notification-sound"
import type { PageOutMessage } from "../page/out-message"
import type { Badge } from "../platform/badge"
import type * as Updates from "../platform/updates"
import type { AppRoute } from "../route"
import type { Auth, CurrentUser, Member, Organization } from "../session"
import type { ResolvedTheme, ThemePreference } from "../theme"

export interface HostContext {
	readonly route: AppRoute
	/** Counts the shell's route changes: each one enters the route again, as a URL change did. */
	readonly navigation: number
	readonly auth: Auth
	readonly currentUser: CurrentUser | null
	/** The route's organization once loaded, never another slug's, and the user's row in it. */
	readonly organization: Organization | null
	readonly member: Member | null
	/** The signed-in user and the route's organization have loaded: presence runs. */
	readonly isShellReady: boolean
	readonly isMobile: boolean
	readonly nowMs: number
	readonly themePreference: ThemePreference
	readonly resolvedTheme: ResolvedTheme
	readonly soundSettings: SoundSettings
	readonly keybindingOverrides: Overrides
	readonly keyboardPlatform: KeyboardPlatform
	readonly unreadMentionIds: ReadonlyArray<NotificationId>
	/** The root draws a modal over the frame (`root/modals.ts`): keys and typing stay out of the page. */
	readonly isNativeModalOpen?: boolean
	/** The shell's command palette is open: pages keep their keys off, as under a modal. */
	readonly isPaletteOpen: boolean
}

/** What the shell shows from the host's state: the dock, the bell, the badge and the page's context. */
export interface HostReport {
	readonly isOverlayOpen: boolean
	readonly isSidebarCollapsed: boolean
	readonly bellCount: number
	/** Activity's "Mark all as read": the unread notifications left, and whether the calls run. */
	readonly unreadNotificationCount: number
	readonly isMarkingAllRead: boolean
	readonly badge: Badge
	/** What a Foldkit page says it shows, for the AI panel (`PageSpec.assistantContext`). */
	readonly assistantContext: Assistant.Context | null
	/** The desktop app's update state, for the native Desktop settings page (PS6). */
	readonly desktopUpdate: Updates.Model
}

/** A page or overlay's request the shell acts on, or the host's state for the frame. */
export type HostOut =
	| { readonly _tag: "Page"; readonly outMessage: PageOutMessage }
	| { readonly _tag: "Report"; readonly report: HostReport }
	/** Mod+J or the palette asked for the AI panel, which the shell owns. */
	| { readonly _tag: "Assistant"; readonly request: "Open" | "Toggle" }

/** Values cross the port by reference: both sides are this app, and decoding would copy every row. */
const passthrough = <A>() => Schema.declare((_: unknown): _ is A => true)

export const HostContextSchema = passthrough<HostContext>()
export const HostOutSchema = passthrough<HostOut>()
