import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { Option } from "effect"
import { Runtime } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { msOf, toAccountRow, toSignalRow } from "../../../customers/queries"
import {
	ACCOUNTS,
	ACCOUNTS_BY_KEY,
	CONNECTIONS,
	NOW,
	overviewFixture,
	SETTINGS,
	SIGNALS,
} from "../../../lab/fixtures/customers"
import { EMPTY_SUPPORT_REPORT, ISSUE_SLAS, ISSUES, SUPPORT_REPORT } from "../../../lab/fixtures/issues"
import { AppRoute } from "../../../route"
import { labShared } from "../lab-shared"
import type { Message as DetailMessage } from "../detail/message"
import { Model as DetailModelSchema, type Model as DetailModel } from "../detail/model"
import { supportCard } from "../detail/overview-tab"
import { init as detailInit } from "../detail/update"
import type { Message as OverviewMessage } from "../overview/message"
import { Model as OverviewModel } from "../overview/model"
import { init as overviewInit, update as overviewUpdate } from "../overview/update"
import { view as overviewView } from "../overview/view"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/**
 * The support SLA screens (`bun run gallery`), light and dark: the Support report populated, empty,
 * failed and loading (desktop and phone), the Customers overview's support tiles, and the customer
 * page's Support block. Writes `support-<screen>-<theme>.png`.
 */

const frame = <M>(h: HtmlBuilder<M>, width: number, content: Html): Html =>
	h.div(
		[
			h.Id("gallery"),
			h.Attribute("style", `width: ${width}px`),
			h.Class("bg-bg font-sans text-fg antialiased"),
		],
		[content],
	)

const container = () => {
	const element = document.createElement("div")
	element.id = "app"
	document.body.append(element)
	return element
}

// REPORT

const report = (data: AsyncData.AsyncData<typeof SUPPORT_REPORT, "Offline"> | "loading"): Model => ({
	...init(undefined, labShared).model,
	report: data === "loading" ? AsyncData.Loading() : data,
	hoveredDay: data === "loading" ? null : 22,
})

const reportScreen = (model: Model, width: number) =>
	Runtime.run(
		Runtime.makeElement({
			Model,
			init: () => ({ model }),
			update: (current: Model, message: Message) => ({
				model: update(current, message, labShared).model,
			}),
			view: (current: Model, h: HtmlBuilder<Message>) =>
				frame(h, width, view(current, { shared: labShared }, h)),
			container: container(),
		}),
	)

const REPORTS: ReadonlyArray<readonly [string, Model]> = [
	["report", report(AsyncData.Success({ data: SUPPORT_REPORT }))],
	["report-within", { ...report(AsyncData.Success({ data: SUPPORT_REPORT })), chart: "within" }],
	["report-empty", report(AsyncData.Success({ data: EMPTY_SUPPORT_REPORT }))],
	["report-error", report(AsyncData.Failure({ error: "Offline" }))],
	["report-loading", report("loading")],
]

// OVERVIEW

const overviewModel = (): OverviewModel => ({
	...overviewInit(undefined, labShared).model,
	overview: AsyncData.Success({ data: overviewFixture("30d") }),
	support: AsyncData.Success({ data: SUPPORT_REPORT }),
	accounts: ACCOUNTS.map(toAccountRow),
	signals: SIGNALS.map(toSignalRow),
	connectedProviders: CONNECTIONS.map((connection) => connection.provider),
	settings: {
		lastComputedAtMs: SETTINGS.lastComputedAt === null ? null : msOf(SETTINGS.lastComputedAt),
		bands: SETTINGS.health.bands,
		reportingCurrency: SETTINGS.reportingCurrency,
	},
})

/** The top of the page: the KPI row and the support tiles under it. */
const overviewScreen = (model: OverviewModel, width: number) =>
	Runtime.run(
		Runtime.makeElement({
			Model: OverviewModel,
			init: () => ({ model }),
			update: (current: OverviewModel, message: OverviewMessage) => ({
				model: overviewUpdate(current, message, labShared).model,
			}),
			view: (current: OverviewModel, h: HtmlBuilder<OverviewMessage>) =>
				frame(
					h,
					width,
					h.div(
						[h.Class(width < 768 ? "h-[1100px] overflow-hidden" : "h-[480px] overflow-hidden")],
						[overviewView(current, { shared: labShared }, h)],
					),
				),
			container: container(),
		}),
	)

// CUSTOMER

const kestrel = ACCOUNTS_BY_KEY.kestrel

const customerModel = (): DetailModel => {
	const started = detailInit(
		AppRoute.CustomerDetail({ orgSlug: "lab", accountId: kestrel.id, tab: Option.none() }),
		labShared,
	).model
	return {
		...started,
		supportIssues: ISSUES.filter((issue) => issue.accountId === kestrel.id),
		supportSlas: ISSUE_SLAS.filter((sla) => sla.accountId === kestrel.id),
		support: AsyncData.Success({
			data: SUPPORT_REPORT.byAccount.find((row) => row.key === kestrel.id) ?? null,
		}),
	}
}

const customerScreen = (width: number) =>
	Runtime.run(
		Runtime.makeElement({
			Model: DetailModelSchema,
			init: () => ({ model: customerModel() }),
			update: (current: DetailModel) => ({ model: current }),
			view: (current: DetailModel, h: HtmlBuilder<DetailMessage>) =>
				frame(
					h,
					width,
					h.div(
						[h.Class("p-6")],
						[
							supportCard(h, current, {
								orgSlug: "lab",
								nowMs: NOW.getTime(),
								userId: null,
								account: toAccountRow(kestrel),
								detail: null,
								membersById: new Map(),
								isAdmin: false,
							}),
						],
					),
				),
			container: container(),
		}),
	)

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const shoot = async (name: string, width: number) => {
	await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
	await new Promise((resolve) => setTimeout(resolve, 250))
	await document.fonts.ready
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The gallery did not render")
	expect(gallery.scrollWidth).toBeLessThanOrEqual(width)
	await page.screenshot({ path: `support-${name}.png`, element: gallery })
}

for (const theme of ["light", "dark"] as const) {
	const dark = () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
	}
	for (const [name, model] of REPORTS) {
		test(`${name} ${theme}`, async () => {
			dark()
			await page.viewport(1280, 2400)
			reportScreen(model, 1280)
			await shoot(`${name}-${theme}`, 1280)
		})
	}
	for (const name of ["report", "report-empty"] as const) {
		test(`${name} mobile ${theme}`, async () => {
			dark()
			await page.viewport(390, 3000)
			reportScreen(REPORTS.find(([key]) => key === name)?.[1] ?? report("loading"), 390)
			await shoot(`${name}-${theme}-mobile`, 390)
		})
	}
	test(`overview tiles ${theme}`, async () => {
		dark()
		await page.viewport(1280, 900)
		overviewScreen(overviewModel(), 1280)
		await shoot(`overview-${theme}`, 1280)
	})
	test(`overview tiles mobile ${theme}`, async () => {
		dark()
		await page.viewport(390, 900)
		overviewScreen(overviewModel(), 390)
		await shoot(`overview-${theme}-mobile`, 390)
	})
	test(`customer block ${theme}`, async () => {
		dark()
		await page.viewport(900, 400)
		customerScreen(820)
		await shoot(`customer-${theme}`, 820)
	})
}
