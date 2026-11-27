/**
 * `hz:sheet` on the web (lane A3): a modal sheet, from the bottom edge in the compact size class and
 * a centred form sheet in the regular one (as iOS draws it), with a title and a close button that
 * asks to close (`dismiss`). `style` `card` floats it 8px from the edges with the close in its corner.
 */
import { svg } from "../../icons.ts"
import { option, part } from "../define.ts"
import { modalPrimitive } from "./modal.ts"

export const primitive = modalPrimitive("sheet", ({ node, panel, header, dismiss }) => {
	const close = part(panel.ownerDocument, "button", "close")
	close.setAttribute("type", "button")
	close.setAttribute("aria-label", "Close")
	close.innerHTML = svg("close")
	close.addEventListener("click", dismiss)
	header.append(close)
	return (name, value) => {
		if (name !== "style") return false
		option(node, "style", value)
		return true
	}
})
