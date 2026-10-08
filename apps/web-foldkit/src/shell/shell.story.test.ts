// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import { ada, hazelOrg } from "../test/root-fixtures"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import { Message, type Model } from "./model"
import { type Context, informContext, init, update } from "./update"

/** The shell's menus and sidebar sheet: what they report to the root (legacy `AppSidebar` menus). */

const context: Context = {
	orgSlug: "hazel",
	isChatSection: true,
	canCreateChannel: true,
	organizationId: hazelOrg.id,
	currentUserId: ada.id,
}
const run = (model: Model, msg: Message) => update(model, msg, context)
const ready = informContext(init(), context).model

const userMenu = (inner: Menu.Message) => Message.GotUserMenuMessage({ message: inner })
const orgSwitcher = (inner: Menu.Message) => Message.GotOrgSwitcherMessage({ message: inner })
const opened = Menu.Message.PressedTrigger({ pointerType: "mouse" })
const clicked = (key: string) => Menu.Message.ClickedItem({ key })

const otherOrgId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-0000000000a2")
const unfinishedOrgId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-0000000000a3")
const organizations = [
	{ id: hazelOrg.id, name: "Hazel", slug: "hazel", logoUrl: null },
	{ id: otherOrgId, name: "Acme", slug: "acme", logoUrl: null },
	{ id: unfinishedOrgId, name: "Draft", slug: null, logoUrl: null },
]

describe("user menu", () => {
	test("its links follow the route's org and the signed-in user", () => {
		const hrefs = ready.userMenu.entries.flatMap((entry) =>
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
			message(userMenu(clicked(key))),
			Command.expectNone(),
			expectOutMessage(outMessage),
		)
	})
})

describe("org switcher", () => {
	test("Invite people opens the email invite modal", () => {
		story(
			run,
			given(ready),
			message(orgSwitcher(opened)),
			message(orgSwitcher(clicked("invite-people"))),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
		)
	})

	test("on desktop, an organization in the Switch server submenu navigates to its slug", () => {
		story(
			run,
			given(run(ready, Message.UpdatedUserOrganizations({ organizations })).model),
			message(orgSwitcher(opened)),
			message(orgSwitcher(clicked("switch-server"))),
			message(orgSwitcher(clicked(`org:${otherOrgId}`))),
			expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/acme", replace: false })),
		)
	})

	describe("on mobile (a flat list of organizations)", () => {
		const mobile = run(
			run(ready, Message.ChangedViewport({ isMobile: true })).model,
			Message.UpdatedUserOrganizations({ organizations }),
		).model

		test("checks the current organization", () => {
			expect(mobile.orgSwitcher.selectionMode).toBe("Single")
			expect(mobile.orgSwitcher.selectedKeys).toEqual([`org:${hazelOrg.id}`])
		})

		// BUG: in "Single" mode the kit Menu selects the clicked key before the shell folds its
		// OutMessage, so `switchedOrganization` sees it as the current org and never navigates.
		test.fails("another organization navigates to its slug", () => {
			story(
				run,
				given(mobile),
				message(orgSwitcher(opened)),
				message(orgSwitcher(clicked(`org:${otherOrgId}`))),
				expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/acme", replace: false })),
			)
		})

		// BUG: same as above (shell/update.ts `switchedOrganization` reads the post-click selection).
		test.fails("an organization without a slug goes back to setup", () => {
			story(
				run,
				given(mobile),
				message(orgSwitcher(opened)),
				message(orgSwitcher(clicked(`org:${unfinishedOrgId}`))),
				expectOutMessage(
					PageOutMessage.RequestedNavigation({
						href: `/onboarding/setup-organization?orgId=${unfinishedOrgId}`,
						replace: false,
					}),
				),
			)
		})

		test("the current organization does nothing", () => {
			story(
				run,
				given(mobile),
				message(orgSwitcher(opened)),
				message(orgSwitcher(clicked(`org:${hazelOrg.id}`))),
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
			message(Message.GotMobileSidebarMessage({ message: Modal.Message.PressedEscape() })),
			model((m) => expect(m.isSidebarOpen).toBe(false)),
		)
	})
})

describe("context", () => {
	test("switching organization rebuilds the menus with the new slug", () => {
		const acme = informContext(ready, { ...context, orgSlug: "acme", organizationId: otherOrgId }).model
		expect(acme.menuSignature).not.toBe(ready.menuSignature)
		const mySettings = acme.userMenu.entries.flatMap((entry) =>
			entry._tag === "Item" && entry.item.key === "my-settings" && entry.item.href._tag === "Some"
				? [entry.item.href.value]
				: [],
		)
		expect(mySettings).toEqual(["/acme/my-settings"])
	})

	test("an unchanged context keeps the same menus", () => {
		const again = informContext(ready, context).model
		expect(again.userMenu).toBe(ready.userMenu)
		expect(again.orgSwitcher).toBe(ready.orgSwitcher)
	})
})
