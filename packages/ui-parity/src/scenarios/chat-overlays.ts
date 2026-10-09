import type { Page } from "playwright"
import { richChat } from "../fixtures/datasets/rich.ts"
import { seedEmojiPicker } from "../fixtures/datasets/rich/emoji.ts"
import type { Scenario } from "./types.ts"

/**
 * Overlays anchored to a message: toolbar menus, context menu, pickers, tooltips, popovers and the
 * delete dialog. All on the `rich` dataset's #launch unless noted.
 */

const overlay = (scenario: Omit<Scenario, "area" | "dataset" | "path"> & { path?: string }): Scenario => ({
	area: "chat",
	dataset: "rich",
	...scenario,
	path: scenario.path ?? richChat("launch"),
})

/** Moves the pointer off the message list so no hover toolbar lingers in the capture. */
export const parkMouse = (page: Page) => page.mouse.move(0, 0)

const LAUNCH_WINDOW = "Launch window confirmed"
const CHECKLIST = "Launch checklist: please claim your items"

const hoverToolbar = async (page: Page, text: string) => {
	await page.getByText(text).hover()
	await page.getByRole("toolbar", { name: "Message actions" }).waitFor()
}

/**
 * React Aria opens tooltips on hover only once the interaction modality is "pointer", so click a
 * neutral element (the channel heading) first.
 */
const hoverForTooltip = async (page: Page, target: ReturnType<Page["getByRole"]>) => {
	await page.getByRole("heading", { level: 2 }).first().click()
	await target.hover()
	await page.getByRole("tooltip").waitFor()
}

export const chatOverlayScenarios: ReadonlyArray<Scenario> = [
	overlay({
		id: "chat-message-context-menu",
		title: "Message context menu (right click)",
		themes: ["light", "dark"],
		steps: async (page) => {
			await page.getByText(LAUNCH_WINDOW).click({ button: "right" })
			await page.getByRole("menu").waitFor()
		},
	}),
	overlay({
		id: "chat-message-more-actions",
		title: "Message toolbar overflow menu",
		steps: async (page) => {
			await hoverToolbar(page, CHECKLIST)
			await page.getByRole("button", { name: "More actions" }).click()
			await page.getByRole("menu").waitFor()
		},
	}),
	overlay({
		id: "chat-emoji-picker",
		title: "Reaction emoji picker with custom emojis",
		themes: ["light", "dark"],
		steps: async (page) => {
			await seedEmojiPicker(page)
			await hoverToolbar(page, LAUNCH_WINDOW)
			await page.getByRole("button", { name: "Add reaction" }).click()
			await page.getByRole("dialog", { name: "Emoji picker" }).waitFor()
		},
	}),
	overlay({
		id: "chat-emoji-picker-reopen",
		title: "Reaction emoji picker reopened after Escape (focus back on the trigger)",
		steps: async (page) => {
			await seedEmojiPicker(page)
			await hoverToolbar(page, LAUNCH_WINDOW)
			const picker = page.getByRole("dialog", { name: "Emoji picker" })
			await page.getByRole("button", { name: "Add reaction" }).click()
			await picker.waitFor()
			await page.keyboard.press("Escape")
			await picker.waitFor({ state: "hidden" })
			await page.getByRole("button", { name: "Add reaction" }).click()
			await picker.waitFor()
		},
	}),
	overlay({
		id: "chat-reaction-tooltip",
		title: "Reaction tooltip listing who reacted",
		steps: async (page) => {
			await hoverForTooltip(page, page.getByRole("button", { name: "👍 2" }))
		},
	}),
	overlay({
		id: "chat-custom-emoji-reaction-tooltip",
		title: "Custom emoji reaction tooltip",
		steps: async (page) => {
			await hoverForTooltip(page, page.getByRole("button", { name: "custom:shipit 2" }))
		},
	}),
	overlay({
		id: "chat-user-profile-popover",
		title: "User profile popover from a message avatar",
		themes: ["light", "dark"],
		steps: async (page) => {
			// Avatars with an image are named by their alt text; generated avatars are unnamed.
			await page.getByRole("button", { name: "Katherine Johnson" }).last().click()
			await page.getByRole("dialog").waitFor()
		},
	}),
	overlay({
		id: "chat-bot-profile-popover",
		title: "Bot profile popover",
		path: richChat("github"),
		steps: async (page) => {
			await page.getByRole("button", { name: "GitHub" }).last().click()
			await page.getByRole("dialog").waitFor()
		},
	}),
	overlay({
		id: "chat-delete-message-modal",
		title: "Delete message confirmation",
		steps: async (page) => {
			await hoverToolbar(page, CHECKLIST)
			await page.getByRole("button", { name: "Delete message" }).click()
			await page.getByRole("dialog").waitFor()
		},
	}),
	overlay({
		id: "chat-reply-indicator",
		title: "Replying to a message: indicator above the composer",
		steps: async (page) => {
			await hoverToolbar(page, LAUNCH_WINDOW)
			await page.getByRole("button", { name: "Reply", exact: true }).click()
			await parkMouse(page)
		},
	}),
]
