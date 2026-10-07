import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { Page as CommandPalettePage } from "../overlay/command-palette/model"
import { ModalRequest } from "../overlay/modal/requests"
import { ToastRequest } from "../overlay/toasts"

/** Facts a page (or the shell) reports to the root, which owns navigation and the overlays. */
export const PageOutMessage = defineMessageUnion({
	/** `toast` shows with the navigation (legacy `onSuccess: toast + navigate` in one handler). */
	RequestedNavigation: { href: Schema.String, replace: Schema.Boolean, toast: Schema.optionalKey(ToastRequest) },
	RequestedToast: { toast: ToastRequest },
	RequestedModal: { modal: ModalRequest },
	RequestedCommandPalette: { page: CommandPalettePage },
	RequestedSignOut: {},
})
export type PageOutMessage = typeof PageOutMessage.Type
