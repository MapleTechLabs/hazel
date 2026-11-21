// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { receivedSuggestions, EMPTY_SUGGESTIONS } from "../../../customers/suggestions"
import { ACCOUNTS, ACCOUNTS_BY_KEY, ACME_DETAIL, type NamedAccount } from "../../../lab/fixtures/customers"
import {
	LONG_SUGGESTION,
	STRONG_SUGGESTION,
	SUGGESTION_CHANNEL_OPTIONS,
	UNSEEN_SUGGESTION,
	WORKSPACE_SUGGESTION,
} from "../../../lab/fixtures/customers-suggestions"
import { AppRoute } from "../../../route"
import { makeShared, memberWithRole, pageScene } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { Message } from "./message"
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

describe("customer page: suggested channel links", () => {
	const acme = ACCOUNTS_BY_KEY.acme
	const withSuggestions = (items: ReadonlyArray<typeof STRONG_SUGGESTION>) => ({
		...opened("acme"),
		channelOptions: SUGGESTION_CHANNEL_OPTIONS,
		suggestionsFor: acme.id,
		suggestions: receivedSuggestions(EMPTY_SUGGESTIONS, items),
	})
	const asAcme = (row: typeof STRONG_SUGGESTION) => ({ ...row, accountId: acme.id, accountName: acme.name })
	const suggested = Scene.role("list", { name: "Suggested channels" })

	test("the Channels section lists the customer's suggestions with their reason, Link and dismiss", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(
				withSuggestions([STRONG_SUGGESTION, asAcme(WORKSPACE_SUGGESTION), asAcme(UNSEEN_SUGGESTION)]),
			),
			menusMounted(4),
			Scene.expect(suggested).toExist(),
			Scene.expect(Scene.within(suggested, Scene.text("acme-shared"))).toExist(),
			Scene.expect(Scene.within(suggested, Scene.text("Strong match"))).toExist(),
			Scene.expect(
				Scene.text("3 of 4 external members have @acmerobotics.io, Acme Robotics's domain"),
			).toExist(),
			Scene.expect(Scene.role("button", { name: "Link acme-shared to Acme Robotics" })).toExist(),
			Scene.expect(
				Scene.role("button", { name: "Dismiss: nw-integration is not Acme Robotics" }),
			).toExist(),
			// A channel the user does not see locally is left out.
			Scene.expect(Scene.within(suggested, Scene.text("hidden"))).toBeAbsent(),
		)
	})

	test("no suggestions: the group is hidden; another customer's never show here", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(withSuggestions([LONG_SUGGESTION])),
			menusMounted(4),
			Scene.expect(suggested).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Link channel" })).toExist(),
		)
	})
})

describe("customer page: adding a company domain", () => {
	const acme = ACCOUNTS_BY_KEY.acme
	const noDomain = { ...acme, domains: [], companyProfile: null, companyCheckedAt: null }
	const openedAs = (role: "owner" | "member", detailLoaded: boolean) => {
		const as = makeShared({ member: memberWithRole(role) })
		const model = {
			...init(AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: acme.id, tab: Option.none() }), as)
				.model,
			accounts: ACCOUNTS.map((account) => toAccountRow(account.id === acme.id ? noDomain : account)),
		}
		return {
			as,
			model: detailLoaded
				? update(
						model,
						Message.SucceededFetchDetail({
							accountId: acme.id,
							detail: { ...ACME_DETAIL, account: noDomain },
						}),
						as,
					).model
				: model,
		}
	}
	const field = Scene.role("textbox", { name: "Company domain" })

	test("an admin with no company domain gets the form once the detail loads", () => {
		const { as, model } = openedAs("owner", true)
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(model),
			menusMounted(4),
			Scene.expect(
				Scene.text("Add the customer's website domain and Hazel looks up their company."),
			).toExist(),
			Scene.expect(field).toExist(),
			Scene.expect(Scene.role("button", { name: "Add" })).toExist(),
		)
	})

	test("before the detail loads an admin is not offered a form it cannot show", () => {
		const { as, model } = openedAs("owner", false)
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(model),
			menusMounted(4),
			Scene.expect(Scene.text("No company domain to look up.")).toExist(),
			Scene.expect(field).toBeAbsent(),
		)
	})

	test("a member is told an admin can add one", () => {
		const { as, model } = openedAs("member", true)
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(model),
			menusMounted(4),
			Scene.expect(Scene.text("No company domain to look up. An admin can add one.")).toExist(),
			Scene.expect(field).toBeAbsent(),
		)
	})
})
