/**
 * `hz:tooltip` on the web (lane A3): its children are the trigger; `label` shows above it after a
 * hover delay, at once on keyboard focus, and hides on leave, blur, a press or Escape. The trigger's
 * control is described by it (`aria-describedby`). Only one shows per document, as the app's
 * tooltip host keeps one (`apps/web-foldkit/src/chat/tooltip-host.ts`). In a gallery frame it shows.
 */
import { tabbables } from "../../focus/focusable.ts"
import { measureNode } from "../../focus/measure.ts"
import { applyPlacement } from "../../focus/position.ts"
import {
	hidePanel,
	installOverlayStyles,
	isSpecimen,
	makePopoverPanel,
	showPanel,
	whenConnected,
} from "../../focus/surface.ts"
import { play } from "../../motion.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"
import { nextId, textOf } from "./overlay.ts"

const DELAY_MS = 600
const showing = new WeakMap<Document, () => void>()

export const primitive = definePrimitive("tooltip", ({ document, tag, outer }) => {
	const node = outer("span")
	const content = part(document, "span", "content")
	// At create, not first open: a closed panel's hiding rule must be there before it draws.
	installOverlayStyles(document)
	const bubble = makePopoverPanel(part(document, "span", "bubble"))
	bubble.setAttribute("role", "tooltip")
	bubble.id = nextId("tooltip")
	node.append(content, bubble)
	let label = ""
	let timer: ReturnType<typeof setTimeout> | undefined
	let inPlace = false

	const control = (): Element | null => tabbables(content)[0] ?? content.firstElementChild
	const describe = () => {
		const target = control()
		if (target === null) return
		if (label === "") target.removeAttribute("aria-describedby")
		else target.setAttribute("aria-describedby", bubble.id)
	}
	const hide = () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = undefined
		if (inPlace) return
		hidePanel(bubble)
		if (showing.get(document) === hide) showing.delete(document)
	}
	const show = () => {
		timer = undefined
		if (label === "") return
		showing.get(document)?.()
		const wasOpen = bubble.dataset.open !== undefined
		showPanel(bubble, { modal: false, inPlace })
		if (!wasOpen) void play(bubble, "enter")
		showing.set(document, hide)
		if (!inPlace) applyPlacement(bubble, measureNode(content), { side: "top", align: "center", gap: 6 })
	}
	const later = () => {
		if (timer === undefined && bubble.dataset.open === undefined) timer = setTimeout(show, DELAY_MS)
	}

	content.addEventListener("pointerenter", (event) => {
		if (event.pointerType !== "touch") later()
	})
	content.addEventListener("pointerleave", hide)
	content.addEventListener("pointerdown", hide)
	content.addEventListener("focusin", (event) => {
		const target = event.target
		if (target instanceof Element && target.matches(":focus-visible")) show()
	})
	content.addEventListener("focusout", hide)
	content.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && bubble.dataset.open !== undefined) {
			event.preventDefault()
			hide()
		}
	})
	whenConnected(node)(() => {
		describe()
		inPlace = isSpecimen(node)
		if (inPlace) {
			node.dataset.specimen = ""
			show()
		}
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name !== "label") return
			label = textOf(value)
			bubble.textContent = label
			describe()
			if (label === "") hide()
		},
		events: undefined,
	}
	return primitive
})

/**
 * A tooltip a leaf draws for one of its own controls (the message toolbar, a reaction pill): the
 * `tooltip` recipe's bubble in the top layer above `trigger`, after `delay`, one per document.
 */
export const attachTip = (
	document: Document,
	trigger: HTMLElement,
	content: () => ReadonlyArray<Node | string>,
	options: { readonly delay: number; readonly look?: string },
): HTMLElement => {
	installOverlayStyles(document)
	const host = document.createElement("span")
	host.dataset.hz = "tooltip"
	const bubble = makePopoverPanel(part(document, "span", "bubble"))
	bubble.setAttribute("role", "tooltip")
	bubble.id = nextId("tooltip")
	if (options.look !== undefined) bubble.dataset.look = options.look
	host.append(bubble)
	trigger.setAttribute("aria-describedby", bubble.id)
	let timer: ReturnType<typeof setTimeout> | undefined
	const hide = () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = undefined
		if (bubble.dataset.open === undefined) return
		hidePanel(bubble)
		if (showing.get(document) === hide) showing.delete(document)
	}
	const show = () => {
		timer = undefined
		if (!trigger.isConnected) return
		showing.get(document)?.()
		bubble.replaceChildren(...content())
		showPanel(bubble, { modal: false, inPlace: false })
		void play(bubble, "enter")
		showing.set(document, hide)
		applyPlacement(bubble, measureNode(trigger), { side: "top", align: "center", gap: 6 })
	}
	trigger.addEventListener("pointerenter", (event) => {
		if (event.pointerType !== "touch" && timer === undefined) timer = setTimeout(show, options.delay)
	})
	trigger.addEventListener("pointerleave", hide)
	trigger.addEventListener("pointerdown", hide)
	trigger.addEventListener("focus", () => {
		if (trigger.matches(":focus-visible")) show()
	})
	trigger.addEventListener("blur", hide)
	trigger.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && bubble.dataset.open !== undefined) hide()
	})
	return host
}
