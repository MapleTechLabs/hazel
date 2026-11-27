// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, CustomerAccountId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, OpenModal, ShowToast } from "../../app/requests"
import type { Session } from "../../app/session"
import type { AccountRow } from "../data/queries"
import {
	CopyText,
	RegroupAccount,
	SetAttentionMute,
	SetFeatureFlags,
	UpdateCustomerAccount,
	WriteChannelLink,
} from "../detail/commands"
import { CustomerDetailMessage, type CustomerTab, ownerKeyOf } from "../detail/model"
import { CustomerDetailPageNoDeps } from "./CustomerDetailPage"

/** The customer page's native shell: header, menus, details panel; the tab is the host's slot. */

const NOW = Date.parse("2026-11-26T15:00:00Z")
const orgId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const ada = UserId.make("00000001-0000-4000-8000-0000000000a1")
const grace = UserId.make("00000001-0000-4000-8000-0000000000a2")
const id = (n: number) => CustomerAccountId.make(`000000c1-0000-4000-8000-00000000000${n}`)

const session = (role: "owner" | "member" = "owner"): Session => ({
	auth: "SignedIn",
	user: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: orgId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000001-0000-4000-8000-0000000000b1"), role },
	orgSlug: "hazel",
})

const row = (n: number, name: string, overrides: Partial<AccountRow> = {}): AccountRow => ({
	id: id(n),
	name,
	domain: null,
	logoUrl: null,
	company: null,
	companyCheckedAtMs: null,
	ownerUserId: null,
	lifecycleStage: "active",
	planName: "Team",
	mrrMinor: 49_000,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 4,
	activeUsers30d: 3,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW - 400 * 86_400_000,
	lastActiveAtMs: null,
	customerSinceMs: null,
	churnedAtMs: null,
	tags: [],
	featureFlags: {},
	primaryAccountId: null,
	environment: null,
	attentionMutedAtMs: null,
	attentionMutedUntilMs: null,
	attentionMutedByUserId: null,
	...overrides,
})

const northwind = row(2, "Northwind Labs", { tags: ["eu"], featureFlags: { beta: true } })
const accounts = [row(1, "Acme Robotics"), northwind, row(3, "Umbrella Health")]

const start = (tab: CustomerTab = "overview", role: "owner" | "member" = "owner", isMobile = false) =>
	Scene.start(CustomerDetailPageNoDeps, {
		accountId: id(2),
		tab,
		session: session(role),
		isMobile,
		nowMs: NOW,
	}).keepPending("detail")
const loaded = (tab: CustomerTab = "overview", role: "owner" | "member" = "owner") =>
	start(tab, role)
		.subscription(sub("accounts"), CustomerDetailMessage.UpdatedAccounts({ accounts }))
		.keepPending("suggestions")
		.subscription(
			sub("members"),
			CustomerDetailMessage.UpdatedMembers({
				members: [{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null }],
			}),
		)

/** A Subscription by its name and the organization it is keyed on. */
const sub = (name: string) => `${name}:${JSON.stringify(orgId)}`

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const iconButton = (label: string): Locator.Locator => ({
	description: `<hz:button iconOnly label=${JSON.stringify(label)}>`,
	all: (root) =>
		button(label)
			.all(root)
			.filter((node) => node.props?.["iconOnly"] === true),
})
const menu = (label: string) => byProp("menu", "label", label)

describe("customer page shell", () => {
	test("loads, then names the customer in the crumbs and heading", () => {
		const s = start()
		s.expect(byProp("progress", "label", "Loading customer...")).toExist()
		s.subscription(sub("accounts"), CustomerDetailMessage.UpdatedAccounts({ accounts }))
		expect(s.get(Locator.tag("hz:screen")).props?.["crumbs"]).toEqual([
			{ label: "Customers", href: "/hazel/customers/list" },
			{ label: "Northwind Labs" },
		])
		s.expect(byProp("text", "role", "caption")).toExist()
	})

	test("a customer the synced list dropped, or the server lost, is not found", () => {
		start()
			.subscription(
				sub("accounts"),
				CustomerDetailMessage.UpdatedAccounts({ accounts: [accounts[0]!] }),
			)
			.loadFailed("detail", "NotFound")
			.expect(byProp("emptyState", "title", "Customer not found"))
			.toExist()
	})

	test("prev and next follow the accounts by name, keeping the tab", () => {
		loaded("billing")
			.fire(button("Next customer"), "press")
			.expectExact(Navigate.make({ href: `/hazel/customers/${id(3)}?tab=billing`, replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(button("Previous customer"), "press")
			.expectExact(Navigate.make({ href: `/hazel/customers/${id(1)}?tab=billing`, replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("a tab and Add note navigate to the tab's URL", () => {
		loaded()
			.fire(Locator.tag("hz:tabBar"), "change", { id: "users" })
			.expectExact(Navigate.make({ href: `/hazel/customers/${id(2)}?tab=users`, replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(button("Add note"), "press")
			.expectExact(Navigate.make({ href: `/hazel/customers/${id(2)}?tab=notes`, replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("the owner changes at once; a failed write says so", () => {
		const s = loaded()
			.fire(menu("Owner"), "select", { id: ownerKeyOf(grace) })
			.expectExact(
				UpdateCustomerAccount.make({ organizationId: orgId, accountId: id(2), ownerUserId: grace }),
			)
		expect(s.get(menu("Owner")).props).toBeDefined()
		s.resolve(
			UpdateCustomerAccount,
			CustomerDetailMessage.FailedAccountWrite({ write: "owner", message: "It was removed." }),
		).expectExact(
			ShowToast.make({
				toast: {
					intent: "error",
					title: "Couldn't update the customer",
					description: "It was removed.",
				},
			}),
		)
	})

	test("tags add once and remove", () => {
		loaded()
			.fire(iconButton("Add tag"), "press")
			.fire(byProp("textField", "label", "Tag name"), "submit", { value: "vip", rev: 1, edit: 0 })
			.expectExact(
				UpdateCustomerAccount.make({ organizationId: orgId, accountId: id(2), tags: ["eu", "vip"] }),
			)
			.resolve(UpdateCustomerAccount, Component.noop)
			.fire(button("eu"), "remove")
			.expectExact(
				UpdateCustomerAccount.make({ organizationId: orgId, accountId: id(2), tags: ["vip"] }),
			)
			.resolve(UpdateCustomerAccount, Component.noop)
	})

	test("More: copy link, raw data and linking open what they name; mute toasts", () => {
		loaded()
			.fire(menu("More actions"), "select", { id: "copy_link" })
			.expectExact(CopyText.make({ text: `/hazel/customers/${id(2)}`, label: "Link", isPath: true }))
			.resolve(CopyText, CustomerDetailMessage.SucceededCopy({ label: "Link" }))
			.expectExact(
				ShowToast.make({ toast: { intent: "success", title: "Link copied", description: null } }),
			)
			.resolve(ShowToast, Component.noop)
			.fire(menu("More actions"), "select", { id: "link_customer" })
			.expectExact(
				OpenModal.make({ modal: { _tag: "CustomerLink", organizationId: orgId, accountId: id(2) } }),
			)
			.resolve(OpenModal, Component.noop)
			.fire(menu("More actions"), "select", { id: "mute:forever" })
			.expectExact(
				SetAttentionMute.make({
					organizationId: orgId,
					accountId: id(2),
					userId: ada,
					mute: { untilMs: null },
				}),
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Muted in Needs attention until unmuted",
						description: null,
					},
				}),
			)
	})

	test("an environment makes itself primary at once", () => {
		const grouped = [
			row(1, "Acme Robotics"),
			{ ...northwind, primaryAccountId: id(1), environment: "EU" },
		]
		start()
			.subscription(sub("accounts"), CustomerDetailMessage.UpdatedAccounts({ accounts: grouped }))
			.keepPending("suggestions")
			.fire(menu("More actions"), "select", { id: "make_primary" })
			.expectExact(
				RegroupAccount.make({ organizationId: orgId, accountId: id(2), change: "make_primary" }),
			)
	})

	test("a channel links to the customer's primary, and unlinks", () => {
		const channelId = ChannelId.make("00000001-0000-4000-8000-0000000000c1")
		loaded()
			.subscription(
				sub("channelOptions"),
				CustomerDetailMessage.UpdatedChannelOptions({
					channels: [{ id: channelId, name: "general", isPrivate: false, origin: "hazel" }],
				}),
			)
			.fire(button("Link channel"), "press")
			.fire(byProp("item", "title", "general"), "press")
			.expectExact(
				WriteChannelLink.make({
					organizationId: orgId,
					channelId,
					link: { accountId: id(2), userId: ada },
				}),
			)
			.resolve(
				WriteChannelLink,
				CustomerDetailMessage.FailedChannelWrite({ action: "link", reason: "Stale" }),
			)
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Couldn't link the channel",
						description: "Threads and direct messages can't be linked to a customer.",
					},
				}),
			)
	})

	test("an admin adds the ticked flags at once, and turns one off; a member only reads them", () => {
		loaded()
			.subscription(
				sub("flags"),
				CustomerDetailMessage.UpdatedCreatedFeatureFlags({ keys: ["beta", "sso"] }),
			)
			.fire(button("Add flags"), "press")
			.fire(byProp("toggle", "label", "sso"), "change", { checked: true })
			.fire(button("Add flag"), "press")
			.expectExact(
				SetFeatureFlags.make({
					organizationId: orgId,
					accountId: id(2),
					keys: ["sso"],
					enabled: true,
				}),
			)
			.resolve(SetFeatureFlags, Component.noop)
			.fire(button("Turn off beta"), "press")
			.expectExact(
				SetFeatureFlags.make({
					organizationId: orgId,
					accountId: id(2),
					keys: ["beta"],
					enabled: false,
				}),
			)
		loaded("overview", "member").expect(button("Add flags")).toBeAbsent()
	})

	test("the details panel hides on the Users tab and on a phone", () => {
		loaded().expect(Locator.tag("hz:splitView")).toExist()
		loaded("users").expect(Locator.tag("hz:splitView")).toBeAbsent()
		start("overview", "owner", true)
			.subscription(sub("accounts"), CustomerDetailMessage.UpdatedAccounts({ accounts }))
			.expect(Locator.tag("hz:splitView"))
			.toBeAbsent()
	})
})
