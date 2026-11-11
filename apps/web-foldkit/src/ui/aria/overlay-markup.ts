/** The markup modal overlays render around their content; `overlay.ts` re-exports it. */
import type { Html, HtmlBuilder } from "foldkit/html"

/** React Aria's visually hidden `DismissButton`, rendered at both ends of a modal popover. */
export const dismissButton = <Message>(h: HtmlBuilder<Message>, onDismiss: Message): Html =>
	h.div(
		[h.Class("sr-only")],
		[
			h.button([
				h.Attribute("aria-label", "Dismiss"),
				h.Attribute("tabindex", "-1"),
				h.Type("button"),
				h.OnClick(onDismiss),
			]),
		],
	)

/** The hidden sentinels FocusScope renders around contained content. */
export const focusScopeSentinel = <Message>(h: HtmlBuilder<Message>, edge: "start" | "end"): Html =>
	h.span([h.Attribute(`data-focus-scope-${edge}`, "true"), h.Attribute("hidden", "")])

/** The fixed underlay a modal popover renders behind itself. */
export const popoverUnderlay = <Message>(h: HtmlBuilder<Message>): Html =>
	h.div([h.Attribute("data-testid", "underlay"), h.Class("fixed inset-0")])
