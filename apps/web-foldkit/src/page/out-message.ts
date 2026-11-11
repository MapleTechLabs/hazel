import { OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { Page as CommandPalettePage } from "../overlay/command-palette/model"
import { ModalRequest } from "../overlay/modal/requests"
import { AppRoute } from "../route"
import { ToastRequest } from "../overlay/toasts"
import { SoundSettings } from "../notification-sound"
import { ThemePreference } from "../theme"

/** Facts a page (or the shell) reports to the root, which owns navigation and the overlays. */
export const PageOutMessage = defineMessageUnion({
	/** `toast` shows with the navigation (legacy `onSuccess: toast + navigate` in one handler). */
	RequestedNavigation: {
		route: AppRoute,
		replace: Schema.Boolean,
		toast: Schema.optionalKey(ToastRequest),
	},
	RequestedToast: { toast: ToastRequest },
	RequestedModal: { modal: ModalRequest },
	RequestedCommandPalette: { page: CommandPalettePage },
	RequestedSignOut: {},
	/**
	 * Create a single DM with `userId` in the org at `orgSlug`, then open it. The root runs the request,
	 * so its toast still resolves after the user leaves the page that asked.
	 */
	RequestedDmCreation: {
		organizationId: OrganizationId,
		orgSlug: Schema.String,
		userId: UserId,
		name: Schema.String,
	},
	/** Apply and persist the theme (legacy `setTheme` / `setCustomization`); read it back as `Shared.theme`. */
	RequestedTheme: { preference: ThemePreference },
	/** Store the notification sound settings (legacy `setSettings`); read them back as `Shared.soundSettings`. */
	RequestedSoundSettings: { settings: SoundSettings },
	/** Re-run `user.me` (legacy `useAtomRefresh(userAtom)`), with the toast that goes with it. */
	RequestedCurrentUserRefresh: { toast: Schema.optionalKey(ToastRequest) },
	/** Desktop: check for an app update now; read the result back as `Shared.desktopUpdate`. */
	RequestedUpdateCheck: {},
	/** Desktop: download and install the available update, then relaunch. */
	RequestedUpdateInstall: {},
})
export type PageOutMessage = typeof PageOutMessage.Type
export type RequestedDmCreation = Extract<PageOutMessage, { readonly _tag: "RequestedDmCreation" }>

/** `RequestedNavigation` to an org route; nothing outside an org, where org pages never update. */
export const requestedOrgNavigation = (
	orgSlug: string | null,
	toRoute: (orgSlug: string) => AppRoute,
	options: { readonly replace?: boolean; readonly toast?: ToastRequest } = {},
): PageOutMessage | undefined =>
	orgSlug === null
		? undefined
		: PageOutMessage.RequestedNavigation({
				route: toRoute(orgSlug),
				replace: options.replace ?? false,
				...(options.toast === undefined ? {} : { toast: options.toast }),
			})
