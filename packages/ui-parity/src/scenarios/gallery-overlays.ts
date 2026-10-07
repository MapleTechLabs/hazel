import type { Page } from "playwright"
import type { AreaModule, Scenario, ViewportName } from "./types.ts"

/**
 * Overlay primitives on `/dev/gallery/<name>`: menus, dialogs, tooltips, selects, popovers, sheets.
 * Open states come from steps, so each one also exercises the trigger, focus and keyboard behavior.
 */
const overlay = (
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
const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name })
/** React Aria shows hover tooltips only once the last interaction was a pointer press. */
const hoverAfterPointerPress = async (page: Page, name: string) => {
	await page.mouse.click(1200, 800)
	await button(page, name).hover()
}
const focusByTab = async (page: Page, name: string) => {
	for (let presses = 0; presses < 10; presses++) {
		await page.keyboard.press("Tab")
		const focused = await button(page, name).evaluate((element) => element === document.activeElement)
		if (focused) return
	}
	throw new Error(`focusByTab: "${name}" never received focus`)
}

export const galleryOverlaysArea: AreaModule = {
	scenarios: [
		// MENU
		overlay("menu", "menu", "Menu: closed triggers"),
		overlay("menu", "menu-open", "Menu: opened by click", {
			steps: async (page) => {
				await button(page, "Actions").click()
				await page.getByRole("menu").waitFor()
			},
		}),
		overlay("menu", "menu-item-hover", "Menu: hovered item", {
			steps: async (page) => {
				await button(page, "Actions").click()
				await menuItem(page, "Favorite").hover()
			},
		}),
		overlay("menu", "menu-keyboard", "Menu: opened with Enter, second item focused", {
			steps: async (page) => {
				await focusByTab(page, "Actions")
				await page.keyboard.press("Enter")
				await page.getByRole("menu").waitFor()
				await page.keyboard.press("ArrowDown")
			},
		}),
		overlay("menu", "menu-arrow-up", "Menu: opened with ArrowUp, last item focused", {
			steps: async (page) => {
				await focusByTab(page, "Actions")
				await page.keyboard.press("ArrowUp")
				await page.getByRole("menu").waitFor()
			},
		}),
		overlay("menu", "menu-typeahead", "Menu: typeahead moves focus", {
			steps: async (page) => {
				await focusByTab(page, "Actions")
				await page.keyboard.press("ArrowDown")
				await page.getByRole("menu").waitFor()
				await page.keyboard.type("le")
			},
		}),
		overlay("menu", "menu-submenu", "Menu: submenu opened by hover", {
			steps: async (page) => {
				await button(page, "Actions").click()
				await menuItem(page, "Move to section").hover()
				await page.getByRole("menu").nth(1).waitFor()
			},
		}),
		overlay("menu", "menu-submenu-keyboard", "Menu: submenu opened with ArrowRight", {
			steps: async (page) => {
				await focusByTab(page, "Actions")
				await page.keyboard.press("Enter")
				await page.getByRole("menu").waitFor()
				await page.keyboard.press("ArrowDown")
				await page.keyboard.press("ArrowDown")
				await page.keyboard.press("ArrowRight")
				await page.getByRole("menu").nth(1).waitFor()
			},
		}),
		overlay("menu", "menu-escape", "Menu: Escape closes and returns focus", {
			steps: async (page) => {
				await focusByTab(page, "Actions")
				await page.keyboard.press("Enter")
				await page.getByRole("menu").waitFor()
				await page.keyboard.press("Escape")
			},
		}),
		overlay("menu", "menu-outside", "Menu: outside click closes", {
			steps: async (page) => {
				await button(page, "Actions").click()
				await page.getByRole("menu").waitFor()
				await page.mouse.click(1000, 600)
			},
		}),
		overlay("menu", "menu-selection", "Menu: single selection with a checked item", {
			steps: async (page) => {
				await button(page, "Density").click()
				await page.getByRole("menu").waitFor()
			},
		}),
		overlay("menu", "menu-trigger", "Menu: icon trigger, right top placement", {
			steps: async (page) => {
				await button(page, "More").click()
				await page.getByRole("menu").waitFor()
			},
		}),
		// DIALOG
		overlay("dialog", "dialog", "Dialog: closed triggers"),
		overlay("dialog", "dialog-open", "Dialog: opened by click", {
			viewports: both,
			steps: async (page) => {
				await button(page, "Open dialog").click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		overlay("dialog", "dialog-alert", "Dialog: alert dialog opened with the keyboard", {
			viewports: both,
			steps: async (page) => {
				await focusByTab(page, "Delete channel")
				await page.keyboard.press("Enter")
				await page.getByRole("alertdialog").waitFor()
			},
		}),
		overlay("dialog", "dialog-escape", "Dialog: Escape closes and returns focus", {
			steps: async (page) => {
				await focusByTab(page, "Open dialog")
				await page.keyboard.press("Enter")
				await page.getByRole("dialog").waitFor()
				await page.keyboard.press("Escape")
			},
		}),
		overlay("dialog", "dialog-tab", "Dialog: Tab moves focus inside the dialog and wraps", {
			steps: async (page) => {
				await button(page, "Open dialog").click()
				await page.getByRole("dialog").waitFor()
				for (const _ of [1, 2, 3, 4]) await page.keyboard.press("Tab")
			},
		}),
		overlay("dialog", "dialog-outside", "Dialog: backdrop click closes", {
			steps: async (page) => {
				await button(page, "Open dialog").click()
				await page.getByRole("dialog").waitFor()
				await page.mouse.click(20, 880)
			},
		}),
		overlay("dialog", "dialog-close-icon", "Dialog: the close icon closes", {
			steps: async (page) => {
				await button(page, "Open dialog").click()
				await page.getByRole("button", { name: "Close" }).click()
			},
		}),
		// TOOLTIP
		overlay("tooltip", "tooltip", "Tooltip: closed triggers"),
		overlay("tooltip", "tooltip-hover", "Tooltip: shown by hover", {
			steps: async (page) => {
				await hoverAfterPointerPress(page, "Top")
				await page.getByRole("tooltip").waitFor()
			},
		}),
		overlay("tooltip", "tooltip-focus", "Tooltip: shown by keyboard focus", {
			steps: async (page) => {
				await focusByTab(page, "Rename thread")
				await page.getByRole("tooltip").waitFor()
			},
		}),
		overlay("tooltip", "tooltip-bottom", "Tooltip: bottom placement", {
			steps: async (page) => {
				await hoverAfterPointerPress(page, "Bottom")
				await page.getByRole("tooltip").waitFor()
			},
		}),
		overlay("tooltip", "tooltip-right", "Tooltip: right placement", {
			steps: async (page) => {
				await hoverAfterPointerPress(page, "Right")
				await page.getByRole("tooltip").waitFor()
			},
		}),
		overlay("tooltip", "tooltip-inverse", "Tooltip: inverse", {
			steps: async (page) => {
				await hoverAfterPointerPress(page, "Inverse")
				await page.getByRole("tooltip").waitFor()
			},
		}),
		overlay("tooltip", "tooltip-no-arrow", "Tooltip: without an arrow", {
			steps: async (page) => {
				await hoverAfterPointerPress(page, "No arrow")
				await page.getByRole("tooltip").waitFor()
			},
		}),
		// SELECT
		overlay("select", "select", "Select: selected, placeholder and disabled"),
		overlay("select", "select-open", "Select: opened by click on a selected value", {
			steps: async (page) => {
				await page.getByRole("button", { name: /Clear after/ }).click()
				await page.getByRole("listbox").waitFor()
			},
		}),
		overlay("select", "select-keyboard", "Select: opened with ArrowDown, option hovered by keyboard", {
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.press("ArrowDown")
				await page.getByRole("listbox").waitFor()
				await page.keyboard.press("ArrowDown")
			},
		}),
		overlay("select", "select-choose", "Select: choosing an option updates the value", {
			steps: async (page) => {
				await page.getByRole("button", { name: /Reminder/ }).click()
				await page.getByRole("option", { name: "Today" }).click()
			},
		}),
		overlay("select", "select-option-hover", "Select: hovered option", {
			steps: async (page) => {
				await page.getByRole("button", { name: /Reminder/ }).click()
				await page.getByRole("option", { name: "30 minutes" }).hover()
			},
		}),
		// POPOVER
		overlay("popover", "popover", "Popover: closed triggers"),
		overlay("popover", "popover-open", "Popover: opened by click", {
			steps: async (page) => {
				await button(page, "Details").click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		overlay("popover", "popover-arrow", "Popover: arrow, right placement", {
			steps: async (page) => {
				await button(page, "With arrow").click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		// SHEET
		overlay("sheet", "sheet", "Sheet: closed triggers"),
		overlay("sheet", "sheet-open", "Sheet: right, floating", {
			viewports: both,
			steps: async (page) => {
				await button(page, "Open sheet").click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		overlay("sheet", "sheet-left", "Sheet: left, docked", {
			viewports: both,
			steps: async (page) => {
				await button(page, "Open left sheet").click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		// CONTEXT MENU
		overlay("context-menu", "context-menu", "Context menu: closed trigger"),
		overlay("context-menu", "context-menu-open", "Context menu: opened at the pointer", {
			steps: async (page) => {
				await page
					.getByText("Right-click this message")
					.click({ button: "right", position: { x: 60, y: 40 } })
				await page.getByRole("menu").waitFor()
			},
		}),
		overlay("context-menu", "context-menu-hover", "Context menu: hovered danger item", {
			steps: async (page) => {
				await page
					.getByText("Right-click this message")
					.click({ button: "right", position: { x: 60, y: 40 } })
				await menuItem(page, "Delete message").hover()
			},
		}),
		overlay(
			"context-menu",
			"context-menu-keyboard",
			"Context menu: arrow keys are ignored until an item has focus, as in React Aria",
			{
				steps: async (page) => {
					await page
						.getByText("Right-click this message")
						.click({ button: "right", position: { x: 60, y: 40 } })
					await page.getByRole("menu").waitFor()
					await page.keyboard.press("ArrowDown")
					await page.keyboard.press("ArrowDown")
				},
			},
		),
		overlay("context-menu", "context-menu-escape", "Context menu: Escape closes", {
			steps: async (page) => {
				await page
					.getByText("Right-click this message")
					.click({ button: "right", position: { x: 60, y: 40 } })
				await page.getByRole("menu").waitFor()
				await page.keyboard.press("Escape")
			},
		}),
		// COMBO BOX
		overlay("combo-box", "combo-box", "Combo box: empty and selected"),
		overlay("combo-box", "combo-box-type", "Combo box: typing filters and opens the list", {
			steps: async (page) => {
				await page.getByRole("combobox", { name: "Channel" }).fill("de")
				await page.getByRole("listbox").waitFor()
			},
		}),
		overlay(
			"combo-box",
			"combo-box-arrow",
			"Combo box: ArrowDown opens all items and moves the virtual focus",
			{
				steps: async (page) => {
					await page.getByRole("combobox", { name: "Channel" }).focus()
					await page.keyboard.press("ArrowDown")
					await page.getByRole("listbox").waitFor()
					await page.keyboard.press("ArrowDown")
				},
			},
		),
		overlay("combo-box", "combo-box-button", "Combo box: the chevron button shows every item", {
			steps: async (page) => {
				await page.getByRole("button", { name: /Selected/ }).click()
				await page.getByRole("listbox").waitFor()
			},
		}),
		overlay("combo-box", "combo-box-choose", "Combo box: choosing an item fills the input", {
			steps: async (page) => {
				await page.getByRole("combobox", { name: "Channel" }).fill("eng")
				await page.getByRole("option", { name: "Engineering" }).click()
			},
		}),
		overlay("combo-box", "combo-box-hover", "Combo box: hovered option", {
			steps: async (page) => {
				await page.getByRole("combobox", { name: "Channel" }).fill("e")
				await page.getByRole("option", { name: "Design" }).hover()
			},
		}),
		overlay(
			"combo-box",
			"combo-box-escape",
			"Combo box: Escape closes and reverts the text to the selection",
			{
				steps: async (page) => {
					await page.getByRole("combobox", { name: "Channel" }).fill("ra")
					await page.getByRole("listbox").waitFor()
					await page.keyboard.press("Escape")
				},
			},
		),
		// TIMEZONE SELECT
		overlay("timezone-select", "timezone-select", "Timezone select: selected and empty"),
		overlay("timezone-select", "timezone-select-type", "Timezone select: typing filters the zones", {
			steps: async (page) => {
				await page.getByRole("combobox").nth(1).fill("new")
				await page.getByRole("listbox").waitFor()
			},
		}),
		overlay(
			"timezone-select",
			"timezone-select-arrow",
			"Timezone select: ArrowDown opens the list at the selected zone",
			{
				steps: async (page) => {
					await page.getByRole("combobox").first().focus()
					await page.keyboard.press("ArrowDown")
					await page.getByRole("listbox").waitFor()
				},
			},
		),
	],
}
