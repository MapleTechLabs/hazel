// @vitest-environment jsdom
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { ACCOUNTS, ACCOUNTS_BY_KEY, ACME_DETAIL, NOW } from "../../../test/fixtures/customers"
import { AppRoute, customerRoute, hrefOf } from "../../../route"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import * as Popover from "../../../ui/popover"
import { CopyCustomerText } from "./commands"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** The customer page's tab content through its view (the shell is native: `CustomerDetailPage`). */

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
