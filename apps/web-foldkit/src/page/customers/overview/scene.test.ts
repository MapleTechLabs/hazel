// @vitest-environment jsdom
import * as AsyncData from "foldkit/asyncData"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { msOf, toAccountRow, toSignalRow } from "../../../customers/queries"
import {
	ACCOUNTS,
	CONNECTIONS,
	NOW,
	overviewFixture,
	SETTINGS,
	SIGNALS,
} from "../../../lab/fixtures/customers"
import { SUPPORT_REPORT } from "../../../lab/fixtures/issues"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The overview through the view: three numbers, the queue as the main list, the rest folded or compact. */

const shared = makeShared({ nowMs: NOW.getTime() })

const answered = (options: Readonly<{ billing: boolean; signals: boolean }>): Model => ({
	...init(undefined, shared).model,
	range: "30d",
	accounts: ACCOUNTS.map(toAccountRow),
	signals: options.signals ? SIGNALS.map(toSignalRow) : [],
	connectedProviders: CONNECTIONS.map((connection) => connection.provider).filter(
		(provider) => options.billing || (provider !== "stripe" && provider !== "autumn"),
	),
	settings: {
		lastComputedAtMs: SETTINGS.lastComputedAt === null ? null : msOf(SETTINGS.lastComputedAt),
		bands: SETTINGS.health.bands,
		reportingCurrency: SETTINGS.reportingCurrency,
	},
	overview: AsyncData.Success({ data: overviewFixture("30d", { partial: !options.billing }) }),
	support: AsyncData.Success({ data: SUPPORT_REPORT }),
})

const keyNumbers = Scene.role("group", { name: "Key numbers" })
const attention = Scene.role("region", { name: "Needs attention" })

describe("Customers overview", () => {
	test("three numbers lead, each with a definition a keyboard reaches; the other KPIs share a line", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(answered({ billing: true, signals: true })),
			Scene.inside(keyNumbers, Scene.expectAll(Scene.all.role("button")).toHaveCount(3)),
			Scene.expect(Scene.within(keyNumbers, Scene.role("button", { name: "MRR at risk" }))).toExist(),
			Scene.expect(Scene.within(keyNumbers, Scene.text("$48,210"))).toExist(),
			Scene.expect(Scene.role("button", { name: "Logo churn" })).toExist(),
		)
	})

	test("Needs attention lists the top six open signals, each opening its customer", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(answered({ billing: true, signals: true })),
			Scene.inside(attention, Scene.expectAll(Scene.all.role("listitem")).toHaveCount(6)),
			Scene.expect(Scene.within(attention, Scene.text("Acme Robotics"))).toExist(),
			Scene.expect(Scene.within(attention, Scene.role("link", { name: "View queue" }))).toExist(),
		)
	})

	test("with nothing open the queue says all clear", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(answered({ billing: true, signals: false })),
			Scene.expect(Scene.within(attention, Scene.text("All clear: no open signals."))).toExist(),
		)
	})

	test("without billing the revenue numbers become one connect cell, and churn becomes went quiet", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(answered({ billing: false, signals: true })),
			Scene.expect(
				Scene.within(keyNumbers, Scene.text("Connect Stripe or Autumn to see revenue")),
			).toExist(),
			Scene.expect(
				Scene.within(keyNumbers, Scene.role("button", { name: "Active customers" })),
			).toExist(),
			Scene.expect(Scene.role("button", { name: "Logo churn" })).toBeAbsent(),
			Scene.expect(Scene.text("Went quiet")).toExist(),
		)
	})

	test("the charts are folded under one summary", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(answered({ billing: true, signals: true })),
			Scene.expect(Scene.selector("summary")).toHaveText(/Charts and trends/),
			Scene.expect(Scene.selector("details")).not.toHaveAttr("open"),
		)
	})
})
