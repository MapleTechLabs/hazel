import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { Page as CommandPalettePage } from "../overlay/command-palette"
import { ModalRequest } from "../overlay/modal"
import { ToastRequest } from "../overlay/toasts"

/** Facts a page (or the shell) reports to the root, which owns navigation and the overlays. */
export const PageOutMessage = defineMessageUnion({
	RequestedNavigation: { href: Schema.String, replace: Schema.Boolean },
	RequestedToast: { toast: ToastRequest },
	RequestedModal: { modal: ModalRequest },
	RequestedCommandPalette: { page: CommandPalettePage },
	RequestedSignOut: {},
	/** The mobile header's menu button: open the sidebar sheet (`setIsOpenOnMobile(true)`). */
	RequestedMobileSidebar: {},
})
export type PageOutMessage = typeof PageOutMessage.Type
