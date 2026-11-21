import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { Context as EffectContext, Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import { toAccountRow } from "../../../customers/queries"
import { ACCOUNTS, NOW } from "../../../lab/fixtures/customers"
import { AppRoute } from "../../../route"
import { makeShared } from "../../../test/pages-fixtures"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/**
 * The customer list with the enriched company columns (`docs/customers/enrichment.md`), sorted by
 * company size, and filtered to two industries, in light and dark. Not a test: `bun run gallery`
 * writes `company-*.png` beside this file.
 */

const render = (content: (h: HtmlBuilder<Message>) => Html) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		EffectContext.make(Dispatch, dispatch).pipe(
			EffectContext.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = content(__htmlBuilder<Message>())
		const container = document.createElement("div")
		document.body.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const shared = makeShared({ nowMs: NOW.getTime() })

const modelWith = (messages: ReadonlyArray<Message>): Model =>
	[
		Message.UpdatedViews({ views: [] }),
		Message.UpdatedAccounts({ accounts: ACCOUNTS.map(toAccountRow) }),
		...(["industry", "company_size", "headquarters", "funding"] as const).map((column) =>
			Message.ToggledColumn({ column, isShown: true }),
		),
		...messages,
	].reduce(
		(model, message) => update(model, message, shared).model,
		init(AppRoute.CustomersList({ orgSlug: "hazel", view: Option.some("all") })).model,
	)

const screen = (model: Model) => (h: HtmlBuilder<Message>) =>
	h.div(
		[h.Id("gallery"), h.Class("h-[820px] w-[2000px] bg-bg font-sans text-fg antialiased")],
		[
			h.submodel({
				slotId: "list",
				model,
				view,
				viewInputs: { shared },
				toParentMessage: (message: Message) => message,
			}),
		],
	)

const shoot = async (name: string, model: Model, isDark = false) => {
	if (isDark) document.documentElement.classList.add("dark")
	await page.viewport(2000, 820)
	render(screen(model))
	await document.fonts.ready
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The gallery did not render")
	await page.screenshot({ path: `company-${name}.png`, element: gallery })
}

const bySize = [Message.ClickedSortHeader({ column: "company_size" })]
const filtered = [
	Message.PressedEditFilter({ field: "industry" }),
	Message.ChangedPendingFilters({ filters: { industries: ["Finance", "Healthcare"] } }),
	Message.AppliedFilter(),
]

test("sorted by size, light", () => shoot("by-size-light", modelWith(bySize)))
test("sorted by size, dark", () => shoot("by-size-dark", modelWith(bySize), true))
test("filtered by industry", () => shoot("filtered-light", modelWith(filtered)))
