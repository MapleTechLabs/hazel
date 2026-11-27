// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import * as Customers from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerSettingsId,
	CustomerSlaPolicyId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { describe, expect, test } from "vitest"
import type { Session } from "../../../app/session"
import type { AccountRow } from "../../data/queries"
import type { PolicyRow, SettingsRow } from "../../data/settings"
import { FeatureFlagsMessage, FeatureFlagsPageNoDeps, RunFlagAction } from "./feature-flags/FeatureFlagsPage"
import { PlansMessage, PlansPageNoDeps, SavePlans } from "./plans/PlansPage"
import { RunSlaWrite, SlaMessage, SlaPageNoDeps } from "./sla/SlaPage"

/** The Customers settings pages: Plans, Feature flags and Support SLAs. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = OrganizationId.make(uuid(1))
const userId = UserId.make(uuid(4))

const session = (role: "owner" | "member" = "owner"): Session => ({
	auth: "SignedIn",
	user: {
		id: userId,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make(uuid(5)), role },
	orgSlug: "hazel",
})

const settings: SettingsRow = {
	id: CustomerSettingsId.make(uuid(6)),
	addOnPlans: ["Seats"],
	businessHours: Customers.DEFAULT_BUSINESS_HOURS,
	supportTriage: Customers.DEFAULT_SUPPORT_TRIAGE,
}

const ORG = `"${organizationId}"`

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const toggle = (label: string) => byProp("toggle", "label", label)

describe("plans settings", () => {
	test("lists the plans and the saved add-ons; a switch saves at once, one save at a time", () => {
		const s = Scene.start(PlansPageNoDeps, { session: session() })
			.expect(byProp("progress", "label", "Loading plans"))
			.toExist()
			.loaded("plans", ["Pro", "Enterprise"])
			.subscription(`settings:${ORG}`, PlansMessage.UpdatedSettings({ settings }))
		expect(s.get(toggle("Seats")).props?.["checked"]).toBe(true)
		s.fire(toggle("Pro"), "change", { checked: true }).expectExact(
			SavePlans.make({ organizationId, settingsId: settings.id, addOnPlans: ["Seats", "Pro"] }),
		)
		expect(s.get(toggle("Enterprise")).props?.["disabled"]).toBe(true)
		s.resolve(SavePlans, PlansMessage.SettledSave())
		expect(s.get(toggle("Enterprise")).props?.["disabled"]).toBeUndefined()
	})

	test("a member looks but cannot change", () => {
		const s = Scene.start(PlansPageNoDeps, { session: session("member") })
			.loaded("plans", ["Pro"])
			.subscription(`settings:${ORG}`, PlansMessage.UpdatedSettings({ settings }))
			.expect(
				byProp(
					"banner",
					"description",
					"Only admins and owners can change plans. You can look around.",
				),
			)
			.toExist()
		expect(s.get(toggle("Pro")).props?.["disabled"]).toBe(true)
	})
})

const account = (n: number, name: string, featureFlags: Record<string, boolean>): AccountRow => ({
	id: CustomerAccountId.make(uuid(100 + n)),
	name,
	domain: null,
	logoUrl: null,
	company: null,
	companyCheckedAtMs: null,
	ownerUserId: null,
	lifecycleStage: "active",
	planName: null,
	mrrMinor: 0,
	currency: "usd",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 0,
	activeUsers30d: 0,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: 0,
	lastActiveAtMs: null,
	customerSinceMs: null,
	churnedAtMs: null,
	tags: [],
	featureFlags,
	primaryAccountId: null,
	environment: null,
	attentionMutedAtMs: null,
	attentionMutedUntilMs: null,
	attentionMutedByUserId: null,
})
const acme = account(1, "Acme", { beta: true, legacy: false })
const globex = account(2, "Globex", {})

const flagsPage = () =>
	Scene.start(FeatureFlagsPageNoDeps, { session: session() })
		.subscription(`created:${ORG}`, FeatureFlagsMessage.UpdatedCreated({ keys: ["fresh"] }))
		.subscription(`accounts:${ORG}`, FeatureFlagsMessage.UpdatedAccounts({ accounts: [acme, globex] }))

describe("feature flags settings", () => {
	test("lists created and synced keys; a flag opens to its customers", () => {
		flagsPage()
			.expect(button("beta"))
			.toExist()
			.expect(button("legacy"))
			.toExist()
			.expect(button("fresh"))
			.toExist()
			.fire(button("beta"), "press")
			.expect(byProp("link", "label", "Acme"))
			.toExist()
			.expect(byProp("link", "label", "Globex"))
			.toBeAbsent()
	})

	test("a new key is created and opened; a bad one is refused", () => {
		const s = flagsPage().fire(Locator.tag("hz:textField"), "change", {
			value: "bad key",
			rev: 1,
			edit: 0,
		})
		expect(s.get(Locator.tag("hz:textField")).props?.["error"]).toBeDefined()
		s.fire(Locator.tag("hz:textField"), "change", { value: "new_one", rev: 2, edit: 0 })
			.fire(button("Create flag"), "press")
			.expectExact(
				RunFlagAction.make({
					organizationId,
					action: "create",
					key: "new_one",
					accountIds: [],
					createdBy: userId,
				}),
			)
			.resolve(RunFlagAction, FeatureFlagsMessage.SettledFlagAction({ action: "create", ok: true }))
	})

	test("the picker turns the flag on for the ticked customers", () => {
		flagsPage()
			.fire(button("beta"), "press")
			.fire(button("Add customers"), "press")
			.fire(toggle("Globex"), "change", { checked: true })
			.fire(button("Turn on"), "press")
			.expectExact(
				RunFlagAction.make({
					organizationId,
					action: "assign",
					key: "beta",
					accountIds: [globex.id],
					createdBy: userId,
				}),
			)
			.resolve(RunFlagAction, FeatureFlagsMessage.SettledFlagAction({ action: "assign", ok: true }))
	})

	test("delete asks first", () => {
		flagsPage()
			.fire(button("Delete legacy"), "press")
			.expect(byProp("dialog", "title", "Delete legacy?"))
			.toExist()
			.fire(button("Delete flag"), "press")
			.expectExact(
				RunFlagAction.make({
					organizationId,
					action: "delete",
					key: "legacy",
					accountIds: [],
					createdBy: userId,
				}),
			)
			.resolve(RunFlagAction, FeatureFlagsMessage.SettledFlagAction({ action: "delete", ok: true }))
	})
})

const policy = (n: number, name: string): PolicyRow => ({
	...Customers.DEFAULT_SLA_POLICY,
	id: CustomerSlaPolicyId.make(uuid(200 + n)),
	name,
	position: n,
})
const standard = policy(0, "Standard")
const enterprise = policy(1, "Enterprise")

const slaPage = (role: "owner" | "member" = "owner") =>
	Scene.start(SlaPageNoDeps, { session: session(role) })
		.loaded("plans", ["Enterprise"])
		.subscription(`policies:${ORG}`, SlaMessage.UpdatedPolicies({ policies: [standard, enterprise] }))
		.subscription(`settings:${ORG}`, SlaMessage.UpdatedSettings({ settings }))

describe("support SLA settings", () => {
	test("moving a policy sends the whole order", () => {
		slaPage()
			.fire(button("Move Enterprise up"), "press")
			.expectExact(
				RunSlaWrite.make({
					organizationId,
					write: { _tag: "Reorder", policyIds: [enterprise.id, standard.id] },
				}),
			)
			.resolve(RunSlaWrite, SlaMessage.Settled({ write: "list", ok: true, token: 0 }))
	})

	test("the editor refuses an unnamed policy, then saves a named one and closes", () => {
		const s = slaPage().fire(button("New policy"), "press").fire(button("Create policy"), "press")
		expect(s.get(byProp("textField", "label", "Name")).props?.["error"]).toBe("Name the policy")
		s.fire(byProp("textField", "label", "Name"), "change", { value: "Gold", rev: 1, edit: 0 })
			.fire(button("Create policy"), "press")
			.resolve(RunSlaWrite, SlaMessage.Settled({ write: "policy", ok: true, token: 1 }))
			.expect(button("Create policy"))
			.toBeAbsent()
	})

	test("business hours save only once changed", () => {
		slaPage()
			.fire(Locator.tag("hz:choiceGroup"), "change", { selected: ["1", "2", "3", "4"] })
			.fire(button("Save hours"), "press")
			.expectExact(
				RunSlaWrite.make({
					organizationId,
					write: {
						_tag: "SaveHours",
						settingsId: settings.id,
						businessHours: { ...Customers.DEFAULT_BUSINESS_HOURS, days: [1, 2, 3, 4] },
					},
				}),
			)
			.resolve(RunSlaWrite, SlaMessage.Settled({ write: "hours", ok: true, token: 0 }))
			.expect(button("Save hours"))
			.toBeAbsent()
	})

	test("delete asks first", () => {
		slaPage()
			.fire(button("Delete Standard"), "press")
			.expect(byProp("dialog", "title", "Delete this policy?"))
			.toExist()
			.fire(button("Delete policy"), "press")
			.expectExact(
				RunSlaWrite.make({ organizationId, write: { _tag: "Delete", policyId: standard.id } }),
			)
			.resolve(RunSlaWrite, SlaMessage.Settled({ write: "delete", ok: true, token: 0 }))
	})
})
