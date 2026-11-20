import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../styles.css"
import { Runtime } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { MAYA, TEAM } from "../../lab/fixtures/customers"
import { ISSUE_SLAS, ISSUES } from "../../lab/fixtures/issues"
import { NOW } from "../../lab/fixtures/customers"
import * as IssueControl from "./issue-control"

/**
 * The thread panel's issue strip (`issue-control.ts`) in a panel-wide frame under a stand-in thread
 * header, in light and dark (`bun run gallery`): an overdue issue, one on time, a closed one (its
 * first reply met), and "Create issue".
 */

const STATES = ["issue", "on-time", "closed", "create"] as const
type State = (typeof STATES)[number]

const modelOf = (state: State): IssueControl.Model => {
	const index = state === "on-time" ? 2 : state === "closed" ? 6 : 1
	const sample = ISSUES[index]
	if (sample === undefined) throw new Error("The issue fixtures are empty")
	const base = IssueControl.init(sample.rootMessageId)
	const issue =
		state === "create"
			? null
			: {
					...sample,
					assigneeUserId: MAYA.id,
				}
	return {
		...base,
		issue,
		sla: issue === null ? null : (ISSUE_SLAS[index] ?? null),
		hasLoaded: true,
		members: TEAM,
	}
}

const render = (state: State) => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model: IssueControl.Model,
			init: () => ({ model: modelOf(state) }),
			update: (model: IssueControl.Model) => ({ model }),
			view: (model: IssueControl.Model, h: HtmlBuilder<IssueControl.Message>) =>
				h.div(
					[h.Id("gallery"), h.Class("w-[420px] border border-border bg-bg text-fg")],
					[
						h.div(
							[
								h.Class(
									"flex h-12 items-center border-border border-b px-3 font-medium text-sm",
								),
							],
							[`Thread · ${model.issue?.title ?? "Webhook retries flooded our endpoint"}`],
						),
						IssueControl.view(h, {
							model,
							inboxHref: "/lab/customers/inbox",
							currentUserId: MAYA.id,
							nowMs: NOW.getTime(),
							toMessage: (message) => message,
						}),
						h.div([h.Class("h-24 px-3 py-2 text-muted-fg text-sm")], ["Replies"]),
					],
				),
			container,
		}),
	)
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const theme of ["light", "dark"] as const) {
	for (const state of STATES) {
		test(`${state} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			render(state)
			await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
			await new Promise((resolve) => setTimeout(resolve, 200))
			await document.fonts.ready
			const gallery = document.getElementById("gallery")
			if (gallery === null) throw new Error("The issue control did not render")
			await page.screenshot({ path: `thread-issue-${state}-${theme}.png`, element: gallery })
		})
	}
}
