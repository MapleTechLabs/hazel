import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../styles.css"
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { autocompletePopover } from "./autocomplete-view"
import * as Composer from "./composer"

/**
 * The @-picker in a synced channel: the channel's Hazel members, then the Discord and Slack people
 * who wrote there, with their platform's mark on the avatar (`bun run gallery`: `mention-picker-<theme>.png`).
 */

const userId = (n: number) =>
	Schema.decodeSync(UserId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)

const model: Composer.Model = {
	...Composer.init("composer-gallery"),
	autocomplete: { trigger: "mention", search: "" },
	members: [
		{ userId: userId(1), firstName: "Ada", lastName: "Lovelace", avatarUrl: null, provider: null },
		{ userId: userId(2), firstName: "Grace", lastName: "Hopper", avatarUrl: null, provider: null },
		{ userId: userId(3), firstName: "dana", lastName: "", avatarUrl: null, provider: "discord" },
		{ userId: userId(4), firstName: "sam.k", lastName: "", avatarUrl: null, provider: "discord" },
		{ userId: userId(5), firstName: "Priya Shah", lastName: "", avatarUrl: null, provider: "slack" },
	],
	presence: [
		{ userId: userId(1), status: "online" },
		{ userId: userId(2), status: "away" },
	],
}

const view = (current: Composer.Model, h: HtmlBuilder<Composer.Message>) =>
	h.div(
		[
			h.Id("gallery"),
			h.Class("flex h-[580px] w-[560px] flex-col justify-end bg-bg p-8 font-sans text-fg antialiased"),
		],
		[
			h.div(
				[h.Class("relative rounded-xl border border-border bg-bg px-4 py-3 text-sm")],
				[
					autocompletePopover(h, current, (message) => message),
					h.span([], ["@"]),
					h.span([h.Class("text-muted-fg")], [" Message #jobflow-maple"]),
				],
			),
		],
	)

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const theme of ["light", "dark"] as const) {
	test(`mention picker ${theme}`, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		const container = document.createElement("div")
		container.id = "app"
		document.body.append(container)
		Runtime.run(
			Runtime.makeElement({
				Model: Composer.Model,
				init: () => ({ model }),
				update: (current: Composer.Model) => ({ model: current }),
				view,
				container,
			}),
		)
		await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
		await new Promise((resolve) => setTimeout(resolve, 300))
		await document.fonts.ready
		const element = document.getElementById("gallery")
		if (element === null) throw new Error("gallery did not render")
		await page.screenshot({ path: `mention-picker-${theme}.png`, element })
	})
}
