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

/** A calendar day cell; React Aria names them "Thursday, March 12, 2026" (with "Today, " etc.). */
const day = (page: Page, date: string) => page.getByRole("button", { name: new RegExp(`\\b${date}\\b`) })

/** Tabs until a calendar day cell has focus. */
const tabToDay = async (page: Page, date: string) => {
	for (let presses = 0; presses < 15; presses++) {
		await page.keyboard.press("Tab")
		const focused = await day(page, date)
			.first()
			.evaluate((element) => element === document.activeElement)
		if (focused) return
	}
	throw new Error(`tabToDay: "${date}" never received focus`)
}

const eventDate = (page: Page) => page.getByRole("application", { name: /^Event date/ })

export const calendarScenarios: ReadonlyArray<Scenario> = [
	kit("calendar", "calendar", "Calendar: selected date, today marker, minimum date"),
	kit("calendar", "calendar-hover", "Calendar: hovered day", {
		steps: (page) => day(page, "March 20, 2026").first().hover(),
	}),
	kit("calendar", "calendar-select", "Calendar: clicking a day selects it", {
		steps: (page) => day(page, "March 25, 2026").first().click(),
	}),
	kit("calendar", "calendar-keyboard", "Calendar: Tab focuses the selected day, arrows move", {
		steps: async (page) => {
			await tabToDay(page, "March 18, 2026")
			await page.keyboard.press("ArrowRight")
			await page.keyboard.press("ArrowDown")
		},
	}),
	kit("calendar", "calendar-keyboard-month", "Calendar: arrows cross into the next month, Enter selects", {
		steps: async (page) => {
			await tabToDay(page, "March 18, 2026")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("Enter")
		},
	}),
	kit("calendar", "calendar-next", "Calendar: the next button shows the next month", {
		steps: async (page) => {
			await eventDate(page).getByRole("button", { name: "Next", exact: true }).first().click()
			await page.getByRole("application", { name: "Event date, April 2026" }).waitFor()
		},
	}),
]

export const rangeCalendarScenarios: ReadonlyArray<Scenario> = [
	kit("range-calendar", "range-calendar", "RangeCalendar: selected range"),
	kit("range-calendar", "range-calendar-anchor", "RangeCalendar: first click anchors, hover highlights", {
		steps: async (page) => {
			await day(page, "March 16, 2026").click()
			await day(page, "March 20, 2026").hover()
		},
	}),
	kit("range-calendar", "range-calendar-select", "RangeCalendar: two clicks select a new range", {
		steps: async (page) => {
			await day(page, "March 16, 2026").click()
			await day(page, "March 19, 2026").click()
		},
	}),
	kit("range-calendar", "range-calendar-hover", "RangeCalendar: hovered day inside the range", {
		steps: (page) => day(page, "March 10, 2026").hover(),
	}),
]

export const datePickerScenarios: ReadonlyArray<Scenario> = [
	kit("date-picker", "date-picker", "DatePicker: with a value, labelled and empty"),
	kit("date-picker", "date-picker-open", "DatePicker: the calendar button opens the calendar", {
		steps: async (page) => {
			await page
				.getByRole("button", { name: /^Calendar/ })
				.first()
				.click()
			await page.getByRole("dialog").waitFor()
		},
	}),
	kit("date-picker", "date-picker-choose", "DatePicker: choosing a day fills the field and closes", {
		steps: async (page) => {
			await page
				.getByRole("button", { name: /^Calendar/ })
				.first()
				.click()
			await page.getByRole("dialog").waitFor()
			await day(page, "March 24, 2026").click()
			await page.getByRole("dialog").waitFor({ state: "detached" })
		},
	}),
]

const checkbox = (page: Page, name: string) => page.getByRole("checkbox", { name, exact: true })

export const tableSelectionScenarios: ReadonlyArray<Scenario> = [
	kit("table-selection", "table-selection", "Table: checkbox selection, one selected, one disabled"),
	kit("table-selection", "table-selection-row", "Table: clicking a row toggles it", {
		steps: (page) => page.getByRole("row", { name: /Alan Turing/ }).click(),
	}),
	kit("table-selection", "table-selection-all", "Table: the header checkbox selects every row", {
		steps: (page) => checkbox(page, "Select All").click({ force: true }),
	}),
	kit("table-selection", "table-selection-hover", "Table: hovered selectable row", {
		steps: (page) => page.getByRole("row", { name: /Ada Lovelace/ }).hover(),
	}),
	kit("table-selection", "table-selection-keyboard", "Table: Space toggles the focused row", {
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press(" ")
		},
	}),
]

export const galleryKitScenarios: ReadonlyArray<Scenario> = [
	...tableSelectionScenarios,
	...calendarScenarios,
	...rangeCalendarScenarios,
	...datePickerScenarios,
	...toastScenarios,
	...listBoxScenarios,
	...dropdownScenarios,
]
