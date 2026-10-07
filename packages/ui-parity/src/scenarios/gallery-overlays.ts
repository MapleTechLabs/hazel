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

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true })
const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name })
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
	],
}
