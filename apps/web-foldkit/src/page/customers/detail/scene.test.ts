// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { ACCOUNTS, ACCOUNTS_BY_KEY, type NamedAccount } from "../../../lab/fixtures/customers"
import { AppRoute } from "../../../route"
import { makeShared, memberWithRole, pageScene } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { init, update } from "./update"
import { view } from "./view"

/** The customer page through its view: a grouped account's environment menu beside its name. */

const shared = makeShared({ member: memberWithRole("member") })
const opened = (key: NamedAccount) => ({
	...init(
		AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: ACCOUNTS_BY_KEY[key].id, tab: Option.none() }),
		shared,
	).model,
	accounts: ACCOUNTS.map(toAccountRow),
})
/** The rendered menus' triggers. */
const menusMounted = (count: number) =>
	Scene.Mount.resolveAll(
		...Array.from(
			{ length: count },
			() => [FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()] as const,
		),
	)
const switcher = (name: string) => Scene.role("button", { name: `Environment: ${name}` })

describe("customer page: environments", () => {
	test("a grouped account switches environments from beside its name", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(opened("acmeEu")),
			menusMounted(4),
			Scene.expect(switcher("EU")).toExist(),
		)
	})

	test("an unnamed primary still offers its environments; a standalone account has no menu", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(opened("halcyon")),
			menusMounted(4),
			Scene.expect(switcher("unnamed")).toExist(),
		)
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(opened("kestrel")),
			menusMounted(3),
			Scene.expect(Scene.role("button", { name: /^Environment/ })).toBeAbsent(),
		)
	})
})
