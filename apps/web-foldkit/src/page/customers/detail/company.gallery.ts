import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import type * as Customers from "@hazel/domain/customers"
import { Context as EffectContext, Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import { toAccountRow } from "../../../customers/queries"
import { ACME_DETAIL, NOW, RICH_COMPANY, TEAM } from "../../../lab/fixtures/customers"
import { AppRoute } from "../../../route"
import { makeShared } from "../../../test/pages-fixtures"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/**
 * The customer page with its enriched company (`docs/customers/enrichment.md`): a rich profile, a
 * sparse one, a domain context.dev does not know, one never looked up, and a lookup on its way, in
 * light and dark and at phone width. Not a test: `bun run gallery` writes `company-*.png` beside
 * this file.
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

const NOW_MS = NOW.getTime()
const DAY = 86_400_000

type State = "rich" | "sparse" | "not-found" | "not-checked" | "pending"

const accountFor = (state: State): Customers.Account => {
	const base = ACME_DETAIL.account
	switch (state) {
		case "rich":
			return { ...base, companyProfile: { ...RICH_COMPANY, domain: "acmerobotics.io" } }
		case "sparse":
			return base
		case "not-found":
			return { ...base, companyProfile: null, companyCheckedAt: new Date(NOW_MS - 3 * DAY) }
		case "not-checked":
		case "pending":
			return { ...base, companyProfile: null, companyCheckedAt: null }
	}
}

const modelFor = (
	state: State,
	isMobile: boolean,
): { model: Model; shared: ReturnType<typeof makeShared> } => {
	const shared = { ...makeShared({ nowMs: NOW_MS }), isMobile }
	const account = accountFor(state)
	const opened = init(
		AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: account.id, tab: Option.none() }),
		shared,
	).model
	const loaded = update(
		{ ...opened, accounts: [toAccountRow(account)], members: TEAM },
		Message.SucceededFetchDetail({ accountId: account.id, detail: { ...ACME_DETAIL, account } }),
		shared,
	).model
	return {
		model: state === "pending" ? { ...loaded, companyRefreshAtMs: NOW_MS - 5_000 } : loaded,
		shared,
	}
}

const screen = (state: State, isMobile: boolean) => (h: HtmlBuilder<Message>) => {
	const { model, shared } = modelFor(state, isMobile)
	return h.div(
		[
			h.Id("gallery"),
			h.Class(
				isMobile
					? "h-[1500px] w-[390px] bg-bg font-sans text-fg antialiased"
					: "h-[900px] w-[1180px] bg-bg font-sans text-fg antialiased",
			),
		],
		[
			h.submodel({
				slotId: "customer",
				model,
				view,
				viewInputs: { shared },
				toParentMessage: (message: Message) => message,
			}),
		],
	)
}

const shoot = async (name: string, state: State, options: { dark?: boolean; mobile?: boolean } = {}) => {
	if (options.dark === true) document.documentElement.classList.add("dark")
	const mobile = options.mobile === true
	await page.viewport(mobile ? 390 : 1180, mobile ? 1500 : 900)
	render(screen(state, mobile))
	await document.fonts.ready
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The gallery did not render")
	await page.screenshot({ path: `company-${name}.png`, element: gallery })
}

test("rich light", () => shoot("rich-light", "rich"))
test("rich dark", () => shoot("rich-dark", "rich", { dark: true }))
test("sparse light", () => shoot("sparse-light", "sparse"))
test("not found", () => shoot("not-found-light", "not-found"))
test("not checked", () => shoot("not-checked-light", "not-checked"))
test("pending", () => shoot("pending-light", "pending"))
test("mobile", () => shoot("rich-mobile", "rich", { mobile: true }))
