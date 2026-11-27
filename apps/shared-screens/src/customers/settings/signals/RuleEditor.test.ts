// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { Navigate, ShowToast } from "../../../app/requests"
import { RuleEditorMessage } from "./editor-state"
import { CreateSignalRule, DeleteSignalRule, RuleEditorNoDeps, UpdateSignalRule } from "./RuleEditor"
import { button, byProp, feedKey, NOW, organizationId, rule, ruleId } from "./test-support"
import type { RuleEditorProps } from "./editor-state"

/** The rule editor: a new rule from a template, a saved rule, closing and deleting. */

const props = (overrides: Partial<RuleEditorProps> = {}): RuleEditorProps => ({
	organizationId,
	orgSlug: "hazel",
	role: "owner",
	ruleId: null,
	template: "payment_failed",
	nowMs: NOW,
	...overrides,
})

const saved = rule(2, "payment_failed", { name: "Payment failed" })
const screen = (title: string) => byProp("screen", "title", title)
const field = (label: string) => byProp("textField", "label", label)

/** A saved rule's editor once its rule and the settings have synced. */
const savedEditor = (role: RuleEditorProps["role"] = "owner") =>
	Scene.start(RuleEditorNoDeps, props({ ruleId: saved.id, template: null, role }))
		.subscription(feedKey("rules"), RuleEditorMessage.UpdatedRules({ rules: [saved] }))
		.subscription(feedKey("settings"), RuleEditorMessage.UpdatedSettings({ settings: null }))

/** What the field reports after typing `value` over the Model's latest edit. */
const typed = (s: { get: (locator: Locator.Locator) => Locator.Node }, label: string, value: string) => {
	const state = s.get(field(label)).props?.["value"] as { rev: number; edit: number }
	return { value, rev: state.rev + 1, edit: state.edit }
}

describe("rule editor", () => {
	test("a new rule starts from its template and creates it", () => {
		const s = Scene.start(RuleEditorNoDeps, props())
		s.expect(screen("Payment failing"))
			.toExist()
			.expect(byProp("badge", "label", "Not saved yet"))
			.toExist()
		s.fire(button("Create rule"), "press").expectExact(
			CreateSignalRule.make({
				organizationId,
				rule: {
					name: "Payment failing",
					severity: "high",
					config: { _tag: "payment_failed", overdueDays: 7 },
					scope: {},
					enabled: true,
				},
			}),
		)
		expect(s.get(button("Create rule")).props).toMatchObject({ loading: true })
		s.resolve(CreateSignalRule, RuleEditorMessage.SucceededCreateRule({ ruleId: ruleId(9) }))
			.expectExact(
				Navigate.make({
					href: `/hazel/customers/settings/signals/${ruleId(9)}`,
					replace: true,
					toast: {
						intent: "success",
						title: "Rule created",
						description: "It runs on the next hourly check.",
					},
				}),
			)
			.resolve(Navigate, Component.noop)
	})

	test("a saved rule waits for its row, then saves only what changed", () => {
		const s = Scene.start(RuleEditorNoDeps, props({ ruleId: saved.id, template: null }))
		s.expect(byProp("progress", "label", "Loading the rule…")).toExist()
		s.subscription(feedKey("rules"), RuleEditorMessage.UpdatedRules({ rules: [saved] }))
			.subscription(feedKey("settings"), RuleEditorMessage.UpdatedSettings({ settings: null }))
			.expect(screen("Payment failed"))
			.toExist()
		expect(s.get(button("Save rule")).props?.["disabled"]).toBe(true)
		s.fire(field("Name"), "change", typed(s, "Name", "Card declined"))
			.expect(byProp("badge", "label", "1 unsaved change"))
			.toExist()
			.fire(button("Save rule"), "press")
			.expectExact(
				UpdateSignalRule.make({
					organizationId,
					ruleId: saved.id,
					rule: {
						name: "Card declined",
						severity: "high",
						config: { _tag: "payment_failed", overdueDays: 7 },
						scope: {},
						enabled: true,
					},
				}),
			)
			.resolve(UpdateSignalRule, RuleEditorMessage.FailedUpdateRule({ reason: "NotFound" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Couldn't save the rule",
						description: "The rule was deleted in the meantime.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("a threshold that does not hold shows why and blocks the save", () => {
		const editor = savedEditor()
		const s = editor.fire(field("Days overdue"), "change", typed(editor, "Days overdue", "0"))
		expect(s.get(field("Days overdue")).props?.["error"]).toBe("Whole days, 1 to 90")
		expect(s.get(button("Save rule")).props?.["disabled"]).toBe(true)
	})

	test("closing with unsaved changes asks first", () => {
		const s = savedEditor()
			.fire(button("Close"), "press")
			.expectExact(Navigate.make({ href: "/hazel/customers/settings/signals", replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(button("Turn off"), "press")
			.fire(button("Cancel"), "press")
		expect(s.get(byProp("dialog", "title", "Discard changes?")).props?.["open"]).toBe(true)
		s.fire(button("Discard"), "press")
			.expectExact(Navigate.make({ href: "/hazel/customers/settings/signals", replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("deleting asks, then leaves for the list", () => {
		const s = savedEditor().fire(button("Delete rule"), "press")
		expect(s.get(byProp("dialog", "title", "Delete this rule?")).props?.["open"]).toBe(true)
		s.fire(confirmDelete, "press")
			.expectExact(DeleteSignalRule.make({ organizationId, ruleId: saved.id }))
			.resolve(DeleteSignalRule, RuleEditorMessage.SucceededDeleteRule())
			.expectExact(
				Navigate.make({
					href: "/hazel/customers/settings/signals",
					replace: false,
					toast: {
						intent: "success",
						title: "Rule deleted",
						description: "Its open items were resolved.",
					},
				}),
			)
			.resolve(Navigate, Component.noop)
	})

	test("a member looks but cannot change", () => {
		const s = savedEditor("member")
		s.expect(button("Save rule")).toBeAbsent().expect(button("Delete rule")).toBeAbsent()
		expect(s.get(field("Name")).props?.["disabled"]).toBe(true)
	})

	test("a rule that is gone says so", () => {
		Scene.start(RuleEditorNoDeps, props({ ruleId: saved.id, template: null }))
			.subscription(feedKey("rules"), RuleEditorMessage.UpdatedRules({ rules: [] }))
			.expect(screen("Rule not found"))
			.toExist()
	})
})

/** The dialog's own "Delete rule" (the card's opens it). */
const confirmDelete: Locator.Locator = {
	description: "the delete dialog's Delete rule",
	all: (root) =>
		Locator.all(root, Locator.tag("hz:dialog"))
			.flatMap((dialog) => Locator.all(dialog, Locator.tag("hz:button")))
			.filter((node) => node.props?.["label"] === "Delete rule"),
}
