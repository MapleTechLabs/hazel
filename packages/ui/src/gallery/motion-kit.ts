/**
 * The kit side of the motion comparison (`scripts/test-motion.ts`): today's overlay and count classes,
 * from the app's own `*.styles.ts` and compiled by its Tailwind, put in the page the way the kit's
 * views do (a panel mounting runs its `@starting-style` transition; a toast drops `data-closed`).
 */
import { menuPopoverBase } from "../../../../apps/web-foldkit/src/core/components/ui/menu.styles.ts"
import {
	modalBackdropClassName,
	modalContentBase,
	modalLayoutClassName,
} from "../../../../apps/web-foldkit/src/core/components/ui/modal.styles.ts"
import { popoverContentBase } from "../../../../apps/web-foldkit/src/core/components/ui/popover.styles.ts"
import {
	toastEntryClassName,
	toastStyles,
} from "../../../../apps/web-foldkit/src/core/components/ui/toast.styles.ts"
import { tooltipStyles } from "../../../../apps/web-foldkit/src/core/components/ui/tooltip.styles.ts"
import type { MotionPage, MotionRunners } from "./motion-cases.ts"
import { applyTheme } from "./page.ts"

applyTheme()
const stage = document.getElementById("stage") ?? document.body

const element = (tag: string, className: string, text?: string) => {
	const node = document.createElement(tag)
	node.className = className
	if (text !== undefined) node.textContent = text
	return node
}
const at = (node: HTMLElement, left: number, top: number) => {
	node.style.position = "absolute"
	node.style.left = `${left}px`
	node.style.top = `${top}px`
	return node
}
const flush = (node: Element) => void getComputedStyle(node).opacity

let toastEntry: HTMLElement | undefined
let count: HTMLElement | undefined

/** Today's reaction count (`chat/message/tooltips.ts` `countView`): a keyed span that rolls. */
const roll = (motion: "up" | "down") => {
	const box = count ?? element("span", "inline-flex overflow-hidden tabular-nums")
	if (count === undefined) stage.append(at(box, 40, 40))
	count = box
	const value = element(
		"span",
		`inline-block ${motion === "up" ? "animate-count-up" : "animate-count-down"}`,
	)
	value.textContent = motion === "up" ? "4" : "3"
	box.replaceChildren(value)
	return value
}

const cases: MotionRunners = {
	menu: async () => {
		const panel = element("div", [...popoverContentBase, menuPopoverBase].join(" "))
		panel.append(element("div", "p-1", "Copy link"), element("div", "p-1", "Pin channel"))
		stage.append(at(panel, 40, 40))
		return panel
	},
	popover: async () => {
		const panel = element("div", popoverContentBase.join(" "))
		panel.append(element("div", "p-3", "Anchor"))
		stage.append(at(panel, 40, 40))
		return panel
	},
	dialog: async () => {
		const backdrop = element("div", modalBackdropClassName)
		const layout = element("div", modalLayoutClassName("md"))
		const panel = element("div", modalContentBase("md").join(" "))
		panel.append(element("div", "p-6", "Create a channel"))
		layout.append(panel)
		stage.append(backdrop, layout)
		return panel
	},
	tooltip: async () => {
		const bubble = element("div", tooltipStyles({ side: "top" }), "Copy link")
		stage.append(at(bubble, 40, 40))
		return bubble
	},
	toast: async () => {
		const pin = element("div", "")
		pin.style.cssText = "position: fixed; right: 16px; bottom: 16px;"
		const entry = element("div", toastEntryClassName)
		entry.setAttribute("data-closed", "")
		entry.setAttribute("data-enter", "")
		entry.append(element("div", toastStyles().card(), "Message sent"))
		pin.append(entry)
		stage.append(pin)
		flush(entry)
		entry.removeAttribute("data-closed")
		toastEntry = entry
		return entry
	},
	toastExit: async () => {
		const entry = toastEntry ?? (await cases.toast())
		if (entry === null) return null
		for (const animation of document.getAnimations()) animation.finish()
		entry.removeAttribute("data-enter")
		entry.setAttribute("data-leave", "")
		flush(entry)
		entry.setAttribute("data-closed", "")
		return entry
	},
	countUp: async () => roll("up"),
	countDown: async () => roll("down"),
}

const page: MotionPage = {
	start: async (name) => {
		const target = await cases[name]()
		if (target === null) throw new Error(`${name}: nothing moved`)
		target.dataset.motionTarget = ""
	},
}
window.__motion = page
document.documentElement.dataset.ready = ""
