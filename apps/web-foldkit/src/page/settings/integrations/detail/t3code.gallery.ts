import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../../styles.css"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Runtime } from "foldkit"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { makeShared } from "../../../../test/pages-fixtures"
import { Model as PageModel, T3CodeState, type Model } from "./model"
import type { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/**
 * T3 Code's integration page before a member links their environment, at full width and at the
 * width left beside an open assistant panel (`bun run gallery`): `t3code-<width>-<theme>.png`.
 */

const shared = makeShared()
const inputs = { shared }

const notLinked: Model = {
	...init({
		_tag: "SettingsIntegration",
		orgSlug: "hazel",
		integrationId: "t3code",
		connectionStatus: Option.none(),
		errorCode: Option.none(),
	}).model,
	t3Code: T3CodeState.Loaded({ link: null }),
}

const WIDTHS = { wide: 1180, narrow: 760 } as const

const frame = (h: HtmlBuilder<Message>, width: number, content: Html): Html =>
	h.div(
		[
			h.Id("gallery"),
			h.Style({ width: `${width}px` }),
			h.Class("bg-bg py-8 font-sans text-fg antialiased"),
		],
		[content],
	)

const mount = (width: number) => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model: PageModel,
			init: () => ({ model: notLinked }),
			update: (model: Model, message: Message) => ({ model: update(model, message, shared).model }),
			view: (model: Model, h: HtmlBuilder<Message>) => frame(h, width, view(model, inputs, h)),
			container,
		}),
	)
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const [name, width] of Object.entries(WIDTHS)) {
	for (const theme of ["light", "dark"] as const) {
		test(`t3code ${name} ${theme}`, async () => {
			await page.viewport(1240, 1400)
			if (theme === "dark") document.documentElement.classList.add("dark")
			mount(width)
			await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
			await new Promise((resolve) => setTimeout(resolve, 300))
			await document.fonts.ready
			const gallery = document.getElementById("gallery")
			if (gallery === null) throw new Error("The gallery frame did not render")
			await page.screenshot({ path: `t3code-${name}-${theme}.png`, element: gallery })
		})
	}
}
