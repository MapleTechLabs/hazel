// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow, toSignalRow } from "../../../customers/queries"
import { ACCOUNTS, ACCOUNTS_BY_KEY, SIGNALS } from "../../../lab/fixtures/customers"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { DEFAULT_FILTERS } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The queue through the view: a signal's customer is the primary, its environments a hint. */

const shared = makeShared({ nowMs: Date.UTC(2026, 10, 10, 12) })
const { acme } = ACCOUNTS_BY_KEY

describe("Needs attention: customers with environments", () => {
	test("a signal on a primary says how many environments its customer has", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({
				...init().model,
				filters: { ...DEFAULT_FILTERS, owner: "anyone" },
				accounts: ACCOUNTS.map(toAccountRow),
				signals: SIGNALS.filter((signal) => signal.accountId === acme.id).map(toSignalRow),
			}),
			// The menus' triggers.
			Scene.Mount.resolveAll(
				[FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()],
				[FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()],
			),
			Scene.expect(Scene.text(/· \+1 environment$/)).toExist(),
		)
	})
})
