import "../../../test/document-stub"
import { CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import { AcceptSuggestion, DismissSuggestion, SuggestionMessage } from "../../../customers/suggestions"
import { successToast } from "../../../data/actions"
import { STRONG_SUGGESTION, suggestionFor } from "../../../lab/fixtures/customers-suggestions"
import { channelId, makeShared, organizationId, storyUpdate } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Model } from "./model"
import { init, sharedChanged, update } from "./update"

/**
 * Channel settings → Overview → Customer: the "Looks like Acme" hint for an unlinked channel. A
 * Command resolves with the prompt's own Message; the page wraps it.
 */

const shared = makeShared()
const member = storyUpdate(update, shared)
const initial = init({ _tag: "ChannelSettingsOverview", orgSlug: "hazel", channelId }).model
const loaded = update(
	initial,
	Message.UpdatedChannel({ channel: { id: channelId, name: "acme-shared", icon: null } }),
	shared,
).model
const suggestion = suggestionFor(channelId)
const prompt = (current: Model) => SuggestionPrompt.shownSuggestion(current.suggestion)
const wrapped = (child: SuggestionPrompt.Message) => Message.GotSuggestionMessage({ message: child })
const linkedTo = Message.UpdatedCustomer({
	customer: {
		channelId,
		accountId: Schema.decodeSync(CustomerAccountId)(STRONG_SUGGESTION.accountId),
		accountName: STRONG_SUGGESTION.accountName,
	},
})

describe("channel settings overview: suggested customer", () => {
	test("an unlinked channel asks once who it looks like (which re-scores it)", () => {
		const first = member(loaded, Message.UpdatedCustomer({ customer: null }))
		expect(first.commands?.map((command) => command.name)).toEqual(["FetchChannelSuggestion"])
		expect(first.commands?.[0]?.args).toEqual({ organizationId, channelId })
		expect(member(first.model, Message.UpdatedCustomer({ customer: null })).commands ?? []).toEqual([])
	})

	test("membership arriving after the customer row asks then; before the row, nothing", () => {
		const noMember = makeShared({ member: null })
		const unlinked = update(loaded, Message.UpdatedCustomer({ customer: null }), noMember).model
		expect(sharedChanged(unlinked, shared).commands?.map((command) => command.name)).toContain(
			"FetchChannelSuggestion",
		)
		expect(sharedChanged(loaded, shared).commands ?? []).toEqual([])
	})

	test("nobody outside the org asks: no membership, no request", () => {
		const guest = update(
			loaded,
			Message.UpdatedCustomer({ customer: null }),
			makeShared({ member: null }),
		)
		expect(guest.commands ?? []).toEqual([])
		expect(update(loaded, Message.UpdatedCustomer({ customer: null })).commands ?? []).toEqual([])
	})

	test("a linked channel asks nothing, and linking ends the hint", () => {
		expect(member(loaded, linkedTo).commands ?? []).toEqual([])
		story(
			member,
			given(loaded),
			message(Message.UpdatedCustomer({ customer: null })),
			Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.SucceededFetch({ channelId, items: [suggestion] }),
			),
			model((current) => expect(prompt(current)?.accountName).toBe("Acme Robotics")),
			// Linked automatically by the re-score, or elsewhere: the projection lands.
			message(linkedTo),
			model((current) => expect(prompt(current)).toBeNull()),
		)
	})

	test("Link accepts the suggestion and toasts; the customer then arrives through the projection", () => {
		story(
			member,
			given(loaded),
			message(Message.UpdatedCustomer({ customer: null })),
			Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.SucceededFetch({ channelId, items: [suggestion] }),
			),
			message(wrapped(SuggestionPrompt.Message.PressedLink())),
			model((current) => expect(current.suggestion.status).toBe("Linking")),
			Command.expectExact(AcceptSuggestion({ organizationId, suggestion, linkedBy: null })),
			Command.resolve(
				AcceptSuggestion,
				SuggestionMessage.SucceededAccept({ suggestion: suggestionFor(channelId) }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Linked to Acme Robotics") }),
			),
			model((current) => expect(prompt(current)).toBeNull()),
		)
	})

	test("Dismiss hides it at once and asks again (the next account may show)", () => {
		story(
			member,
			given(loaded),
			message(Message.UpdatedCustomer({ customer: null })),
			Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.SucceededFetch({ channelId, items: [suggestion] }),
			),
			message(wrapped(SuggestionPrompt.Message.PressedDismiss())),
			model((current) => expect(prompt(current)).toBeNull()),
			Command.resolve(DismissSuggestion, SuggestionMessage.SucceededDismiss({ suggestion })),
			Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.SucceededFetch({ channelId, items: [] }),
			),
			model((current) => expect(prompt(current)).toBeNull()),
		)
	})

	test("a failed request shows nothing", () => {
		story(
			member,
			given(loaded),
			message(Message.UpdatedCustomer({ customer: null })),
			Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.FailedFetch({ channelId }),
			),
			model((current) => expect(prompt(current)).toBeNull()),
		)
	})
})
