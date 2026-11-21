// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { ACCOUNTS, ACCOUNTS_BY_KEY } from "../../../lab/fixtures/customers"
import { AppRoute } from "../../../route"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { LetModifierClicksThrough } from "./commands"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The customers list through its view: the enriched company columns. */

const shared = makeShared()

/** All customers, one row each for a rich profile, a sparse one and none, with the company columns. */
const withCompanyColumns = (): Model => {
	const keys = ["northwind", "acme", "kestrel"] as const
	const accounts = ACCOUNTS.filter((account) => keys.some((key) => ACCOUNTS_BY_KEY[key].id === account.id))
	const loaded = [
		Message.UpdatedViews({ views: [] }),
		Message.UpdatedAccounts({ accounts: accounts.map(toAccountRow) }),
		...(["industry", "company_size", "headquarters", "funding"] as const).map((column) =>
			Message.ToggledColumn({ column, isShown: true }),
		),
	]
	return loaded.reduce(
		(model, message) => update(model, message, shared).model,
		init(AppRoute.CustomersList({ orgSlug: "hazel", view: Option.some("all") })).model,
	)
}

const row = (name: string) => Scene.role("row", { name: new RegExp(name) })

describe("customers list: company columns", () => {
	test("the picked company columns show the profile; an account without one shows dashes", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(withCompanyColumns()),
			Scene.Mount.resolveAll(
				[FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()],
				[FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()],
				[LetModifierClicksThrough, Message.CompletedLetModifierClicksThrough()],
			),
			Scene.expect(Scene.role("columnheader", { name: /Industry/ })).toExist(),
			Scene.expect(Scene.role("columnheader", { name: /Size/ })).toExist(),
			Scene.expect(Scene.role("columnheader", { name: /HQ/ })).toExist(),
			Scene.expect(Scene.role("columnheader", { name: /Funding/ })).toExist(),
			Scene.expect(row("Northwind")).toContainText("Technology"),
			Scene.expect(row("Northwind")).toContainText("201–500"),
			Scene.expect(row("Northwind")).toContainText("🇩🇪Berlin"),
			Scene.expect(row("Northwind")).toContainText("Series B"),
			Scene.expect(row("Acme Robotics")).toContainText("Manufacturing"),
			Scene.expect(row("Acme Robotics")).toContainText("1–10"),
			Scene.expect(row("Acme Robotics")).toContainText("🇵🇹Lisbon"),
			// Looked up, no company found: every company cell is a dash.
			Scene.expect(row("Kestrel")).toContainText("——"),
		)
	})
})
