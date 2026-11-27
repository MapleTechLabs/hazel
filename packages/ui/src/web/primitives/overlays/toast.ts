/**
 * `hz:toast` on the web (lane A3): a notice at the bottom edge, in the top layer so it shows over
 * the app's overlays too. Open toasts stack upwards, newest at the bottom. It takes no focus and no
 * Escape (it is not a layer); its close button and the view's timer close it (`dismiss`). A danger or
 * warning tone is an `alert`, the rest a polite `status`. `loading` leads with today's spinner.
 */
import {
	hidePanel,
	installOverlayStyles,
	isSpecimen,
	makePopoverPanel,
	showPanel,
	whenConnected,
} from "../../focus/surface.ts"
import { svg } from "../../icons.ts"
import { onRemoved, play, playThen, stop } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { fire, textOf } from "./overlay.ts"
import { spinner } from "./spinner.ts"

const GAP = 8
const open = new WeakMap<Document, Array<HTMLElement>>()

/** Places every open toast of `document` from the bottom up. */
const stack = (document: Document) => {
	const panels = (open.get(document) ?? []).filter((panel) => panel.isConnected)
	open.set(document, panels)
	let offset = 0
	for (const panel of [...panels].reverse()) {
		panel.style.setProperty("--hz-toast-offset", `${offset}px`)
		offset += panel.getBoundingClientRect().height + GAP
	}
}

export const primitive = definePrimitive("toast", ({ document, tag, outer }) => {
	const node = outer("div")
	// At create, not first open: a closed panel's hiding rule must be there before it draws.
	installOverlayStyles(document)
	const panel = makePopoverPanel(part(document, "div", "panel"))
	const busy = spinner(document, "spinner")
	busy.hidden = true
	const body = part(document, "div", "body")
	const title = part(document, "p", "title")
	const description = part(document, "p", "description")
	description.hidden = true
	body.append(title, description)
	const content = part(document, "div", "content")
	const close = part(document, "button", "close")
	close.setAttribute("type", "button")
	close.setAttribute("aria-label", "Dismiss")
	close.innerHTML = svg("close")
	close.addEventListener("click", () => fire(primitive, "dismiss"))
	panel.append(busy, body, content, close)
	node.append(panel)

	const tone = (value: unknown) => {
		const urgent = value === "danger" || value === "warning"
		panel.setAttribute("role", urgent ? "alert" : "status")
		panel.setAttribute("aria-live", urgent ? "assertive" : "polite")
	}
	tone(undefined)

	const schedule = whenConnected(node)
	let wanted = false
	let shown = false
	const leave = () => {
		hidePanel(panel)
		open.set(
			document,
			(open.get(document) ?? []).filter((each) => each !== panel),
		)
		stack(document)
	}
	const present = () => {
		if (wanted === shown) return
		shown = wanted
		if (shown) {
			const inPlace = isSpecimen(node)
			flag(node, "specimen", inPlace)
			flag(node, "open", true)
			stop(panel, "exit")
			showPanel(panel, { modal: false, inPlace })
			void play(panel, "enter")
			if (!inPlace && !(open.get(document) ?? []).includes(panel))
				open.set(document, [...(open.get(document) ?? []), panel])
		} else {
			flag(node, "open", false)
			// It keeps its place in the stack until its exit motion (`toastOut`) ends.
			stop(panel, "enter")
			playThen(panel, "exit", () => {
				if (!shown) leave()
			})
		}
		stack(document)
	}
	// Removed by the view while showing: back in the page for its exit, then gone.
	onRemoved(node, () => {
		if (!shown || node.dataset.specimen !== undefined || document.body === null) return
		shown = false
		wanted = false
		flag(node, "open", false)
		document.body.append(node)
		showPanel(panel, { modal: false, inPlace: false })
		stop(panel, "enter")
		playThen(panel, "exit", () => {
			leave()
			node.remove()
		})
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "open") {
				wanted = value === true
				schedule(present)
			} else if (name === "tone") {
				option(node, "tone", value)
				tone(value)
			} else if (name === "loading") {
				flag(node, "loading", value)
				busy.hidden = value !== true
				if (value === true) panel.setAttribute("aria-busy", "true")
				else panel.removeAttribute("aria-busy")
			} else if (name === "title") title.textContent = textOf(value)
			else if (name === "description") {
				description.textContent = textOf(value)
				description.hidden = description.textContent === ""
			}
			if (shown) stack(document)
		},
		events: undefined,
	}
	return primitive
})
