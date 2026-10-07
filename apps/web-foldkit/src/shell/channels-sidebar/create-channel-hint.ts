import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { keyboardStyles } from "~/components/ui/keyboard.styles"
import { IconClose, IconLightbulb } from "../../icons"
import { button } from "../../ui/button"
import { hotkeyLabel } from "./hotkey-label"

/** `CreateChannelHint`: under the Channels section while it is empty, until dismissed. */
export const createChannelHint = <M>(h: HtmlBuilder<M>, onDismiss: Attribute<M>): Html =>
	h.div(
		[
			h.Class(
				"mx-2 mb-1 flex items-center gap-2 rounded-md bg-secondary/50 px-2.5 py-1.5 text-xs text-muted-fg",
			),
		],
		[
			IconLightbulb(h, { className: "size-3.5 shrink-0" }),
			h.span(
				[h.Class("flex-1")],
				[
					"Create your first channel with ",
					h.kbd(
						[
							h.Attribute("data-slot", "keyboard"),
							h.Attribute("dir", "ltr"),
							h.Class(twMerge(keyboardStyles, "text-[10px]")),
						],
						[hotkeyLabel("Mod+Alt+N")],
					),
				],
			),
			button(h, { intent: "plain", size: "sq-xs", className: "size-5", attributes: [onDismiss] }, [
				IconClose(h, { className: "size-3" }),
			]),
		],
	)
