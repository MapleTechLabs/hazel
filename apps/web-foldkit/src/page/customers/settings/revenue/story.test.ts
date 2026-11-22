import type * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { describe, expect, test, vi } from "vitest"
import * as Select from "../../../../ui/select"
import type { Shared } from "../../../contract"
import { sharedDefaults } from "../../../test-shared"
import {
	DelayRevenuePreview,
	FetchRevenueCatalog,
	FetchRevenuePreview,
	SaveRevenueSettings,
} from "./commands"
import { Message } from "./message"
import {
	draftOf,
	isDirty,
	type Model,
	restatesHistory,
	type SelectTarget,
	selectIdOf,
	validOf,
} from "./model"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the revenue settings: editing and reordering rules, the preview, saving. */

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

const RULES: ReadonlyArray<Customers.RevenueRule> = [
	{
		id: "rule-1",
		name: "Storage",
		conditions: [{ field: "product", values: ["prod_storage"] }],
		classification: "recurring",
	},
	{
		id: "rule-2",
		name: "Pass-through",
		conditions: [{ field: "metadata", key: "kind", values: ["pass_through"] }],
		classification: "excluded",
	},
]

const SETTINGS = {
	id: settingsId,
	revenueRules: RULES,
	variableMrrMonths: 3,
	reportingCurrency: "USD",
}

const PREVIEW: Customers.RevenuePreviewResult = {
	currency: "USD",
	current: { mrrMinor: 100_000, variableMrrMinor: 20_000 },
	proposed: { mrrMinor: 90_000, variableMrrMinor: 30_000 },
	groups: [],
}

const step = (model: Model, message: Message, shared: Shared = admin): Model =>
	update(model, message, shared).model

const loaded = (): Model => step(init(null, admin).model, Message.UpdatedSettings({ settings: SETTINGS }))

const commandNames = (result: ReturnType<typeof update>) =>
	(result.commands ?? []).map((command) => command.name)

/** Opens the Select and clicks its option, as a press on each would. */
const picked = (model: Model, target: SelectTarget, key: string): ReturnType<typeof update> => {
	const selectId = selectIdOf(target)
	const open = step(
		model,
		Message.GotSelectMessage({
			selectId,
			message: Select.Message.PressedTrigger({ pointerType: "mouse" }),
		}),
	)
	return update(
		open,
		Message.GotSelectMessage({
			selectId,
			message: Select.Message.ClickedOption({ key, items: [Select.item(key, key)] }),
		}),
		admin,
	)
}

describe("revenue settings", () => {
	test("opens by fetching the catalog, and previews the saved rules once they sync", () => {
		const opened = init(null, admin)
		expect(opened.commands?.[0]).toMatchObject({
			name: FetchRevenueCatalog.name,
			args: { organizationId },
		})
		const synced = update(opened.model, Message.UpdatedSettings({ settings: SETTINGS }), admin)
		expect(commandNames(synced)).toEqual([DelayRevenuePreview.name])
		const fetched = update(
			synced.model,
			Message.ElapsedRevenuePreviewDelay({ version: synced.model.preview.version }),
			admin,
		)
		expect(fetched.commands?.[0]).toMatchObject({
			name: FetchRevenuePreview.name,
			args: { organizationId, variableMrrMonths: 3, rules: RULES },
		})
	})

	test("editing a rule: its class and a new condition; an incomplete rule pauses the preview", () => {
		const reclassed = picked(loaded(), { _tag: "Class", ruleId: "rule-1" }, "variable")
		expect(draftOf(reclassed.model)?.rules[0]?.classification).toBe("variable")
		expect(commandNames(reclassed)).toContain(DelayRevenuePreview.name)

		const incomplete = update(reclassed.model, Message.PressedAddCondition({ ruleId: "rule-1" }), admin)
		expect(draftOf(incomplete.model)?.rules[0]?.conditions).toHaveLength(2)
		expect(validOf(draftOf(incomplete.model)!)).toBeNull()
		expect(AsyncData.isIdle(incomplete.model.preview.result)).toBe(true)
		expect(commandNames(incomplete)).toEqual([])

		const completed = update(
			incomplete.model,
			Message.ToggledValue({ ruleId: "rule-1", index: 1, value: "prod_api" }),
			admin,
		)
		expect(validOf(draftOf(completed.model)!)).not.toBeNull()
		expect(commandNames(completed)).toEqual([DelayRevenuePreview.name])
	})

	test("changing a condition's field starts its values over; metadata takes a key and typed values", () => {
		const field = picked(loaded(), { _tag: "Field", ruleId: "rule-1", index: 0 }, "metadata").model
		expect(draftOf(field)?.rules[0]?.conditions[0]).toEqual({ field: "metadata", key: "", values: [] })
		const at = { ruleId: "rule-1", index: 0 }
		const typed = [
			Message.ChangedMetadataKey({ ...at, key: "plan" }),
			Message.ChangedValueEntry({ ...at, text: " gold " }),
			Message.SubmittedValueEntry(at),
		].reduce((model, message) => step(model, message), field)
		expect(draftOf(typed)?.rules[0]?.conditions[0]).toEqual({
			field: "metadata",
			key: "plan",
			values: ["gold"],
		})
		expect(typed.valueEntries).toEqual({})
	})

	test("rules reorder, stop at the ends, and moving back leaves no draft", () => {
		const moved = step(loaded(), Message.PressedMoveRule({ ruleId: "rule-2", step: -1 }))
		expect(draftOf(moved)?.rules.map((rule) => rule.id)).toEqual(["rule-2", "rule-1"])
		expect(restatesHistory(moved)).toBe(true)
		const atTop = step(moved, Message.PressedMoveRule({ ruleId: "rule-2", step: -1 }))
		expect(draftOf(atTop)?.rules.map((rule) => rule.id)).toEqual(["rule-2", "rule-1"])
		const back = step(moved, Message.PressedMoveRule({ ruleId: "rule-2", step: 1 }))
		expect(back.draft).toBeNull()
		expect(isDirty(back)).toBe(false)
	})

	test("the preview answers the latest draft only", () => {
		const first = step(loaded(), Message.PressedDeleteRule({ ruleId: "rule-1" }))
		const staleVersion = first.preview.version
		const second = step(first, Message.PressedAddRule())
		const added = draftOf(second)?.rules.at(-1)?.id ?? ""
		const third = step(second, Message.ToggledValue({ ruleId: added, index: 0, value: "prod_api" }))
		const stale = step(
			third,
			Message.SucceededFetchRevenuePreview({ version: staleVersion, result: PREVIEW }),
		)
		expect(AsyncData.isSuccess(stale.preview.result)).toBe(false)
		const fresh = step(
			third,
			Message.SucceededFetchRevenuePreview({ version: third.preview.version, result: PREVIEW }),
		)
		expect(AsyncData.isSuccess(fresh.preview.result)).toBe(true)
	})

	test("a change of the rules asks first, then saves them and the window", () => {
		const edited = picked(loaded(), { _tag: "Window" }, "6").model
		const asked = update(edited, Message.PressedSave(), admin)
		expect(asked.model.confirmModal.isOpen).toBe(true)
		expect(commandNames(asked)).toEqual([])

		const saving = update(asked.model, Message.PressedConfirmSave(), admin)
		expect(saving.model.isSaving).toBe(true)
		expect(saving.model.confirmModal.isOpen).toBe(false)
		expect(saving.commands?.[0]).toMatchObject({
			name: SaveRevenueSettings.name,
			args: { organizationId, settingsId, rules: RULES, variableMrrMonths: 6 },
		})

		const synced = step(
			saving.model,
			Message.UpdatedSettings({ settings: { ...SETTINGS, variableMrrMonths: 6 } }),
		)
		expect(synced.draft).not.toBeNull()
		const done = update(synced, Message.SucceededSaveRevenueSettings(), admin)
		expect(done.model.draft).toBeNull()
		expect(done.model.isSaving).toBe(false)
		expect(done.outMessage).toBeDefined()
	})

	test("a rename restates nothing: it saves without asking and without a new preview", () => {
		const renamed = update(
			loaded(),
			Message.ChangedRuleName({ ruleId: "rule-1", name: "Committed storage" }),
			admin,
		)
		expect(commandNames(renamed)).toEqual([])
		expect(restatesHistory(renamed.model)).toBe(false)
		const saved = update(renamed.model, Message.PressedSave(), admin)
		expect(saved.model.confirmModal.isOpen).toBe(false)
		expect(commandNames(saved)).toEqual([SaveRevenueSettings.name])
	})

	test("a failed save keeps the draft to try again", () => {
		const edited = step(loaded(), Message.PressedDeleteRule({ ruleId: "rule-1" }))
		const saving = step(step(edited, Message.PressedSave()), Message.PressedConfirmSave())
		const failed = update(saving, Message.FailedSaveRevenueSettings({ reason: "Unavailable" }), admin)
		expect(failed.model.isSaving).toBe(false)
		expect(draftOf(failed.model)?.rules.map((rule) => rule.id)).toEqual(["rule-2"])
		expect(failed.outMessage).toBeDefined()
	})

	test("removing a condition keeps what is typed in the others, under their new position", () => {
		const two = step(loaded(), Message.PressedAddCondition({ ruleId: "rule-2" }))
		const typed = step(
			step(two, Message.ChangedValueEntry({ ruleId: "rule-2", index: 0, text: "gold" })),
			Message.ChangedValueEntry({ ruleId: "rule-2", index: 1, text: "silver" }),
		)
		const removed = step(typed, Message.PressedRemoveCondition({ ruleId: "rule-2", index: 0 }))
		expect(removed.valueEntries).toEqual({ "rule-2:0": "silver" })
	})

	test("Save takes a value still typed in its input, and leaves the input empty", () => {
		const typed = step(
			step(loaded(), Message.ChangedValueEntry({ ruleId: "rule-2", index: 0, text: " gold " })),
			Message.ChangedRuleName({ ruleId: "rule-2", name: "Metals" }),
		)
		const asked = update(typed, Message.PressedSave(), admin)
		expect(asked.model.confirmModal.isOpen).toBe(true)
		expect(commandNames(asked)).toEqual([DelayRevenuePreview.name])
		const saving = update(asked.model, Message.PressedConfirmSave(), admin)
		expect(saving.commands?.[0]).toMatchObject({
			name: SaveRevenueSettings.name,
			args: {
				rules: [
					expect.anything(),
					{ conditions: [{ key: "kind", values: ["pass_through", "gold"] }] },
				],
			},
		})
		expect(saving.model.valueEntries).toEqual({})
	})

	test("members cannot change anything", () => {
		const member = sharedAs("member")
		const model = loaded()
		const deleted = update(model, Message.PressedDeleteRule({ ruleId: "rule-1" }), member)
		expect(deleted.model.draft).toBeNull()
		expect(deleted.commands ?? []).toHaveLength(0)
		const edited = step(model, Message.PressedDeleteRule({ ruleId: "rule-1" }))
		const saving = update(step(edited, Message.PressedSave()), Message.PressedConfirmSave(), member)
		expect(saving.commands ?? []).toHaveLength(0)
	})
})
