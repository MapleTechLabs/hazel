// @vitest-environment jsdom
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { receivedSuggestions, EMPTY_SUGGESTIONS } from "../../../customers/suggestions"
import {
	ACCOUNTS,
	ACCOUNTS_BY_KEY,
	ACME_DETAIL,
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
import { AppRoute, customerRoute, hrefOf } from "../../../route"
import { makeShared, memberWithRole, pageScene } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import * as Popover from "../../../ui/popover"
import { CopyCustomerText, FocusDomainInput } from "./commands"
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
	const arriving = Scene.selector("[data-arriving]")

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
			// The facts continue the sequence after the description, the figures and the domain row.
			Scene.expect(Scene.selector('[data-arriving="summary"]')).toHaveStyle("--stagger-start", "0ms"),
			Scene.expect(Scene.selector('[data-arriving="facts"]')).toHaveStyle("--stagger-start", "120ms"),
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

describe("customer page: copying identifiers", () => {
	const acme = ACCOUNTS_BY_KEY.acme
	const as = makeShared({ nowMs: NOW.getTime() })
	const withDetail = {
		...init(AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: acme.id, tab: Option.none() }), as)
			.model,
		accounts: ACCOUNTS.map(toAccountRow),
		detail: AsyncData.Success({
			data: { ...ACME_DETAIL, account: { ...ACME_DETAIL.account, attributes: { slug: "/acme" } } },
		}),
	}

	test("a linked record's ID and an attribute copy verbatim, even one that looks like a path", () => {
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(withDetail),
			menusMounted(4),
			Scene.click(Scene.role("button", { name: "Copy Clerk organization ID" })),
			Scene.Command.expectExact(
				CopyCustomerText({
					text: "org_2acmeRobotics",
					label: "Clerk organization ID",
					isPath: false,
				}),
			),
			Scene.Command.resolve(
				CopyCustomerText,
				Message.CompletedCopy({ label: "Clerk organization ID", isCopied: true }),
			),
			Scene.click(Scene.role("button", { name: "Copy Slug" })),
			Scene.Command.expectExact(CopyCustomerText({ text: "/acme", label: "Slug", isPath: false })),
			Scene.Command.resolve(CopyCustomerText, Message.CompletedCopy({ label: "Slug", isCopied: true })),
		)
	})
})

describe("customer page: a user's other customers", () => {
	const acme = ACCOUNTS_BY_KEY.acme
	const northwind = ACCOUNTS_BY_KEY.northwind
	const kestrel = ACCOUNTS_BY_KEY.kestrel
	const as = makeShared({ nowMs: NOW.getTime() })
	const other = (account: typeof northwind, role: string) => ({
		accountId: account.id,
		name: account.name,
		logoUrl: null,
		environment: null,
		lifecycleStage: account.lifecycleStage,
		role,
		lastSeenAt: new Date(NOW.getTime() - 2 * 86_400_000),
	})
	const [row] = ACME_DETAIL.contactsToReach
	const withUsers = update(
		{
			...init(
				AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: acme.id, tab: Option.some("users") }),
				as,
			).model,
			accounts: ACCOUNTS.map(toAccountRow),
			detail: AsyncData.Success({ data: ACME_DETAIL }),
		},
		Message.SucceededFetchContacts({
			accountId: acme.id,
			page: {
				items: [{ ...row, otherAccounts: [other(northwind, "Admin"), other(kestrel, "Member")] }],
				nextCursor: null,
			},
		}),
		as,
	).model

	test("a user's email copies from its row, at either table width", () => {
		const email = row.contact.email ?? ""
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(withUsers),
			menusMounted(3),
			// One beside the Email column, one in the subtitle that replaces it on a narrow table.
			Scene.expectAll(Scene.all.role("button", { name: `Copy ${email}` })).toHaveCount(2),
			Scene.click(Scene.selector(`.max-w-56 button[aria-label="Copy ${email}"]`)),
			Scene.Command.expectExact(CopyCustomerText({ text: email, label: "Email", isPath: false })),
			Scene.Command.resolve(
				CopyCustomerText,
				Message.CompletedCopy({ label: "Email", isCopied: true }),
			),
		)
	})

	test("the row names the first one; pressing it lists each with role and a link to its users", () => {
		const northwindLink = Scene.role("link", { name: /Northwind Labs/ })
		Scene.scene(
			pageScene(update, view, as),
			Scene.given(withUsers),
			menusMounted(3),
			Scene.expect(Scene.role("button", { name: /is also in 2 other customers/ })).toHaveText(
				/Also in Northwind Labs\s*\+1/,
			),
			Scene.click(Scene.role("button", { name: /is also in 2 other customers/ })),
			Scene.Mount.resolve(
				Popover.PortalPopoverBackdrop,
				Popover.Message.CompletedPortalPopoverBackdrop(),
			),
			Scene.Mount.resolve(Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()),
			Scene.expect(northwindLink).toHaveAttr(
				"href",
				hrefOf(customerRoute("hazel", northwind.id, "users")),
			),
			Scene.expect(northwindLink).toContainText("Admin"),
			Scene.expect(Scene.role("link", { name: /Kestrel Systems/ })).toContainText("Member"),
			Scene.click(northwindLink),
			Scene.Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
			Scene.Mount.expectEnded(Popover.PortalPopoverBackdrop),
			Scene.Mount.expectEnded(Popover.AnchorPopover),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})
})
