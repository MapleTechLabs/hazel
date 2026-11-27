// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The shell chrome as Stories: each menu choice's request, the sidebar's, and the header's tabs. */
import { Component } from "@effect/ui"
import { Story } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { ChannelId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { Navigate, OpenModal, SignOut } from "../app/requests"
import { ChannelSettingsHeader } from "./ChannelSettingsHeader"
import { AccountMenu, OrgSwitcher, SwitchOrganization } from "./Chrome"
import { choiceOf, switcherEntries } from "./menus"
import {
	MarkAllNotificationsRead,
	SectionSidebar,
	SectionSidebarEvents,
	SectionSidebarMessage,
} from "./SectionSidebar"

const hrefs = {
	profile: "/hazel/profile/u1",
	mySettings: "/hazel/my-settings/profile",
	manageMembers: "/hazel/settings/team",
	serverSettings: "/hazel/settings",
	customEmojis: "/hazel/settings/custom-emojis",
	integrations: "/hazel/settings/integrations",
}
const userId = UserId.make("00000002-0000-4000-8000-000000000001")
const hazel = { id: "00000001-0000-4000-8000-000000000001", name: "Hazel", slug: "hazel", logoUrl: null }
const acme = { id: "00000001-0000-4000-8000-000000000002", name: "Acme", slug: "acme", logoUrl: null }
const switcher = {
	organizationId: hazel.id,
	orgName: "Hazel",
	logoUrl: null,
	userId,
	hrefs,
	compact: false,
	isChat: false,
	canCreateChannel: true,
}
const account = {
	organizationId: hazel.id,
	userId,
	name: "Ada Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	hrefs,
}

describe("menu choices", () => {
	it("links, modals, sign out and another organization", () => {
		const context = { hrefs, orgs: [hazel, acme], organizationId: hazel.id }
		assert.deepStrictEqual(choiceOf("my-settings", context), { _tag: "Link", href: hrefs.mySettings })
		assert.deepStrictEqual(choiceOf("server-settings", context), {
			_tag: "Link",
			href: hrefs.serverSettings,
		})
		assert.deepStrictEqual(choiceOf("status", context), { _tag: "Modal", modal: "SetStatus" })
		assert.deepStrictEqual(choiceOf("create-server", context), {
			_tag: "Modal",
			modal: "CreateOrganization",
		})
		assert.deepStrictEqual(choiceOf("logout", context), { _tag: "SignOut" })
		assert.deepStrictEqual(choiceOf(acme.id, context), { _tag: "Organization", org: acme })
		// The organization shown does nothing.
		assert.deepStrictEqual(choiceOf(hazel.id, context), { _tag: "None" })
	})

	it("chat gets the longer switcher, settings the shorter, a phone only the organizations", () => {
		const ids = (options: Partial<Parameters<typeof switcherEntries>[0]>) =>
			switcherEntries({
				organizationId: hazel.id,
				orgs: [hazel, acme],
				compact: false,
				isChat: false,
				canCreateChannel: true,
				...options,
			}).flatMap((group) => group.entries.map((entry) => entry.id))
		assert.deepStrictEqual(ids({}), [
			"invite-people",
			"manage-members",
			"switch-server",
			"server-settings",
		])
		assert.deepStrictEqual(ids({ isChat: true }), [
			"invite-people",
			"manage-members",
			"switch-server",
			"create-channel",
			"create-category",
			"server-settings",
			"custom-emojis",
			"integrations",
		])
		assert.notInclude(ids({ isChat: true, canCreateChannel: false }), "create-channel")
		assert.deepStrictEqual(ids({ compact: true }), [hazel.id, acme.id, "create-server"])
	})
})

describe("OrgSwitcher", () => {
	it.effect("subscribes to the user's organizations", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(OrgSwitcher, switcher)
			assert.isTrue(s.subscriptions.some((key) => key.startsWith("orgs")))
		}),
	)

	it.effect("a link asks the app to navigate", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(OrgSwitcher, switcher)
			s.send({ _tag: "Selected", id: "manage-members" }).expectExact(Navigate)
			assert.deepStrictEqual(s.pending[0]?.command.args, { href: hrefs.manageMembers, replace: false })
			s.resolve(Navigate, Component.noop)
		}),
	)

	it.effect("another organization goes to the host with its slug", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(OrgSwitcher, switcher)
			s.send({ _tag: "UpdatedOrgs", orgs: [hazel, acme] })
			s.send({ _tag: "Selected", id: acme.id }).expectExact(SwitchOrganization)
			assert.deepStrictEqual(s.pending[0]?.command.args, { organizationId: acme.id, slug: "acme" })
			s.resolve(SwitchOrganization, Component.noop)
		}),
	)
})

describe("AccountMenu", () => {
	it.effect("status opens the host's modal; log out signs out", () =>
		Effect.gen(function* () {
			const status = yield* Story.make(AccountMenu, account)
			status.send({ _tag: "Selected", id: "status" }).expectExact(OpenModal)
			assert.deepStrictEqual(status.pending[0]?.command.args, { modal: { _tag: "SetStatus" } })
			status.resolve(OpenModal, Component.noop)
			const logout = yield* Story.make(AccountMenu, account)
			logout
				.send({ _tag: "Selected", id: "logout" })
				.expectExact(SignOut)
				.resolve(SignOut, Component.noop)
		}),
	)
})

describe("SectionSidebar", () => {
	const props = {
		kind: "activity" as const,
		groups: [],
		unreadCount: 2,
		isMarkingAllRead: false,
		switcher,
		account,
		sheet: null,
	}

	it.effect("Mark all as read asks the host", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(SectionSidebar, props)
			s.send(SectionSidebarMessage.PressedMarkAllRead())
				.expectExact(MarkAllNotificationsRead)
				.resolve(MarkAllNotificationsRead, Component.noop)
		}),
	)

	it.effect("a phone's sheet asks its parent to close", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(SectionSidebar, { ...props, kind: "settings", sheet: { open: true } })
			s.send(SectionSidebarMessage.DismissedSheet()).emitted(SectionSidebarEvents.RequestedClose())
		}),
	)
})

describe("ChannelSettingsHeader", () => {
	const props = {
		channelId: ChannelId.make("00000005-0000-4000-8000-000000000001"),
		channelHref: "/hazel/chat/00000005-0000-4000-8000-000000000001",
		tabs: [
			{ id: "overview", label: "Overview", href: "/hazel/channels/c/settings/overview" },
			{ id: "connect", label: "Connect", href: "/hazel/channels/c/settings/connect" },
		],
		selected: "overview",
	}

	it.effect("another tab navigates to its page; the shown one does nothing", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(ChannelSettingsHeader, props)
			s.send({ _tag: "ChangedTab", id: "overview" })
			assert.strictEqual(s.pending.length, 0)
			s.send({ _tag: "ChangedTab", id: "connect" }).expectExact(Navigate)
			assert.deepStrictEqual(s.pending[0]?.command.args, {
				href: "/hazel/channels/c/settings/connect",
				replace: false,
			})
			s.resolve(Navigate, Component.noop)
		}),
	)
})
