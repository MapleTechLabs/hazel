/**
 * `hz:sheet` on the web (lane A3): a modal sheet, from the bottom edge in the compact size class and
 * a centred form sheet in the regular one (as iOS draws it), with a title and a close button that
 * asks to close (`dismiss`).
 */
import { svg } from "../../icons.ts"
import { part } from "../define.ts"
import { modalPrimitive } from "./modal.ts"

export const primitive = modalPrimitive("sheet", ({ panel, header, dismiss }) => {
	const close = part(panel.ownerDocument, "button", "close")
	close.setAttribute("type", "button")
	close.setAttribute("aria-label", "Close")
	close.innerHTML = svg("close")
	close.addEventListener("click", dismiss)
	header.append(close)
	return () => false
})
