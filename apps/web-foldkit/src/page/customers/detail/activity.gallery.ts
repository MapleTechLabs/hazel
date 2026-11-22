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
import { ACME_DETAIL, NOW, TEAM } from "../../../lab/fixtures/customers"
import { AppRoute } from "../../../route"
import { makeShared } from "../../../test/pages-fixtures"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/**
 * The Activity tab's year calendar: a busy account, a quiet one, still loading, and at phone width,
 * hovering a day. Not a test: `bun run gallery` writes `activity-*.png` beside this file.
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

type State = "busy" | "quiet" | "loading"

/** A deterministic year: weekdays busier than weekends, a ramp up, a quiet August. */
const yearOf = (state: State) =>
	Array.from({ length: 365 }, (_, index) => {
		const ms = NOW_MS - (364 - index) * DAY
		const date = new Date(ms)
		const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
		const noise = (Math.sin(index * 12.9898) * 43_758.5453) % 1
		const base = state === "quiet" ? (noise > 0.85 ? 1 : 0) : Math.round(2 + (index / 365) * 14)
		const value =
			state === "quiet"
				? base
				: date.getUTCMonth() === 7 || noise < -0.6
					? 0
					: Math.max(0, Math.round(base * (weekend ? 0.2 : 1) * (0.6 + Math.abs(noise))))
		return { day: date.toISOString().slice(0, 10), value }
	})

const modelFor = (state: State, isMobile: boolean) => {
	const shared = { ...makeShared({ nowMs: NOW_MS }), isMobile }
	const account = ACME_DETAIL.account
	const opened = init(
		AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: account.id, tab: Option.some("activity") }),
		shared,
	).model
	const steps: ReadonlyArray<Message> = [
		Message.SucceededFetchDetail({ accountId: account.id, detail: ACME_DETAIL }),
		...(state === "loading"
			? []
			: [
					Message.SucceededFetchYearActivity({
						accountId: account.id,
						series: [
							{
								metricKey: "active_users",
								name: "Active users",
								unit: null,
								points: yearOf(state),
								limit: null,
							},
						],
					}),
					Message.HoveredYearDay({ index: 330 }),
				]),
	]
	const model = steps.reduce((current, message) => update(current, message, shared).model, {
		...opened,
		accounts: [toAccountRow(account)],
		members: TEAM,
	} as Model)
	return { model, shared }
}

const screen = (state: State, isMobile: boolean) => (h: HtmlBuilder<Message>) => {
	const { model, shared } = modelFor(state, isMobile)
	return h.div(
		[
			h.Id("gallery"),
			h.Class(
				isMobile
					? "h-[900px] w-[390px] bg-bg font-sans text-fg antialiased"
					: "h-[700px] w-[1180px] bg-bg font-sans text-fg antialiased",
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
	await page.viewport(mobile ? 390 : 1180, mobile ? 900 : 700)
	render(screen(state, mobile))
	await document.fonts.ready
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The gallery did not render")
	await page.screenshot({ path: `activity-${name}.png`, element: gallery })
}

test("busy light", () => shoot("busy-light", "busy"))
test("busy dark", () => shoot("busy-dark", "busy", { dark: true }))
test("quiet", () => shoot("quiet-light", "quiet"))
test("loading", () => shoot("loading-light", "loading"))
test("mobile", () => shoot("busy-mobile", "busy", { mobile: true }))
