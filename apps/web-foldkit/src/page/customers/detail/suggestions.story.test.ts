// @vitest-environment jsdom
import { Option } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import {
	AcceptSuggestion,
	DismissSuggestion,
	shownSuggestions,
	SuggestionMessage,
} from "../../../customers/suggestions"
import { ACCOUNTS, ACCOUNTS_BY_KEY } from "../../../lab/fixtures/customers"
import {
	CONTACT_SUGGESTION,
	STRONG_SUGGESTION,
	SUGGESTION_CHANNEL_OPTIONS,
} from "../../../lab/fixtures/customers-suggestions"
import { AppRoute } from "../../../route"
import { makeShared, organizationId, storyUpdate, userId } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { FetchCustomerSuggestions } from "./commands"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"

/** The customer page's suggested channel links: asked for the customer, linked or dismissed in a click. */

const shared = makeShared()
const step = storyUpdate(update, shared)
const acme = ACCOUNTS_BY_KEY.acme
const opened = (key: "acme" | "acmeEu") =>
	init(
		AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: ACCOUNTS_BY_KEY[key].id, tab: Option.none() }),
		shared,
	).model
const accounts = Message.UpdatedAccounts({ accounts: ACCOUNTS.map(toAccountRow) })
const channels = Message.UpdatedChannelOptions({ channels: SUGGESTION_CHANNEL_OPTIONS })
/** Acme's suggestions as the server answers them. */
const answer = Message.SucceededFetchSuggestions({
	accountId: acme.id,
	items: [STRONG_SUGGESTION, { ...CONTACT_SUGGESTION, accountId: acme.id, accountName: acme.name }],
})
const shownIds = (current: Model) =>
	shownSuggestions(current.suggestions, current.channelOptions).map(({ suggestion }) => suggestion.id)

describe("customer page: suggested channel links", () => {
	test("asked once the accounts say who the customer is: an environment asks for its primary", () => {
		const before = opened("acmeEu")
		expect(before.suggestionsFor).toBeNull()
		const loaded = step(before, accounts)
		expect(loaded.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
			{ name: FetchCustomerSuggestions.name, args: { organizationId, accountId: acme.id } },
		])
		// The accounts changing again asks nothing new.
		expect(step(loaded.model, accounts).commands ?? []).toEqual([])
	})

	test("an answer for another customer is dropped", () => {
		const loaded = step(step(opened("acme"), accounts).model, channels).model
		const other = step(
			loaded,
			Message.SucceededFetchSuggestions({
				accountId: ACCOUNTS_BY_KEY.kestrel.id,
				items: [CONTACT_SUGGESTION],
			}),
		).model
		expect(other.suggestions.items).toBeNull()
	})

	test("Link hides the row at once, links the channel, and asks again", () => {
		story(
			step,
			given(step(step(opened("acme"), accounts).model, channels).model),
			message(answer),
			model((current) =>
				expect(shownIds(current)).toEqual([STRONG_SUGGESTION.id, CONTACT_SUGGESTION.id]),
			),
			message(Message.PressedAcceptSuggestion({ suggestionId: STRONG_SUGGESTION.id })),
			model((current) => expect(shownIds(current)).toEqual([CONTACT_SUGGESTION.id])),
			// Pressed again while it runs: sent once.
			model((current) =>
				expect(
					step(current, Message.PressedAcceptSuggestion({ suggestionId: STRONG_SUGGESTION.id }))
						.commands,
				).toBeUndefined(),
			),
			Command.expectExact(
				AcceptSuggestion({ organizationId, suggestion: STRONG_SUGGESTION, linkedBy: userId }),
			),
			Command.resolve(
				AcceptSuggestion,
				SuggestionMessage.SucceededAccept({ suggestion: STRONG_SUGGESTION }),
			),
			Command.resolve(
				FetchCustomerSuggestions,
				Message.SucceededFetchSuggestions({ accountId: acme.id, items: [] }),
			),
			model((current) => expect(shownIds(current)).toEqual([])),
		)
	})

	test("a failed dismiss brings the row back and says so", () => {
		story(
			step,
			given(step(step(opened("acme"), accounts).model, channels).model),
			message(answer),
			message(Message.PressedDismissSuggestion({ suggestionId: STRONG_SUGGESTION.id })),
			model((current) => expect(shownIds(current)).not.toContain(STRONG_SUGGESTION.id)),
			model((current) =>
				expect(
					step(current, Message.PressedDismissSuggestion({ suggestionId: STRONG_SUGGESTION.id }))
						.commands,
				).toBeUndefined(),
			),
			Command.resolve(
				DismissSuggestion,
				SuggestionMessage.FailedSuggestionAction({
					suggestion: STRONG_SUGGESTION,
					action: "dismiss",
					reason: "Offline",
				}),
			),
			model((current) => expect(shownIds(current)).toContain(STRONG_SUGGESTION.id)),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			),
			Command.resolve(FetchCustomerSuggestions, answer),
		)
	})
})
