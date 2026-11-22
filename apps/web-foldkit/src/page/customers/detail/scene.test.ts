// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { receivedSuggestions, EMPTY_SUGGESTIONS } from "../../../customers/suggestions"
import {
	ACCOUNTS,
	ACCOUNTS_BY_KEY,
	type NamedAccount,
	NOW,
	RICH_COMPANY,
} from "../../../lab/fixtures/customers"
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
import { FocusDomainInput } from "./commands"
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
	const openedAs = (role: "owner" | "member") => {
		const as = makeShared({ member: memberWithRole(role) })
		const model = {
			...init(AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: acme.id, tab: Option.none() }), as)
				.model,
			accounts: ACCOUNTS.map((account) => toAccountRow(account.id === acme.id ? noDomain : account)),
		}
		return { as, model }
	}
	const field = Scene.role("textbox", { name: "Company domain" })

	test("an admin with no company domain gets the form", () => {
		const { as, model } = openedAs("owner")
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

	test("an admin changes the domain it has; a member only reads it", () => {
		const withDomain = { ...acme, domains: ["acme.com"], companyProfile: null, companyCheckedAt: null }
		const openedWith = (role: "owner" | "member") => {
			const as = makeShared({ member: memberWithRole(role) })
			const model = {
				...init(
					AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: acme.id, tab: Option.none() }),
					as,
				).model,
				accounts: ACCOUNTS.map((account) =>
					toAccountRow(account.id === acme.id ? withDomain : account),
				),
			}
			return { as, model }
		}
		const change = Scene.role("button", { name: "Change domain acme.com" })
		const admin = openedWith("owner")
		Scene.scene(
			pageScene(update, view, admin.as),
			Scene.given(admin.model),
			menusMounted(4),
			Scene.click(change),
			Scene.Command.resolve(FocusDomainInput, Message.CompletedFocusDomainInput()),
			Scene.expect(field).toExist(),
			Scene.expect(Scene.role("button", { name: "Save" })).toExist(),
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.expect(field).toBeAbsent(),
		)
		const member = openedWith("member")
		Scene.scene(
			pageScene(update, view, member.as),
			Scene.given(member.model),
			menusMounted(4),
			Scene.expect(Scene.text("acme.com")).toExist(),
			Scene.expect(change).toBeAbsent(),
		)
	})

	test("a member is told an admin can add one", () => {
		const { as, model } = openedAs("member")
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(model),
			menusMounted(4),
			Scene.expect(Scene.text("No company domain to look up. An admin can add one.")).toExist(),
			Scene.expect(field).toBeAbsent(),
		)
	})
})

describe("customer page: looking up the company", () => {
	const acme = ACCOUNTS_BY_KEY.acme
	const as = makeShared({ nowMs: NOW.getTime() })
	const openedWith = (account: typeof acme) => ({
		...init(AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: acme.id, tab: Option.none() }), as)
			.model,
		accounts: ACCOUNTS.map((row) => toAccountRow(row.id === acme.id ? account : row)),
	})
	const notLookedUp = { ...acme, domains: ["acme.com"], companyProfile: null, companyCheckedAt: null }
	const skeleton = Scene.selector('[data-lookup-skeleton="true"]')
	const arriving = Scene.selector('[data-arriving="true"]')

	test("while the lookup runs: the button turns at full strength, placeholders hold the profile's place", () => {
		Scene.scene(
			pageScene(update, view, as),
			Scene.given({ ...openedWith(notLookedUp), companyRefreshAtMs: NOW.getTime() }),
			menusMounted(4),
			Scene.expect(Scene.role("button", { name: "Looking up" })).toHaveAttr("data-pending", "true"),
			Scene.expect(Scene.text("Looking up acme.com…")).toExist(),
			Scene.expect(skeleton).toExist(),
		)
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(openedWith(notLookedUp)),
			menusMounted(4),
			Scene.expect(Scene.role("button", { name: "Look up now" })).toExist(),
			Scene.expect(skeleton).toBeAbsent(),
		)
	})

	test("the profile that answers the press blurs in; one already there on open stays still", () => {
		const answered = {
			...acme,
			domains: ["acme.com"],
			companyProfile: RICH_COMPANY,
			companyCheckedAt: new Date(NOW.getTime() + 1_000),
		}
		Scene.scene(
			pageScene(update, view, as),
			Scene.given({
				...openedWith(answered),
				companyRefreshAtMs: NOW.getTime(),
				companyCheckedAtPressMs: null,
			}),
			menusMounted(4),
			Scene.expect(arriving).toExist(),
			Scene.expect(arriving).toHaveClass("blur-in-stagger"),
		)
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(openedWith(answered)),
			menusMounted(4),
			Scene.expect(arriving).toBeAbsent(),
		)
	})

	test("an open domain form sits outside the parts a check remounts", () => {
		const answered = {
			...acme,
			domains: ["acme.com"],
			companyProfile: RICH_COMPANY,
			companyCheckedAt: new Date(NOW.getTime() + 1_000),
		}
		const field = Scene.role("textbox", { name: "Company domain" })
		Scene.scene(
			pageScene(update, view, as),
			Scene.given({
				...openedWith(answered),
				companyRefreshAtMs: NOW.getTime(),
				companyCheckedAtPressMs: null,
			}),
			menusMounted(4),
			Scene.click(Scene.role("button", { name: "Change domain acme.com" })),
			Scene.Command.resolve(FocusDomainInput, Message.CompletedFocusDomainInput()),
			Scene.expect(field).toExist(),
			Scene.expect(arriving).toExist(),
			Scene.inside(arriving, Scene.expect(field).toBeAbsent()),
		)
	})
})
