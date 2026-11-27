// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { CustomerSettingsId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, ShowToast } from "../../../../app/requests"
import { TemplatePicker, TemplatePickerEvents } from "../../../settings/signals/TemplatePicker"
import {
	button,
	byProp,
	feedKey,
	NOW,
	organizationId,
	rule,
	session,
} from "../../../settings/signals/test-support"
import { SaveAttention, SignalsPageMessage, SignalsPageNoDeps, ToggleSignalRule } from "./SignalsPage"

/** The Signals list (`/:org/customers/settings/signals`) and its template picker. */

const rules = [
	rule(1, "payment_failed", { name: "Payment failed", matchingCount: 3 }),
	rule(2, "cancel_scheduled", { enabled: false }),
	rule(3, "seat_growth"),
]

const start = (role: "owner" | "member" = "owner", pickerOpen = false) =>
	Scene.start(SignalsPageNoDeps, { session: session(role), pickerOpen, nowMs: NOW })

const loaded = (role: "owner" | "member" = "owner") =>
	start(role)
		.subscription(feedKey("rules"), SignalsPageMessage.UpdatedRules({ rules }))
		.subscription(feedKey("providers"), SignalsPageMessage.UpdatedProviders({ providers: ["stripe"] }))

const row = (title: string) => byProp("tableRow", "title", title)
const tableOf = (label: string) => byProp("table", "label", label)

describe("signals page", () => {
	test("waits for the rules, then groups them by kind with a summary", () => {
		const s = start()
		s.expect(byProp("progress", "label", "Loading rules…")).toExist()
		loaded()
			.expect(row("Payment failed"))
			.toExist()
			.expect(tableOf("Risk rules"))
			.toExist()
			.expect(tableOf("Opportunity rules"))
			.toExist()
			.expect(byProp("link", "label", "3 accounts"))
			.toExist()
	})

	test("a rule's switch saves it flipped, and flips back when the save fails", () => {
		const s = loaded().fire(firstToggle, "change", { checked: false })
		s.expectExact(
			ToggleSignalRule.make({
				organizationId,
				ruleId: rules[0]!.id,
				rule: {
					name: "Payment failed",
					severity: rules[0]!.severity,
					config: rules[0]!.config,
					scope: {},
					enabled: false,
				},
			}),
		)
		expect(s.get(firstToggle).props?.["checked"]).toBeUndefined()
		s.resolve(
			ToggleSignalRule,
			SignalsPageMessage.FailedToggleRule({ ruleId: rules[0]!.id, enabled: false, reason: "Offline" }),
		)
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
		expect(s.get(firstToggle).props?.["checked"]).toBe(true)
	})

	test("a row opens its rule", () => {
		loaded()
			.fire(row("Payment failed"), "press")
			.expectExact(
				Navigate.make({ href: `/hazel/customers/settings/signals/${rules[0]!.id}`, replace: false }),
			)
			.resolve(Navigate, Component.noop)
	})

	test("an admin changes who Needs attention covers", () => {
		const settingsId = CustomerSettingsId.make("00000000-0000-4000-8000-0000000e0001")
		const s = loaded().subscription(
			feedKey("attention"),
			SignalsPageMessage.UpdatedAttention({
				attention: { settingsId, attention: { stages: ["active"], requiredSources: [] } },
			}),
		)
		s.fire(byProp("choiceGroup", "label", "Stages"), "change", {
			selected: ["active", "trialing"],
		}).expectExact(
			SaveAttention.make({
				organizationId,
				settingsId,
				attention: { stages: ["active", "trialing"], requiredSources: [] },
			}),
		)
		expect(s.get(byProp("choiceGroup", "label", "Stages")).props?.["disabled"]).toBe(true)
		s.resolve(SaveAttention, SignalsPageMessage.SucceededSaveAttention())
		expect(s.get(byProp("choiceGroup", "label", "Stages")).props?.["disabled"]).toBeUndefined()
	})

	test("a member reads the rules but cannot change them", () => {
		const s = loaded("member")
		s.expect(button("New signal")).toBeAbsent()
		expect(s.get(firstToggle).props?.["disabled"]).toBe(true)
	})

	test("New signal opens the picker, and /new opens with it; it closes when it asks", () => {
		loaded()
			.fire(button("New signal"), "press")
			.childEmit(TemplatePicker, TemplatePickerEvents.RequestedClose())
		start("owner", true).childEmit(TemplatePicker, TemplatePickerEvents.RequestedClose())
		// Closed, there is no picker to hear from.
		expect(() => loaded().childEmit(TemplatePicker, TemplatePickerEvents.RequestedClose())).toThrow()
	})
})

describe("template picker", () => {
	const picker = () => Scene.start(TemplatePicker, { orgSlug: "hazel", rules, providers: ["stripe"] })
	const templates = byProp("choiceGroup", "label", "Templates")

	test("filters by kind and search, and sets up the picked template", () => {
		const s = picker()
		expect(s.get(button("Set up")).props?.["disabled"]).toBe(true)
		s.fire(byProp("choiceGroup", "label", "Kind"), "change", { selected: ["all", "opportunity"] })
		const shown = (s.get(templates).props?.["options"] as ReadonlyArray<{ value: string }>).map(
			(option) => option.value,
		)
		expect(shown).toEqual(["near_limit", "seat_growth"])
		s.fire(byProp("choiceGroup", "label", "Kind"), "change", { selected: ["opportunity", "all"] })
			.fire(templates, "change", { selected: ["payment_failed"] })
			.fire(button("Set up Payment failing"), "press")
			.expectExact(
				Navigate.make({
					href: "/hazel/customers/settings/signals/new?template=payment_failed",
					replace: false,
				}),
			)
			.emitted(TemplatePickerEvents.RequestedClose())
			.resolve(Navigate, Component.noop)
	})

	test("a template its sources cannot feed is not picked", () => {
		const s = picker().fire(templates, "change", { selected: ["inactive"] })
		expect(s.get(button("Set up")).props?.["disabled"]).toBe(true)
	})
})

const firstToggle: Locator.Locator = {
	description: "the first rule's switch",
	all: (root) => Locator.all(root, Locator.tag("hz:toggle")).slice(0, 1),
}
