import type { RuleDryRunResult } from "@hazel/domain/customers"
import { CustomerSignalRuleId, OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import { AppRoute } from "../../../../route"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { sharedDefaults } from "../../../test-shared"
import {
	CreateSignalRule,
	FetchRuleDryRun,
	ToggleSignalRule,
	UpdateSignalRule,
	WaitForRuleDryRunDelay,
} from "./commands"
import { draftOf, editorStatus } from "./draft"
import { Message } from "./message"
import type { Model, RuleRow } from "./model"
import { init, routeChanged, type SignalsRoute, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for signals settings: the form, the debounced preview, saving, the list's switch. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const ruleId = Schema.decodeSync(CustomerSignalRuleId)(uuid(2))
const newRuleId = Schema.decodeSync(CustomerSignalRuleId)(uuid(3))

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(4)), role: "admin" },
	nowMs: Date.UTC(2026, 10, 10, 12),
	...sharedDefaults,
}

const inactiveRule: RuleRow = {
	id: ruleId,
	name: "Stopped logging in",
	template: "inactive",
	kind: "risk",
	severity: "medium",
	config: { _tag: "inactive", inactiveDays: 14, priorWindowDays: 30, minPriorActiveUsers: 1 },
	scope: { lifecycleStages: ["active"] },
	enabled: true,
	lastTriggeredAtMs: null,
	matchingCount: 5,
	updatedAtMs: shared.nowMs,
}

const result: RuleDryRunResult = {
	matchCount: 7,
	mrrMinor: 804_000,
	currency: "USD",
	topMatches: [],
	nonMatches: [{ reason: "Below threshold", count: 200 }],
	queueDelta: { opens: 2, resolves: 0, stays: 5 },
	missingSources: [],
}

const pageUpdate = (current: Model, next: Message) => update(current, next, shared)

const listRoute = AppRoute.CustomersSettingsSignals({ orgSlug: "hazel" }) as SignalsRoute
const ruleRoute = AppRoute.CustomersSettingsSignalRule({ orgSlug: "hazel", ruleId }) as SignalsRoute
const newRoute = (template: RuleRow["template"]) =>
	AppRoute.CustomersSettingsSignalNew({ orgSlug: "hazel", template: Option.some(template) }) as SignalsRoute

const withRules = (route: SignalsRoute): Model => {
	const opened = init(route, shared).model
	return pageUpdate(opened, Message.UpdatedRules({ rules: [inactiveRule] })).model
}

const formOf = (current: Model) => {
	const form = current.editor?.form
	if (form === undefined || form === null) throw new Error("no form")
	return form
}
const draftOfModel = (current: Model) => Option.getOrThrow(draftOf(formOf(current), "USD"))
const names = (commands: ReadonlyArray<{ readonly name: string }> | undefined) =>
	(commands ?? []).map((command) => command.name)

const edits = (current: Model, messages: ReadonlyArray<Message>): Model =>
	messages.reduce((next, step) => pageUpdate(next, step).model, current)

describe("signals: the form builds the draft", () => {
	test("inactive thresholds and the scope", () => {
		const current = edits(withRules(ruleRoute), [
			Message.ChangedConfigNumber({ key: "inactiveDays", value: "21" }),
			Message.ToggledScopeStage({ stage: "past_due" }),
			Message.AddedScopeCondition({ condition: "mrr" }),
			Message.ChangedScopeMrr({ value: "100" }),
			Message.ClickedSeverity({ severity: "high" }),
		])
		expect(draftOfModel(current)).toEqual({
			name: "Stopped logging in",
			severity: "high",
			config: { _tag: "inactive", inactiveDays: 21, priorWindowDays: 30, minPriorActiveUsers: 1 },
			scope: { lifecycleStages: ["active", "past_due"], minMrrMinor: 10_000 },
			enabled: true,
		})
		const editor = current.editor!
		expect(editorStatus(current, editor, formOf(current)).changes).toBe(4)
	})

	test("a new usage rule: metric, windows, drop", () => {
		const current = edits(init(newRoute("usage_drop"), shared).model, [
			Message.ClickedMetric({ metricKey: "product_events" }),
			Message.ChangedConfigNumber({ key: "recentDays", value: "14" }),
			Message.ChangedConfigNumber({ key: "dropPct", value: "45" }),
		])
		expect(draftOfModel(current).config).toEqual({
			_tag: "usage_drop",
			metricKey: "product_events",
			recentDays: 14,
			baselineDays: 28,
			dropPct: 45,
		})
	})

	test("flags and metric lists", () => {
		const cancel = edits(init(newRoute("cancel_scheduled"), shared).model, [
			Message.ToggledConfigFlag({ key: "includeDowngrades", isOn: false }),
		])
		expect(draftOfModel(cancel).config).toEqual({
			_tag: "cancel_scheduled",
			includeDowngrades: false,
			downgradeWindowDays: 14,
		})
		const limit = edits(init(newRoute("near_limit"), shared).model, [
			Message.ToggledLimitMetric({ metricKey: "seats" }),
			Message.ToggledLimitMetric({ metricKey: "credits" }),
			Message.ToggledLimitMetric({ metricKey: "seats" }),
		])
		expect(draftOfModel(limit).config).toEqual({
			_tag: "near_limit",
			thresholdPct: 90,
			metricKeys: ["credits"],
		})
	})

	test("a value outside the schema's bounds is a field error: no dry run, no save", () => {
		const opened = withRules(ruleRoute)
		const invalid = pageUpdate(opened, Message.ChangedConfigNumber({ key: "inactiveDays", value: "0" }))
		expect(invalid.commands ?? []).toHaveLength(0)
		const editor = invalid.model.editor!
		const status = editorStatus(invalid.model, editor, formOf(invalid.model))
		expect(status.errors).toEqual({ "config.inactiveDays": "Whole days, 1 to 365" })
		expect(status.canSave).toBe(false)
		expect(pageUpdate(invalid.model, Message.PressedSave()).commands ?? []).toHaveLength(0)
		expect(
			pageUpdate(invalid.model, Message.ElapsedRuleDryRunDelay({ version: editor.version })).commands ??
				[],
		).toHaveLength(0)
		const blank = pageUpdate(opened, Message.ChangedName({ value: "  " })).model
		expect(Object.keys(editorStatus(blank, blank.editor!, formOf(blank)).errors)).toEqual(["name"])
	})
})

describe("signals: the live preview", () => {
	test("opening a rule dry-runs it at once, with its id", () => {
		const opened = init(ruleRoute, shared)
		expect(names(opened.commands)).toEqual([])
		const loaded = pageUpdate(opened.model, Message.UpdatedRules({ rules: [inactiveRule] }))
		expect(loaded.model.editor?.preview._tag).toBe("Loading")
		const [command] = loaded.commands ?? []
		expect(command?.name).toBe(FetchRuleDryRun.name)
		expect(command && "args" in command ? command.args : null).toEqual({
			organizationId,
			version: 1,
			draft: {
				name: "Stopped logging in",
				severity: "medium",
				config: inactiveRule.config,
				scope: inactiveRule.scope,
				enabled: true,
			},
			ruleId,
		})
	})

	test("an answer for the rule left before is dropped, though both editors start fresh", () => {
		const first = withRules(ruleRoute)
		const firstVersion = first.editor?.version ?? -1
		const listed = routeChanged(first, listRoute, shared).model
		const second = routeChanged(listed, ruleRoute, shared).model
		expect(second.editor?.version).toBeGreaterThan(firstVersion)
		const stale = pageUpdate(second, Message.SucceededFetchDryRun({ version: firstVersion, result }))
		expect(stale.model.editor?.preview._tag).not.toBe("Success")
	})

	test("edits debounce; only the latest version's answer lands", () => {
		const opened = pageUpdate(
			withRules(ruleRoute),
			Message.SucceededFetchDryRun({ version: 1, result }),
		).model
		const first = pageUpdate(opened, Message.ChangedConfigNumber({ key: "inactiveDays", value: "20" }))
		expect(first.commands?.map((command) => ("args" in command ? command.args : null))).toEqual([
			{ version: 2 },
		])
		expect(names(first.commands)).toEqual([WaitForRuleDryRunDelay.name])
		const second = pageUpdate(
			first.model,
			Message.ChangedConfigNumber({ key: "inactiveDays", value: "21" }),
		)
		// The first pause ends after a newer edit: nothing runs.
		expect(
			pageUpdate(second.model, Message.ElapsedRuleDryRunDelay({ version: 2 })).commands ?? [],
		).toHaveLength(0)
		story(
			pageUpdate,
			given(second.model),
			message(Message.ElapsedRuleDryRunDelay({ version: 3 })),
			model((current) => expect(current.editor?.preview._tag).toBe("Refreshing")),
			Command.expectExact(
				FetchRuleDryRun({
					organizationId,
					version: 3,
					draft: { ...draftOfModel(second.model) },
					ruleId,
				}),
			),
			Command.resolve(
				FetchRuleDryRun,
				Message.SucceededFetchDryRun({ version: 3, result: { ...result, matchCount: 9 } }),
			),
			// A slow answer for version 2 arrives late: dropped.
			message(Message.SucceededFetchDryRun({ version: 2, result: { ...result, matchCount: 3 } })),
			model((current) => {
				const preview = current.editor?.preview
				expect(preview?._tag).toBe("Success")
				expect(preview?._tag === "Success" ? preview.data.matchCount : null).toBe(9)
			}),
		)
	})
})

describe("signals: saving", () => {
	test("a new rule is created and opened by its id", () => {
		const opened = init(newRoute("seat_growth"), shared).model
		story(
			pageUpdate,
			given(opened),
			message(Message.PressedSave()),
			model((current) => expect(current.editor?.isSaving).toBe(true)),
			Command.expectExact(
				CreateSignalRule({
					organizationId,
					rule: {
						name: "Seats growing",
						severity: "low",
						config: { _tag: "seat_growth", growthPct: 50, windowDays: 30, minActiveUsers: 3 },
						scope: {},
						enabled: true,
					},
				}),
			),
			Command.resolve(CreateSignalRule, Message.SucceededCreateRule({ ruleId: newRuleId })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: AppRoute.CustomersSettingsSignalRule({ orgSlug: "hazel", ruleId: newRuleId }),
					replace: true,
					toast: {
						intent: "success",
						title: "Rule created",
						description: "It runs on the next hourly check.",
					},
				}),
			),
		)
	})

	test("a rule created after the editor was left does not open it", () => {
		const saving = pageUpdate(init(newRoute("seat_growth"), shared).model, Message.PressedSave()).model
		const left = routeChanged(saving, listRoute, shared).model
		const done = pageUpdate(left, Message.SucceededCreateRule({ ruleId: newRuleId }))
		expect(done.outMessage?._tag).toBe("RequestedToast")
	})

	test("an unchanged rule can't be saved; a changed one updates", () => {
		const opened = withRules(ruleRoute)
		expect(pageUpdate(opened, Message.PressedSave()).commands ?? []).toHaveLength(0)
		const turnedOff = pageUpdate(opened, Message.PressedToggleEnabled()).model
		story(
			pageUpdate,
			given(turnedOff),
			message(Message.PressedSave()),
			Command.expectExact(
				UpdateSignalRule({
					organizationId,
					ruleId,
					rule: {
						name: inactiveRule.name,
						severity: inactiveRule.severity,
						config: inactiveRule.config,
						scope: inactiveRule.scope,
						enabled: false,
					},
				}),
			),
			Command.resolve(UpdateSignalRule, Message.FailedUpdateRule({ ruleId, reason: "NotFound" })),
			model((current) => expect(current.editor?.isSaving).toBe(false)),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Couldn't save the rule",
						description: "The rule was deleted in the meantime.",
					},
				}),
			),
		)
	})

	test("closing with changes asks first; discarding goes back to the list", () => {
		const opened = withRules(ruleRoute)
		const clean = pageUpdate(opened, Message.PressedClose())
		expect(clean.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({ route: listRoute, replace: false }),
		)
		const edited = pageUpdate(opened, Message.ChangedName({ value: "Gone quiet" })).model
		const asking = pageUpdate(edited, Message.PressedClose())
		expect(asking.outMessage).toBeUndefined()
		expect(asking.model.discardModal.isOpen).toBe(true)
		const discarded = pageUpdate(asking.model, Message.PressedDiscard())
		expect(discarded.model.discardModal.isOpen).toBe(false)
		expect(discarded.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({ route: listRoute, replace: false }),
		)
	})
})

describe("signals: the list", () => {
	test("the switch flips at once and rolls back when the save fails", () => {
		const listed = withRules(listRoute)
		story(
			pageUpdate,
			given(listed),
			message(Message.ToggledRule({ ruleId, enabled: false })),
			model((current) => expect(current.rules?.[0]?.enabled).toBe(false)),
			Command.expectExact(
				ToggleSignalRule({
					organizationId,
					ruleId,
					rule: {
						name: inactiveRule.name,
						severity: inactiveRule.severity,
						config: inactiveRule.config,
						scope: inactiveRule.scope,
						enabled: false,
					},
				}),
			),
			Command.resolve(
				ToggleSignalRule,
				Message.FailedToggleRule({ ruleId, enabled: false, reason: "Offline" }),
			),
			model((current) => expect(current.rules?.[0]?.enabled).toBe(true)),
		)
	})

	test("Set up opens the editor for the picked template", () => {
		const picking = edits(withRules(listRoute), [
			Message.PressedNewSignal(),
			Message.ClickedTemplate({ template: "health_drop" }),
		])
		expect(picking.pickerModal.isOpen).toBe(true)
		expect(pageUpdate(picking, Message.PressedSetUpTemplate()).outMessage).toEqual(
			PageOutMessage.RequestedNavigation({ route: newRoute("health_drop"), replace: false }),
		)
	})
})
