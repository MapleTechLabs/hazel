import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconCopy } from "../icons"
import { type ButtonOptions, button, iconButton } from "./button"

export interface CopyButtonOptions<Message> extends ButtonOptions<Message> {
	/** The action in full (`"Copy token"`): the accessible name, and the visible text when `showLabel`. */
	readonly label: string
	/** Swaps the glyph for a green check while the page reports the copy as done. */
	readonly isCopied?: boolean
	/** A text button (`⧉ Copy email`) rather than an icon-only one. */
	readonly showLabel?: boolean
}

const glyph = <Message>(h: HtmlBuilder<Message>, isCopied: boolean): Html =>
	isCopied
		? IconCheck(h, { className: "text-success", attributes: { "data-slot": "icon" } })
		: IconCopy(h, { attributes: { "data-slot": "icon" } })

/**
 * The one copy-to-clipboard button. The page owns the copy (its Message runs the clipboard command
 * and the toast); this draws the control: `outline` and square by default, or a labelled text
 * button with `showLabel`.
 */
export const copyButton = <Message>(h: HtmlBuilder<Message>, options: CopyButtonOptions<Message>): Html => {
	const { label, isCopied = false, showLabel = false, ...rest } = options
	return showLabel
		? button(h, { intent: "outline", size: "sm", ...rest }, [glyph(h, isCopied), label])
		: iconButton(h, { intent: "outline", ...rest, label }, glyph(h, isCopied))
}
