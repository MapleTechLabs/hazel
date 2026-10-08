import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { Page as CommandPalettePage } from "../overlay/command-palette/model"
import { ModalRequest } from "../overlay/modal/requests"
import { ToastRequest } from "../overlay/toasts"
import { SoundSettings } from "../notification-sound"
import { ThemePreference } from "../theme"

/** Facts a page (or the shell) reports to the root, which owns navigation and the overlays. */
export const PageOutMessage = defineMessageUnion({
	/** `toast` shows with the navigation (legacy `onSuccess: toast + navigate` in one handler). */
	RequestedNavigation: { href: Schema.String, replace: Schema.Boolean, toast: Schema.optionalKey(ToastRequest) },
	RequestedToast: { toast: ToastRequest },
	RequestedModal: { modal: ModalRequest },
	RequestedCommandPalette: { page: CommandPalettePage },
	RequestedSignOut: {},
	/** Apply and persist the theme (legacy `setTheme` / `setCustomization`); read it back as `Shared.theme`. */
	RequestedTheme: { preference: ThemePreference },
	/** Store the notification sound settings (legacy `setSettings`); read them back as `Shared.soundSettings`. */
	RequestedSoundSettings: { settings: SoundSettings },
	/** Re-run `user.me` (legacy `useAtomRefresh(userAtom)`), with the toast that goes with it. */
	RequestedCurrentUserRefresh: { toast: Schema.optionalKey(ToastRequest) },
	/** The mobile header's menu button: open the sidebar sheet (`setIsOpenOnMobile(true)`). */
	RequestedMobileSidebar: {},
})
export type PageOutMessage = typeof PageOutMessage.Type
