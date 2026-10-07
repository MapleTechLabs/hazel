import type { Page } from "playwright"
import type { Scenario, ViewportName } from "./types.ts"

/**
 * Kit follow-ups on `/dev/gallery/<name>`: Toast, ListBox, calendars, Dropdown and friends.
 * Spread into the overlays area, so registering them touches no shared file.
 */
const kit = (
	name: string,
	id: string,
	title: string,
	options: {
		readonly steps?: (page: Page) => Promise<void>
		readonly viewports?: ReadonlyArray<ViewportName>
	} = {},
): Scenario => ({
	id: `gallery-${id}`,
	title,
	area: "gallery",
	path: `/dev/gallery/${name}`,
	themes: ["light", "dark"],
	...options,
})

const both: ReadonlyArray<ViewportName> = ["desktop", "mobile"]

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true })

/** Clicks a gallery button and waits for the toast it raises. */
const raise = async (page: Page, label: string, text: string) => {
	await button(page, label).click()
	await page.getByText(text, { exact: true }).waitFor()
}

const toastKinds: ReadonlyArray<readonly [string, string, string]> = [
	["default", "Default", "Message copied"],
	["success", "Success", "Channel created"],
	["error", "Error", "Couldn't send message"],
	["info", "Info", "You're offline"],
	["warning", "Warning", "Storage almost full"],
	["description", "With description", "Invitation sent"],
	["action", "With action", "Message deleted"],
	["loading", "Loading", "Uploading attachment…"],
	["promise", "Promise", "Changes saved"],
]

const raiseStack = async (page: Page) => {
	await raise(page, "Success", "Channel created")
	await raise(page, "With description", "Invitation sent")
	await raise(page, "Error", "Couldn't send message")
}

export const toastScenarios: ReadonlyArray<Scenario> = [
	kit("toast", "toast", "Toast: triggers, no toast"),
	...toastKinds.map(([id, label, text]) =>
		kit("toast", `toast-${id}`, `Toast: ${label.toLowerCase()}`, {
			steps: (page) => raise(page, label, text),
		}),
	),
	kit("toast", "toast-stacked", "Toast: three toasts collapse into a stack", {
		viewports: both,
		steps: raiseStack,
	}),
	kit("toast", "toast-expanded", "Toast: hovering the stack expands it", {
		viewports: both,
		steps: async (page) => {
			await raiseStack(page)
			await page.getByText("Couldn't send message", { exact: true }).hover()
		},
	}),
	kit("toast", "toast-overflow", "Toast: a fourth toast hides the oldest", {
		steps: async (page) => {
			await raiseStack(page)
			await raise(page, "Info", "You're offline")
		},
	}),
	kit("toast", "toast-action-dismiss", "Toast: the action dismisses its toast", {
		steps: async (page) => {
			await raise(page, "Success", "Channel created")
			await raise(page, "With action", "Message deleted")
			await button(page, "Undo").click()
			await page.getByText("Message deleted", { exact: true }).waitFor({ state: "detached" })
		},
	}),
]

const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true })

/** Tabs until focus lands inside the list box with this label. */
const tabInto = async (page: Page, label: string) => {
	const list = page.getByRole("listbox", { name: label, exact: true })
	for (let presses = 0; presses < 10; presses++) {
		await page.keyboard.press("Tab")
		const inside = await list.evaluate((element) => element.contains(document.activeElement))
		if (inside) return
	}
	throw new Error(`tabInto: "${label}" never received focus`)
}

export const listBoxScenarios: ReadonlyArray<Scenario> = [
	kit("list-box", "list-box", "ListBox: single, multiple with descriptions, sections"),
	kit("list-box", "list-box-hover", "ListBox: hovered option", {
		steps: (page) => option(page, "Dark").hover(),
	}),
	kit("list-box", "list-box-select", "ListBox: clicking selects an option", {
		steps: (page) => option(page, "Light").click(),
	}),
	kit("list-box", "list-box-multiple", "ListBox: clicking toggles in multiple selection", {
		steps: async (page) => {
			await option(page, "Replies").click()
			await option(page, "Reactions").click()
		},
	}),
	kit("list-box", "list-box-keyboard", "ListBox: Tab focuses the selected option, ArrowUp moves", {
		steps: async (page) => {
			await tabInto(page, "Theme")
			await page.keyboard.press("ArrowUp")
		},
	}),
	kit("list-box", "list-box-keyboard-select", "ListBox: Space selects, ArrowDown skips disabled", {
		steps: async (page) => {
			await tabInto(page, "Notify me about")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press(" ")
		},
	}),
	kit("list-box", "list-box-sections-keyboard", "ListBox: arrows cross sections", {
		steps: async (page) => {
			await tabInto(page, "Jump to")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
		},
	}),
	kit("list-box", "list-box-typeahead", "ListBox: typeahead moves focus", {
		steps: async (page) => {
			await tabInto(page, "Jump to")
			await page.keyboard.type("al")
		},
	}),
]

export const dropdownScenarios: ReadonlyArray<Scenario> = [
	kit("dropdown", "dropdown", "Dropdown: items, sections, separator, intents"),
	kit("dropdown", "dropdown-hover", "Dropdown: hovered danger item", {
		steps: (page) => option(page, "Delete").hover(),
	}),
	kit("dropdown", "dropdown-keyboard", "Dropdown: keyboard focus on an item with a shortcut", {
		steps: async (page) => {
			await tabInto(page, "Message actions")
			await page.keyboard.press("ArrowDown")
		},
	}),
]

export const galleryKitScenarios: ReadonlyArray<Scenario> = [
	...toastScenarios,
	...listBoxScenarios,
	...dropdownScenarios,
]
