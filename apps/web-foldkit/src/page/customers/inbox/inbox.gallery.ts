import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { Runtime } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { INBOX_STATES, inboxStateModel } from "../../../lab/entries/customers/pages/inbox"
import { labShared } from "../lab-shared"
import type { Message } from "./message"
import { Model } from "./model"
import { update } from "./update"
import { view } from "./view"

/**
 * The Support inbox, the real page view over the lab fixtures, screenshotted per state in light and
 * dark, and on a phone (`bun run gallery`). Writes `inbox-<state>-<theme>[-mobile].png`.
 */

/** Mounts the page in a real runtime (its menus are submodels), its update live. */
const render = (state: (typeof INBOX_STATES)[number]) => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model,
			init: () => ({ model: inboxStateModel(state) }),
			update: (model: Model, message: Message) => ({ model: update(model, message, labShared).model }),
			view: (model: Model, h: HtmlBuilder<Message>) =>
				h.div(
					[h.Id("gallery"), h.Class("h-[900px] bg-bg text-fg max-md:h-[1300px]")],
					[view(model, { shared: labShared }, h)],
				),
			container,
		}),
	)
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const shoot = async (name: string) => {
	await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
	await new Promise((resolve) => setTimeout(resolve, 300))
	await document.fonts.ready
	const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The inbox did not render")
	await page.screenshot({ path: `${label}${name}.png`, element: gallery })
}

const SHOWN = ["open", "selected", "filtered", "overdue", "on-hold", "closed", "inbox-zero", "empty"] as const

for (const theme of ["light", "dark"] as const) {
	for (const state of SHOWN) {
		test(`${state} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			await page.viewport(1280, 900)
			render(state)
			await shoot(`inbox-${state}-${theme}`)
		})
	}
	// Rows fit their list (it clips), and the title keeps room to read, at desktop widths.
	for (const width of [1280, 1024] as const) {
		for (const state of ["open", "selected"] as const) {
			test(`${state} ${width} ${theme}`, async () => {
				if (theme === "dark") document.documentElement.classList.add("dark")
				await page.viewport(width, 900)
				render(state)
				await expect.poll(() => document.querySelectorAll("[role=row]").length).toBeGreaterThan(1)
				await document.fonts.ready
				for (const row of document.querySelectorAll<HTMLElement>("[role=row]"))
					expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
				// The selected row's inline actions take more room (they hide below lg).
				for (const cell of document.querySelectorAll<HTMLElement>(
					"[role=row] > [role=cell]:nth-child(2)",
				))
					expect(cell.getBoundingClientRect().width).toBeGreaterThan(
						state === "selected" ? 140 : 200,
					)
				await shoot(`inbox-${state}-${theme}-${width}`)
			})
		}
	}
	test(`mobile ${theme}`, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(390, 1300)
		render("open")
		await shoot(`inbox-open-${theme}-mobile`)
	})
	test(`mobile selected ${theme}`, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(390, 1300)
		render("selected")
		await shoot(`inbox-selected-${theme}-mobile`)
	})
}
