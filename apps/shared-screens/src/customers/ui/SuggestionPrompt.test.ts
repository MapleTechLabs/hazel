// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, CustomerAccountId, CustomerChannelSuggestionId, OrganizationId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../app/requests"
import type { SuggestionRow } from "../data/suggestions"
import {
	AcceptSuggestion,
	DismissSuggestion,
	SuggestionPromptMessage,
	SuggestionPromptNoDeps,
} from "./SuggestionPrompt"

/** The one-channel suggestion prompt: "Looks like Acme", Link and Dismiss. */

const organizationId = OrganizationId.make("00000002-0000-4000-8000-000000000001")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const suggestion = {
	id: CustomerChannelSuggestionId.make("00000030-0000-4000-8000-000000000001"),
	channelId,
	accountId: CustomerAccountId.make("00000012-0000-4000-8000-000000000001"),
	accountName: "Acme",
	score: 10,
	strength: "strong",
	reasons: [],
	computedAt: new Date(0),
} as unknown as SuggestionRow

const button = (label: string): Locator.Locator => ({
	description: `<hz:button label=${label}>`,
	all: (root) =>
		Locator.all(root, Locator.tag("hz:button")).filter((node) => node.props?.["label"] === label),
})

describe("suggestion prompt", () => {
	test("shows nothing without a suggestion", () => {
		Scene.start(SuggestionPromptNoDeps, { organizationId, channelId })
			.loaded("suggestions", [])
			.expect(Locator.tag("hz:frame"))
			.toBeAbsent()
	})

	test("links the suggested customer and says so", () => {
		const s = Scene.start(SuggestionPromptNoDeps, { organizationId, channelId }).loaded("suggestions", [
			suggestion,
		])
		s.expect(Locator.tag("hz:frame")).toExist()
		s.fire(button("Link"), "press").expectExact(AcceptSuggestion.make({ organizationId, suggestion }))
		expect(s.get(button("Linking…")).props?.["disabled"]).toBe(true)
		s.resolve(AcceptSuggestion, SuggestionPromptMessage.SucceededAccept({ accountName: "Acme" }))
			.expectExact(
				ShowToast.make({ toast: { intent: "success", title: "Linked to Acme", description: null } }),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("a dismiss hides it at once and asks again", () => {
		const s = Scene.start(SuggestionPromptNoDeps, { organizationId, channelId })
			.loaded("suggestions", [suggestion])
			.fire(button("Dismiss"), "press")
			.expectExact(DismissSuggestion.make({ organizationId, suggestion }))
		s.expect(Locator.tag("hz:frame")).toBeAbsent()
		s.resolve(DismissSuggestion, SuggestionPromptMessage.SucceededDismiss())
			.loaded("suggestions", [])
			.expect(Locator.tag("hz:frame"))
			.toBeAbsent()
	})
})
