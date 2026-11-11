import { CustomerSettingsId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { Shared } from "../../../contract"
import { sharedDefaults } from "../../../test-shared"
import { FetchPlans, SaveAddOnPlans } from "./commands"
import { Message } from "./message"
import { type Model, planNamesOf } from "./model"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the plans settings: the listed plans, and marking add-ons. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const settingsId = Schema.decodeSync(CustomerSettingsId)(uuid(2))

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
	nowMs: Date.UTC(2026, 10, 10, 12),
	...sharedDefaults,
})
const admin = sharedAs("admin")

const loaded = (addOnPlans: ReadonlyArray<string> = []): Model =>
	[
		Message.UpdatedSettings({ settings: { id: settingsId, addOnPlans } }),
		Message.SucceededFetchPlans({ plans: ["Starter", "BYOK", "Pro"] }),
	].reduce((current, next) => update(current, next, admin).model, init(null, admin).model)

describe("plans settings", () => {
	test("fetches the plans on open, and lists them with saved add-ons no subscription carries", () => {
		expect(init(null, admin).commands?.[0]).toMatchObject({
			name: FetchPlans.name,
			args: { organizationId },
		})
		expect(planNamesOf(loaded(["Legacy add-on"]))).toEqual(["BYOK", "Legacy add-on", "Pro", "Starter"])
	})

	test("a switch saves the whole add-on list at once", () => {
		const marked = update(
			loaded(["Legacy add-on"]),
			Message.ToggledAddOn({ plan: "BYOK", isAddOn: true }),
			admin,
		)
		expect(marked.model.settings?.addOnPlans).toEqual(["Legacy add-on", "BYOK"])
		expect(marked.commands?.[0]).toMatchObject({
			name: SaveAddOnPlans.name,
			args: { organizationId, settingsId, addOnPlans: ["Legacy add-on", "BYOK"] },
		})
		const unmarked = update(
			marked.model,
			Message.ToggledAddOn({ plan: "Legacy add-on", isAddOn: false }),
			admin,
		)
		expect(unmarked.commands?.[0]).toMatchObject({ args: { addOnPlans: ["BYOK"] } })
	})

	test("members cannot change add-ons", () => {
		const toggled = update(
			loaded(),
			Message.ToggledAddOn({ plan: "BYOK", isAddOn: true }),
			sharedAs("member"),
		)
		expect(toggled.commands ?? []).toHaveLength(0)
		expect(toggled.model.settings?.addOnPlans).toEqual([])
	})
})
