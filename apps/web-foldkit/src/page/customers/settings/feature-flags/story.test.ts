import { CustomerAccountId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { AccountRow } from "../../../../customers/queries"
import * as Popover from "../../../../ui/popover"
import type { Shared } from "../../../contract"
import { sharedDefaults } from "../../../test-shared"
import { CreateFeatureFlag, DeleteFeatureFlag, SetFeatureFlagCustomers } from "./commands"
import { Message } from "./message"
import { customersWith, flagKeysOf, type Model } from "./model"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the feature flags settings: the listed flags, creating, deleting and assigning. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const userId = Schema.decodeSync(UserId)(uuid(4))
const accountId = Schema.decodeSync(CustomerAccountId)

const sharedAs = (role: "admin" | "member"): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: userId,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(5)), role },
	nowMs: Date.UTC(2026, 10, 10, 12),
	...sharedDefaults,
})
const admin = sharedAs("admin")

const account = (n: number, featureFlags: Record<string, boolean>): AccountRow => ({
	id: accountId(uuid(100 + n)),
	name: `Customer ${n}`,
	domain: null,
	logoUrl: null,
	ownerUserId: null,
	lifecycleStage: "active",
	planName: null,
	mrrMinor: 0,
	currency: "usd",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	healthScore: null,
	healthStatus: "unknown",
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 0,
	organizationCount: 1,
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
})
const one = account(1, { beta: true, legacy: false })
const two = account(2, {})

const loaded = (): Model =>
	[Message.UpdatedCreated({ keys: ["new_nav"] }), Message.UpdatedAccounts({ accounts: [one, two] })].reduce(
		(current, next) => update(current, next, admin).model,
		init().model,
	)

describe("feature flags settings", () => {
	test("lists the created flags and every key the customers hold, on or off", () => {
		const model = loaded()
		expect(flagKeysOf(model)).toEqual(["beta", "legacy", "new_nav"])
		expect(customersWith(model, "beta").map((row) => row.id)).toEqual([one.id])
		expect(customersWith(model, "legacy")).toEqual([])
	})

	test("creates a valid new key, and refuses an invalid one", () => {
		const typed = update(loaded(), Message.ChangedNewKey({ value: " ai-search " }), admin).model
		const created = update(typed, Message.SubmittedNewKey(), admin)
		expect(created.commands?.[0]).toMatchObject({
			name: CreateFeatureFlag.name,
			args: { organizationId, key: "ai-search", createdBy: userId },
		})
		expect(created.model.selectedKey).toBe("ai-search")
		const bad = update(loaded(), Message.ChangedNewKey({ value: "has space" }), admin).model
		expect(update(bad, Message.SubmittedNewKey(), admin).commands ?? []).toHaveLength(0)
	})

	test("adds the ticked customers at once, and removes one", () => {
		const selected = [
			Message.PressedFlag({ key: "new_nav" }),
			Message.ToggledCustomer({ accountId: one.id, isSelected: true }),
			Message.ToggledCustomer({ accountId: two.id, isSelected: true }),
		].reduce((current, next) => update(current, next, admin).model, loaded())
		const added = update(selected, Message.PressedAddCustomers(), admin)
		expect(added.commands?.at(-1)).toMatchObject({
			name: SetFeatureFlagCustomers.name,
			args: { organizationId, key: "new_nav", accountIds: [one.id, two.id], enabled: true },
		})
		expect(added.model.customerSelection).toEqual([])
		expect(
			update(added.model, Message.PressedRemoveCustomer({ accountId: one.id }), admin).commands?.[0],
		).toMatchObject({ args: { key: "new_nav", accountIds: [one.id], enabled: false } })
	})

	test("closing the picker unsubmitted drops its ticks and search", () => {
		const opened = [
			Message.PressedFlag({ key: "new_nav" }),
			Message.GotCustomerPopoverMessage({ message: Popover.Message.RequestedOpen() }),
			Message.ChangedCustomerSearch({ value: "Customer" }),
			Message.ToggledCustomer({ accountId: one.id, isSelected: true }),
		].reduce((current, next) => update(current, next, admin).model, loaded())
		expect(opened.customerSelection).toEqual([one.id])
		const closed = update(
			opened,
			Message.GotCustomerPopoverMessage({ message: Popover.Message.RequestedClose() }),
			admin,
		).model
		expect(closed.customerSelection).toEqual([])
		expect(closed.customerSearch).toBe("")
	})

	test("deletes after the confirmation; members change nothing", () => {
		const asked = update(loaded(), Message.PressedDeleteFlag({ key: "beta" }), admin).model
		expect(update(asked, Message.PressedConfirmDelete(), admin).commands?.[0]).toMatchObject({
			name: DeleteFeatureFlag.name,
			args: { organizationId, key: "beta" },
		})
		const member = sharedAs("member")
		expect(update(asked, Message.PressedConfirmDelete(), member).commands ?? []).toHaveLength(0)
		const typed = update(loaded(), Message.ChangedNewKey({ value: "beta2" }), member).model
		expect(update(typed, Message.SubmittedNewKey(), member).commands ?? []).toHaveLength(0)
	})
})
