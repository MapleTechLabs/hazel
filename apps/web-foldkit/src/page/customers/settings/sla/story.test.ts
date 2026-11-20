import * as Customers from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerSettingsId,
	CustomerSlaPolicyId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { Shared } from "../../../contract"
import * as Select from "../../../../ui/select"
import { sharedDefaults } from "../../../test-shared"
import {
	CreateSlaPolicy,
	FetchSlaPlans,
	ReorderSlaPolicies,
	SaveBusinessHours,
	ToggleSlaPolicy,
} from "./commands"
import { appliesToSummary, exampleLine, hoursErrors, mediumTargetHint } from "./draft"
import { Message } from "./message"
import { hoursFormOf, type Model, type PolicyForm, type PolicyRow } from "./model"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the SLA settings: the ordered policies, the editor, business hours, members. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const settingsId = Schema.decodeSync(CustomerSettingsId)(uuid(2))
const policyId = (n: number) => Schema.decodeSync(CustomerSlaPolicyId)(uuid(100 + n))
const accountId = (n: number) => Schema.decodeSync(CustomerAccountId)(uuid(200 + n))

const sharedAs = (role: "admin" | "member"): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: Schema.decodeSync(UserId)(uuid(4)),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(5)), role },
	nowMs: Date.UTC(2026, 10, 20, 12),
	...sharedDefaults,
})
const admin = sharedAs("admin")
const member = sharedAs("member")

const none = { accountIds: [], planNames: [], tagsAny: [] }
const target = (firstResponseMinutes: number, resolutionMinutes: number) => ({
	firstResponseMinutes,
	resolutionMinutes,
})
const fast: Customers.SlaTargets = {
	urgent: target(15, 4 * 60),
	high: target(30, 8 * 60),
	medium: target(60, 24 * 60),
	low: target(4 * 60, 48 * 60),
}

const policy = (n: number, fields: Partial<PolicyRow>): PolicyRow => ({
	id: policyId(n),
	name: `Policy ${n}`,
	position: n,
	enabled: true,
	appliesTo: none,
	targets: Customers.DEFAULT_SLA_POLICY.targets,
	hours: "business",
	warnBeforePct: 25,
	...fields,
})

const enterprise = policy(0, {
	name: "Enterprise",
	appliesTo: { ...none, planNames: ["Enterprise"] },
	targets: fast,
	hours: "always",
})
const vips = policy(1, { name: "VIP", appliesTo: { ...none, tagsAny: ["vip"], accountIds: [accountId(1)] } })
const legacy = policy(2, { name: "Legacy", enabled: false, appliesTo: { ...none, planNames: ["Legacy"] } })
const standard = policy(3, { name: "Standard" })
const POLICIES = [enterprise, vips, legacy, standard]

const ACCOUNTS = [
	{ id: accountId(1), name: "Acme", domain: "acme.test" },
	{ id: accountId(2), name: "Globex", domain: "globex.test" },
	{ id: accountId(3), name: "Initech", domain: null },
]

const formOf = (model: Model): PolicyForm => {
	if (model.editor === null) throw new Error("The editor is closed")
	return model.editor.form
}

const step = (shared: Shared) => (current: Model, next: Message) => update(current, next, shared).model

const loaded = (shared: Shared = admin): Model =>
	[
		Message.UpdatedPolicies({ policies: POLICIES }),
		Message.UpdatedSettings({
			settings: { settingsId, businessHours: Customers.DEFAULT_BUSINESS_HOURS },
		}),
		Message.UpdatedAccounts({ accounts: ACCOUNTS }),
		Message.SucceededFetchPlans({ plans: ["Enterprise", "Pro", "Legacy"] }),
	].reduce(step(shared), init(null, shared).model)

describe("SLA settings: the policies", () => {
	test("fetches the plans on open", () => {
		expect(init(null, admin).commands?.[0]).toMatchObject({
			name: FetchSlaPlans.name,
			args: { organizationId },
		})
	})

	test("a failed plans fetch is kept as a failure and can be retried", () => {
		const failed = step(admin)(loaded(), Message.FailedFetchPlans({ reason: "Offline" }))
		expect(failed.plans._tag).toBe("Failure")
		const retried = update(failed, Message.PressedRetryPlans(), admin)
		expect(retried.model.plans._tag).toBe("Loading")
		expect(retried.commands?.[0]).toMatchObject({ name: FetchSlaPlans.name })
		expect(update(retried.model, Message.PressedRetryPlans(), admin).commands ?? []).toHaveLength(0)
	})

	test("each row says whom it covers and its medium targets", () => {
		expect(POLICIES.map((row) => appliesToSummary(row.appliesTo, ACCOUNTS))).toEqual([
			"Plans: Enterprise",
			"Tags: vip · Acme",
			"Plans: Legacy",
			"Default · any customer",
		])
		expect(
			appliesToSummary({ ...none, accountIds: [accountId(1), accountId(2), accountId(3)] }, ACCOUNTS),
		).toBe("3 customers")
		expect(mediumTargetHint(standard.targets)).toBe("Medium: 4h reply · 24h resolve")
		expect(mediumTargetHint(enterprise.targets)).toBe("Medium: 1h reply · 24h resolve")
	})

	test("moving a policy sends the whole order; one list write at a time", () => {
		const moved = update(loaded(), Message.PressedMove({ policyId: standard.id, offset: -1 }), admin)
		expect(moved.model.policies?.map((row) => row.name)).toEqual([
			"Enterprise",
			"VIP",
			"Standard",
			"Legacy",
		])
		expect(moved.commands?.[0]).toMatchObject({
			name: ReorderSlaPolicies.name,
			args: { organizationId, policyIds: [enterprise.id, vips.id, standard.id, legacy.id] },
		})
		expect(
			update(moved.model, Message.PressedMove({ policyId: vips.id, offset: 1 }), admin).commands ?? [],
		).toHaveLength(0)
		const done = update(moved.model, Message.SucceededReorder(), admin).model
		expect(
			update(done, Message.PressedMove({ policyId: enterprise.id, offset: -1 }), admin).commands ?? [],
		).toHaveLength(0)
	})

	test("the switch saves the policy with enabled flipped", () => {
		const toggled = update(loaded(), Message.ToggledPolicy({ policyId: legacy.id, enabled: true }), admin)
		expect(toggled.commands?.[0]).toMatchObject({
			name: ToggleSlaPolicy.name,
			args: { policyId: legacy.id, policy: { name: "Legacy", enabled: true, hours: "business" } },
		})
	})
})

describe("SLA settings: the editor", () => {
	test("an example line shows when a medium-priority message is due, in the policy's hours", () => {
		const editing = update(loaded(), Message.PressedEdit({ policyId: standard.id }), admin).model
		const hours = Customers.DEFAULT_BUSINESS_HOURS
		expect(editing.editor?.form.targets.medium.firstResponse).toEqual({ amount: "4", unit: "hours" })
		expect(exampleLine(formOf(editing), hours)).toBe(
			"A medium-priority message on Friday 16:50 is due Monday 12:50.",
		)
		const always = update(editing, Message.ClickedHours({ hours: "always" }), admin).model
		expect(exampleLine(formOf(always), hours)).toBe(
			"A medium-priority message on Friday 16:50 is due Friday 20:50.",
		)
		const enterpriseForm = update(loaded(), Message.PressedEdit({ policyId: enterprise.id }), admin).model
		expect(exampleLine(formOf(enterpriseForm), hours)).toBe(
			"A medium-priority message on Friday 16:50 is due Friday 17:50.",
		)
	})

	test("a new policy is validated, then created with its scope", () => {
		const opened = update(loaded(), Message.PressedNewPolicy(), admin).model
		const invalid = update(opened, Message.PressedSavePolicy(), admin)
		expect(invalid.commands ?? []).toHaveLength(0)
		expect(invalid.model.editor?.showErrors).toBe(true)
		const filled = [
			Message.ChangedName({ value: "Pro" }),
			Message.ToggledPlan({ plan: "Pro" }),
			Message.ChangedTagInput({ value: "priority" }),
			Message.PressedAddTag(),
			Message.ChangedAccountSearch({ value: "glob" }),
			Message.AddedAccount({ accountId: accountId(2) }),
			Message.ChangedTargetAmount({ priority: "medium", clock: "firstResponse", value: "90" }),
			Message.GotSelectMessage({
				selectId: "sla-unit-medium-firstResponse",
				message: Select.Message.ChoseFromNativeMenu({
					key: "minutes",
					items: [Select.item("minutes", "minutes")],
				}),
			}),
		].reduce(step(admin), invalid.model)
		const saved = update(filled, Message.PressedSavePolicy(), admin)
		expect(saved.commands?.[0]).toMatchObject({
			name: CreateSlaPolicy.name,
			args: {
				organizationId,
				policy: {
					name: "Pro",
					appliesTo: { planNames: ["Pro"], tagsAny: ["priority"], accountIds: [accountId(2)] },
					targets: { medium: { firstResponseMinutes: 90 } },
				},
			},
		})
	})
})

describe("SLA settings: business hours", () => {
	test("no working day, or an end before the start, shows an error and does not save", () => {
		const noDays = [1, 2, 3, 4, 5].map((day) => Message.ToggledDay({ day })).reduce(step(admin), loaded())
		expect(hoursErrors(hoursFormOf(noDays)).days).toBe("Pick at least one working day")
		expect(update(noDays, Message.PressedSaveHours(), admin).commands ?? []).toHaveLength(0)

		const backwards = update(loaded(), Message.ChangedEnd({ value: "08:00" }), admin).model
		expect(hoursErrors(hoursFormOf(backwards)).time).toBe("Hours must end after they start")
		expect(update(backwards, Message.PressedSaveHours(), admin).commands ?? []).toHaveLength(0)
	})

	test("valid hours save, days in order", () => {
		const edited = [
			Message.ToggledDay({ day: 6 }),
			Message.ToggledDay({ day: 1 }),
			Message.ChangedEnd({ value: "18:30" }),
		].reduce(step(admin), loaded())
		expect(update(edited, Message.PressedSaveHours(), admin).commands?.[0]).toMatchObject({
			name: SaveBusinessHours.name,
			args: {
				settingsId,
				businessHours: { timeZone: "UTC", days: [2, 3, 4, 5, 6], start: "09:00", end: "18:30" },
			},
		})
	})
})

describe("SLA settings: saving hours", () => {
	test("reset does nothing while a save is in flight", () => {
		const edited = step(admin)(loaded(), Message.ChangedEnd({ value: "18:30" }))
		const saving = update(edited, Message.PressedSaveHours(), admin).model
		expect(saving.isSavingHours).toBe(true)
		expect(update(saving, Message.PressedResetHours(), admin).model.hoursForm).toEqual(saving.hoursForm)
	})
})

describe("SLA settings: members", () => {
	test("see everything read-only", () => {
		const model = loaded(member)
		for (const message of [
			Message.ToggledPolicy({ policyId: legacy.id, enabled: true }),
			Message.PressedMove({ policyId: standard.id, offset: -1 }),
			Message.PressedNewPolicy(),
			Message.PressedDelete({ policyId: legacy.id }),
			Message.ToggledDay({ day: 6 }),
			Message.PressedSaveHours(),
		]) {
			const result = update(model, message, member)
			expect(result.commands ?? []).toHaveLength(0)
			expect(result.model.policies).toEqual(model.policies)
			expect(result.model.hoursForm).toBeNull()
			expect(result.model.editor).toBeNull()
		}
		const viewing = update(model, Message.PressedEdit({ policyId: standard.id }), member).model
		expect(viewing.editor?.form.name).toBe("Standard")
		const typed = update(viewing, Message.ChangedName({ value: "Mine" }), member).model
		expect(typed.editor?.form.name).toBe("Standard")
		expect(update(typed, Message.PressedSavePolicy(), member).commands ?? []).toHaveLength(0)
	})
})
