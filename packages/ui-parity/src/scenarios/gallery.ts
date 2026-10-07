import type { AreaModule, Scenario } from "./types.ts"

/**
 * UI kit primitives on `/dev/gallery/<name>` (legacy `src/dev-gallery/entries`, Foldkit
 * `src/gallery/entries`). Interactive states come from steps, so they also exercise behavior.
 */
const gallery = (name: string, scenario: Omit<Scenario, "area" | "path"> & { readonly query?: string }) => ({
	...scenario,
	area: "gallery",
	path: `/dev/gallery/${name}${scenario.query ?? ""}`,
})

export const galleryArea: AreaModule = {
	scenarios: [
		gallery("button", {
			id: "gallery-button",
			title: "Button: intents, sizes, circle",
			themes: ["light", "dark"],
		}),
		gallery("button", {
			id: "gallery-button-hover",
			title: "Button: hovered primary",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "primary", exact: true }).hover()
			},
		}),
		gallery("button", {
			id: "gallery-button-focus-visible",
			title: "Button: keyboard focus ring",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
			},
		}),
		gallery("button", {
			id: "gallery-button-pressed",
			title: "Button: pointer held down on secondary",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "secondary", exact: true }).hover()
				await page.mouse.down()
			},
		}),
		gallery("button", {
			id: "gallery-button-clicked",
			title: "Button: focused by pointer (no ring), pointer moved away",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "outline", exact: true }).click()
				await page.mouse.move(0, 0)
			},
		}),
		gallery("button", {
			id: "gallery-button-keyboard-pressed",
			title: "Button: Space held on the focused button",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.down(" ")
			},
		}),
		gallery("button", {
			id: "gallery-button-pending-hover",
			title: "Button: hovering a pending button shows no hover state",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: /Saving/ }).hover()
			},
		}),
		gallery("link", {
			id: "gallery-link",
			title: "Link: href, no href, disabled",
			themes: ["light", "dark"],
		}),
		gallery("link", {
			id: "gallery-link-hover",
			title: "Link: hovered",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("link", { name: "Documentation" }).hover()
			},
		}),
		gallery("link", {
			id: "gallery-link-focus-visible",
			title: "Link: keyboard focus ring on the second link",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.press("Tab")
			},
		}),
		gallery("link", {
			id: "gallery-link-pressed",
			title: "Link: pointer held on a link without href",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("link", { name: "Pressable text" }).hover()
				await page.mouse.down()
			},
		}),
		gallery("input", {
			id: "gallery-input",
			title: "Input: plain states and groups",
			themes: ["light", "dark"],
		}),
		gallery("input", {
			id: "gallery-input-hover",
			title: "Input: hovered",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("textbox", { name: "Name" }).hover()
			},
		}),
		gallery("input", {
			id: "gallery-input-typed",
			title: "Input: focused by click, text typed",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("textbox", { name: "Name" }).click()
				await page.keyboard.type("Grace Hopper")
				await page.mouse.move(0, 0)
			},
		}),
		gallery("input", {
			id: "gallery-input-invalid-focus",
			title: "Input: invalid input focused by keyboard",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("textbox", { name: "Filled" }).focus()
				await page.keyboard.press("Tab")
			},
		}),
		gallery("text-field", {
			id: "gallery-text-field",
			title: "Text field: label, description, invalid, disabled, required",
			themes: ["light", "dark"],
		}),
		gallery("text-field", {
			id: "gallery-text-field-focus",
			title: "Text field: first field focused by keyboard",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
			},
		}),
		gallery("text-field", {
			id: "gallery-text-field-typed",
			title: "Text field: text typed into the invalid field after clearing it",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("textbox", { name: "Invalid" }).fill("")
				await page.getByRole("textbox", { name: "Invalid" }).pressSequentially("ada@hazel.sh")
			},
		}),
		gallery("text-field", {
			id: "gallery-text-field-label-click",
			title: "Text field: clicking a label focuses its input",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Username", { exact: true }).click()
			},
		}),
		gallery("textarea", { id: "gallery-textarea", title: "Textarea: states", themes: ["light", "dark"] }),
		gallery("textarea", {
			id: "gallery-textarea-typed",
			title: "Textarea: multi-line text grows the field",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("textbox", { name: "Message" }).click()
				await page.keyboard.type("First line")
				await page.keyboard.press("Enter")
				await page.keyboard.type("Second line")
				await page.keyboard.press("Enter")
				await page.keyboard.type("Third line")
			},
		}),
		gallery("textarea", {
			id: "gallery-textarea-hover",
			title: "Textarea: hovered",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("textbox", { name: "Notes" }).hover()
			},
		}),
		gallery("field", {
			id: "gallery-field",
			title: "Field: label, description, errors, fieldset",
			themes: ["light", "dark"],
		}),
		gallery("search-field", {
			id: "gallery-search-field",
			title: "Search field: empty, filled, disabled, labelled",
			themes: ["light", "dark"],
		}),
		gallery("search-field", {
			id: "gallery-search-field-typed",
			title: "Search field: typing reveals the clear button",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("searchbox", { name: "Search messages" }).click()
				await page.keyboard.type("standup")
			},
		}),
		gallery("search-field", {
			id: "gallery-search-field-cleared",
			title: "Search field: clear button empties the field",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "Clear search" }).first().click()
			},
		}),
		gallery("search-field", {
			id: "gallery-search-field-escape",
			title: "Search field: Escape clears the focused field",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("searchbox", { name: "Search channels" }).focus()
				await page.keyboard.press("Escape")
			},
		}),
		gallery("search-field", {
			id: "gallery-search-field-clear-hover",
			title: "Search field: hovered clear button",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "Clear search" }).first().hover()
			},
		}),
		gallery("checkbox", {
			id: "gallery-checkbox",
			title: "Checkbox: states, description, groups",
			themes: ["light", "dark"],
		}),
		gallery("checkbox", {
			id: "gallery-checkbox-clicked",
			title: "Checkbox: clicking checks it (no focus ring)",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Unchecked", { exact: true }).click()
				await page.getByText("Reactions", { exact: true }).click()
				await page.mouse.move(0, 0)
			},
		}),
		gallery("checkbox", {
			id: "gallery-checkbox-keyboard",
			title: "Checkbox: Tab then Space checks the first box with a focus ring",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.press(" ")
			},
		}),
		gallery("checkbox", {
			id: "gallery-checkbox-hover",
			title: "Checkbox: hovered",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Invalid", { exact: true }).hover()
			},
		}),
		gallery("radio", {
			id: "gallery-radio",
			title: "Radio: groups and states",
			themes: ["light", "dark"],
		}),
		gallery("radio", {
			id: "gallery-radio-clicked",
			title: "Radio: clicking selects an option",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Compact", { exact: true }).click()
				await page.getByText("Dark", { exact: true }).click()
				await page.mouse.move(0, 0)
			},
		}),
		gallery("radio", {
			id: "gallery-radio-keyboard",
			title: "Radio: Tab focuses the selected option, ArrowDown moves the selection",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.press("ArrowDown")
			},
		}),
		gallery("radio", {
			id: "gallery-radio-hover",
			title: "Radio: hovered",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Spacious", { exact: true }).hover()
			},
		}),
		gallery("switch", {
			id: "gallery-switch",
			title: "Switch: off, on, disabled, description",
			themes: ["light", "dark"],
		}),
		gallery("switch", {
			id: "gallery-switch-clicked",
			title: "Switch: clicking turns it on",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Off", { exact: true }).click()
				await page.mouse.move(0, 0)
			},
		}),
		gallery("switch", {
			id: "gallery-switch-keyboard",
			title: "Switch: Tab then Space toggles with a focus ring",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.press("Tab")
				await page.keyboard.press(" ")
			},
		}),
		gallery("switch", {
			id: "gallery-switch-hover",
			title: "Switch: hovered",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Desktop notifications", { exact: true }).hover()
			},
		}),
		gallery("slider", {
			id: "gallery-slider",
			title: "Slider: single, range, disabled, vertical",
			themes: ["light", "dark"],
		}),
		gallery("slider", {
			id: "gallery-slider-keyboard",
			title: "Slider: Tab to the thumb, ArrowRight three times",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.press("ArrowRight")
				await page.keyboard.press("ArrowRight")
				await page.keyboard.press("ArrowRight")
			},
		}),
		gallery("slider", {
			id: "gallery-slider-range-keyboard",
			title: "Slider: range thumb sent to its bound with End, then PageDown",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("slider", { name: "Price range" }).focus()
				await page.keyboard.press("End")
				await page.keyboard.press("PageDown")
			},
		}),
		gallery("slider", {
			id: "gallery-slider-hover",
			title: "Slider: hovered thumb",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("slider", { name: "Volume" }).hover({ force: true })
			},
		}),
		gallery("slider", {
			id: "gallery-slider-track-press",
			title: "Slider: pressing the track at 75% moves the thumb there and focuses it",
			themes: ["light", "dark"],
			steps: async (page) => {
				const group = await page.getByRole("group", { name: "Volume" }).boundingBox()
				const thumb = await page.getByRole("slider", { name: "Volume" }).boundingBox()
				if (!group || !thumb) throw new Error("slider not laid out")
				await page.mouse.click(group.x + group.width * 0.75, thumb.y + thumb.height / 2)
			},
		}),
		gallery("slider", {
			id: "gallery-slider-dragging",
			title: "Slider: thumb mid-drag from 40% to 62%",
			themes: ["light", "dark"],
			steps: async (page) => {
				const group = await page.getByRole("group", { name: "Volume" }).boundingBox()
				const thumb = await page.getByRole("slider", { name: "Volume" }).boundingBox()
				if (!group || !thumb) throw new Error("slider not laid out")
				const y = thumb.y + thumb.height / 2
				await page.mouse.move(group.x + group.width * 0.4, y)
				await page.mouse.down()
				await page.mouse.move(group.x + group.width * 0.62, y, { steps: 5 })
			},
		}),
		gallery("field-validation-state", {
			id: "gallery-field-validation-state",
			title: "Field validation state: idle, validating, valid, invalid",
			themes: ["light", "dark"],
		}),
		gallery("form-error-summary", {
			id: "gallery-form-error-summary",
			title: "Form error summary: default and custom titles, empty",
			themes: ["light", "dark"],
		}),
	],
}
