import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../styles.css"
import { Runtime } from "foldkit"
import { afterEach, expect, test } from "vitest"
import { page, userEvent } from "vitest/browser"
import { SECTIONS } from "./kit/chrome"
import { program } from "./kit/program"

/**
 * The kit page (`/lab/kit`) in a real runtime, screenshotted section by section in light and dark,
 * then with each overlay opened by a real press (`bun run gallery src/lab/kit.gallery.ts`). Writes
 * `__screenshots__/kit/<theme>-<name>.png` beside this file (ignored by git).
 */

const boot = () => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(Runtime.makeElement({ ...program, container }))
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 350))

const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""

const pathOf = (theme: string, name: string) => `__screenshots__/kit/${label}${theme}-${name}.png`

/**
 * The viewport as it is now: a page screenshot is the whole document, so an overlay is captured
 * through a fixed, see-through frame the size of the window.
 */
const shootViewport = async (theme: string, name: string) => {
	const frame = document.createElement("div")
	frame.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
	document.body.append(frame)
	await page.screenshot({ path: pathOf(theme, name), element: frame })
	frame.remove()
}

/** Presses a button by name inside one section (or a dialog): names repeat across the page. */
const pressButton = async (name: string, within = "#overlays") => {
	const scope = document.querySelector<HTMLElement>(within)
	if (scope === null) throw new Error(`Nothing matches ${within}`)
	const target = page.elementLocator(scope).getByRole("button", { name, exact: true })
	await target.element().scrollIntoView({ block: "center" })
	await userEvent.click(target)
	await settle()
}

for (const theme of ["light", "dark"] as const) {
	test(`sections ${theme}`, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		// Taller than any section, and the header out of the way, so each one is captured whole.
		await page.viewport(1440, 3200)
		boot()
		await expect.poll(() => document.getElementById("display")).toBeTruthy()
		document.querySelector("header")?.classList.replace("sticky", "static")
		await document.fonts.ready
		await settle()
		for (const section of SECTIONS) {
			const element = document.getElementById(section.id)
			if (element === null) throw new Error(`The ${section.id} section did not render`)
			await page.screenshot({ path: pathOf(theme, section.id), element })
		}
	})

	test(`overlays ${theme}`, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(1440, 900)
		boot()
		await expect.poll(() => document.getElementById("display")).toBeTruthy()
		await document.fonts.ready

		await pressButton("Channel")
		await expect.poll(() => document.querySelector("[role=menu]")).toBeTruthy()
		await userEvent.hover(page.getByRole("menuitem", { name: "Copy link" }))
		await settle()
		await shootViewport(theme, "menu")
		await userEvent.keyboard("{Escape}")
		await settle()

		await pressButton("Notifications")
		await expect.poll(() => document.querySelector("[role=dialog]")).toBeTruthy()
		await shootViewport(theme, "popover")
		await userEvent.keyboard("{Escape}")
		await settle()

		await pressButton("Open modal")
		await expect.poll(() => document.querySelector("dialog[open]")).toBeTruthy()
		await shootViewport(theme, "modal")
		await userEvent.keyboard("{Escape}")
		await settle()

		await pressButton("Open alert")
		await expect.poll(() => document.querySelector("dialog[open]")).toBeTruthy()
		await shootViewport(theme, "alert")
		await pressButton("Keep it", "dialog[open]")

		await pressButton("Open sheet")
		await expect.poll(() => document.querySelector("dialog[open]")).toBeTruthy()
		await shootViewport(theme, "sheet")
		await userEvent.keyboard("{Escape}")
		await settle()

		await pressButton("Open command menu ⌘ K")
		await expect.poll(() => document.getElementById("kit-command-search")).toBeTruthy()
		await userEvent.keyboard("{ArrowDown}")
		await settle()
		await shootViewport(theme, "command")
		await userEvent.keyboard("{Escape}")
		await settle()

		await pressButton("Success", "#feedback")
		await pressButton("Error", "#feedback")
		await pressButton("With an action", "#feedback")
		await shootViewport(theme, "toasts")
	})
}
