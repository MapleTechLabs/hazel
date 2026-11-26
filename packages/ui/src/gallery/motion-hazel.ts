// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The hazel side of the motion comparison (`scripts/test-motion.ts`): each case shows one primitive on
 * the real web renderer and returns the element that moves. The kit side is `motion-kit.ts`.
 */
import { create } from "../web/primitives.ts"
import type { Plain } from "../web/primitives/define.ts"
import { applyTheme } from "./page.ts"
import type { MotionPage, MotionRunners } from "./motion-cases.ts"

applyTheme()
const stage = document.getElementById("stage") ?? document.body

const mount = (tag: string, props: Readonly<Record<string, Plain>>) => {
	const primitive = create(document, `hz:${tag}`)
	if (primitive === undefined) throw new Error(`no hz:${tag}`)
	stage.append(primitive.outer)
	for (const [name, value] of Object.entries(props)) primitive.set(name, value)
	return primitive
}

const panelOf = (outer: HTMLElement) => outer.querySelector<HTMLElement>(':scope > [data-hz-part="panel"]')
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

let toast: ReturnType<typeof mount> | undefined
let item: ReturnType<typeof mount> | undefined

const cases: MotionRunners = {
	menu: async () => {
		const menu = mount("menu", {
			label: "Channel options",
			entries: [
				{
					entries: [
						{ id: "copy", label: "Copy link" },
						{ id: "pin", label: "Pin channel" },
					],
				},
			],
		})
		await settle()
		menu.outer.querySelector<HTMLElement>('[data-hz-part="button"]')?.click()
		await Promise.resolve()
		return panelOf(menu.outer)
	},
	popover: async () => {
		const popover = mount("popover", {})
		const anchor = document.createElement("button")
		anchor.textContent = "Anchor"
		popover.content.append(anchor)
		popover.set("open", true)
		await Promise.resolve()
		return panelOf(popover.outer)
	},
	dialog: async () => {
		const dialog = mount("dialog", { title: "Create a channel", description: "Channels hold a topic." })
		dialog.set("open", true)
		await Promise.resolve()
		return panelOf(dialog.outer)
	},
	tooltip: async () => {
		const tooltip = mount("tooltip", { label: "Copy link" })
		const button = document.createElement("button")
		button.textContent = "Trigger"
		tooltip.content.append(button)
		await settle()
		button.focus({ focusVisible: true } as FocusOptions)
		return tooltip.outer.querySelector<HTMLElement>('[data-hz-part="bubble"]')
	},
	toast: async () => {
		toast = mount("toast", { title: "Message sent", tone: "success" })
		toast.set("open", true)
		await Promise.resolve()
		return panelOf(toast.outer)
	},
	toastExit: async () => {
		const shown = toast ?? mount("toast", { title: "Message sent", tone: "success", open: true })
		await settle()
		for (const animation of document.getAnimations()) animation.finish()
		shown.set("open", false)
		await Promise.resolve()
		return panelOf(shown.outer)
	},
	countUp: async () => {
		item = item ?? mount("item", { title: "design", badge: 3 })
		await settle()
		item.set("badge", 4)
		return item.outer.querySelector<HTMLElement>('[data-hz-part="count"]')
	},
	countDown: async () => {
		item = item ?? mount("item", { title: "design", badge: 4 })
		await settle()
		item.set("badge", 3)
		return item.outer.querySelector<HTMLElement>('[data-hz-part="count"]')
	},
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
