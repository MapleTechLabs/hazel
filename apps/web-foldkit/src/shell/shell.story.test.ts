// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import { AppRoute } from "../route"
import { ada, hazelOrg } from "../test/root-fixtures"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import { switcherLinkRoute, userMenuLinkRoute } from "./menus"
import { Message, type Model } from "./model"
import { type Context, informContext, init, update } from "./update"

/** The shell's menus and sidebar sheet: what they report to the root (legacy `AppSidebar` menus). */

const context: Context = {
	orgSlug: "hazel",
	isChatSection: true,
	canCreateChannel: true,
	organizationId: hazelOrg.id,
	currentUserId: ada.id,
	isMobile: false,
}
const run = (model: Model, msg: Message) => update(model, msg, context)
const ready = informContext(init({ isCreateChannelHintDismissed: false }), context)

const userMenu = (inner: Menu.Message) => Message.GotUserMenuMessage({ message: inner })
const orgSwitcher = (inner: Menu.Message) => Message.GotOrgSwitcherMessage({ message: inner })
const opened = Menu.Message.PressedTrigger({ pointerType: "mouse" })
/** A click on `key`, with the entries the view passes the menu (the shell Model's, as `app/view.ts` does). */
const clicked = (key: string, entries: ReadonlyArray<Menu.Entry>) =>
	Menu.Message.ClickedItem({ key, entries })

const otherOrgId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-0000000000a2")
const unfinishedOrgId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-0000000000a3")
const organizations = [
	{ id: hazelOrg.id, name: "Hazel", slug: "hazel", logoUrl: null },
	{ id: otherOrgId, name: "Acme", slug: "acme", logoUrl: null },
	{ id: unfinishedOrgId, name: "Draft", slug: null, logoUrl: null },
]

describe("user menu", () => {
	test("its links follow the route's org and the signed-in user", () => {
		const hrefs = ready.userMenuEntries.flatMap((entry) =>
			entry._tag === "Item" && entry.item.href._tag === "Some" ? [entry.item.href.value] : [],
		)
		expect(hrefs).toEqual([`/hazel/profile/${ada.id}`, "/hazel/my-settings"])
	})

	test.each([
		["status", PageOutMessage.RequestedModal({ modal: { _tag: "SetStatus" } })],
		["feedback", PageOutMessage.RequestedModal({ modal: { _tag: "Feedback" } })],
		["logout", PageOutMessage.RequestedSignOut()],
	])("%s asks the root", (key, outMessage) => {
		story(
			run,
			given(ready),
			message(userMenu(opened)),
			message(userMenu(clicked(key, ready.userMenuEntries))),
			Command.expectNone(),
			expectOutMessage(outMessage),
		)
	})
})

describe("org switcher", () => {
	const withOrganizations = run(ready, Message.UpdatedUserOrganizations({ organizations })).model
	const switcherEntries = withOrganizations.orgSwitcherEntries

	test("Invite people opens the email invite modal", () => {
		story(
			run,
			given(ready),
			message(orgSwitcher(opened)),
			message(orgSwitcher(clicked("invite-people", ready.orgSwitcherEntries))),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
		)
	})

	test("on desktop, an organization in the Switch server submenu navigates to its slug", () => {
		story(
			run,
			given(withOrganizations),
			message(orgSwitcher(opened)),
			message(orgSwitcher(clicked("switch-server", switcherEntries))),
			message(orgSwitcher(clicked(otherOrgId, switcherEntries))),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: AppRoute.OrgHome({ orgSlug: "acme" }),
					replace: false,
				}),
			),
		)
	})

	test("on desktop, the current organization in the submenu does nothing (legacy `SwitchServerMenu`)", () => {
		story(
			run,
			given(withOrganizations),
			message(orgSwitcher(opened)),
			message(orgSwitcher(clicked("switch-server", switcherEntries))),
			message(orgSwitcher(clicked(hazelOrg.id, switcherEntries))),
			expectNoOutMessage(),
		)
	})

	describe("on mobile (a flat list of organizations)", () => {
		const mobileContext: Context = { ...context, isMobile: true }
		const runMobile = (model: Model, msg: Message) => update(model, msg, mobileContext)
		const mobile = runMobile(
			informContext(ready, mobileContext),
			Message.UpdatedUserOrganizations({ organizations }),
		).model

		test("checks the current organization", () => {
			expect(mobile.orgSwitcher.selectionMode).toBe("Single")
			expect(mobile.orgSwitcher.selectedKeys).toEqual([hazelOrg.id])
		})

		// B2: the "Single" menu selects the clicked key before the shell folds its OutMessage.
		test("another organization navigates to its slug", () => {
			story(
				runMobile,
				given(mobile),
				message(orgSwitcher(opened)),
				message(orgSwitcher(clicked(otherOrgId, mobile.orgSwitcherEntries))),
				expectOutMessage(
					PageOutMessage.RequestedNavigation({
						route: AppRoute.OrgHome({ orgSlug: "acme" }),
						replace: false,
					}),
				),
			)
		})

		test("an organization without a slug goes back to setup", () => {
			story(
				runMobile,
				given(mobile),
				message(orgSwitcher(opened)),
				message(orgSwitcher(clicked(unfinishedOrgId, mobile.orgSwitcherEntries))),
				expectOutMessage(
					PageOutMessage.RequestedNavigation({
						route: AppRoute.OnboardingSetupOrganization({ orgId: Option.some(unfinishedOrgId) }),
						replace: false,
					}),
				),
			)
		})

		test("the current organization does nothing", () => {
			story(
				runMobile,
				given(mobile),
				message(orgSwitcher(opened)),
				message(orgSwitcher(clicked(hazelOrg.id, mobile.orgSwitcherEntries))),
				expectNoOutMessage(),
			)
		})
	})
})

describe("mobile sidebar sheet", () => {
	test("opens from the header and closes on Escape", () => {
		story(
			run,
			given(ready),
			message(Message.ToggledSidebar({ isOpen: true })),
			model((m) => expect(m.isSidebarOpen).toBe(true)),
			message(Message.GotMobileSidebarMessage({ message: Modal.Message.RequestedClose() })),
			model((m) => expect(m.isSidebarOpen).toBe(false)),
		)
	})
})

describe("context", () => {
	test("switching organization rebuilds the menus with the new slug", () => {
		const acme = informContext(ready, { ...context, orgSlug: "acme", organizationId: otherOrgId })
		const mySettings = acme.userMenuEntries.flatMap((entry) =>
			entry._tag === "Item" && entry.item.key === "my-settings" && entry.item.href._tag === "Some"
				? [entry.item.href.value]
				: [],
		)
		expect(mySettings).toEqual(["/acme/my-settings"])
	})

	test("a link item's href and its keyboard navigation come from one route", () => {
		expect(userMenuLinkRoute("my-settings", "hazel", ada.id)).toEqual(
			Option.some(AppRoute.MySettingsAppearance({ orgSlug: "hazel" })),
		)
		expect(switcherLinkRoute("server-settings", "hazel")).toEqual(
			Option.some(AppRoute.SettingsGeneral({ orgSlug: "hazel" })),
		)
		expect(userMenuLinkRoute("logout", "hazel", ada.id)).toEqual(Option.none())
	})
})
