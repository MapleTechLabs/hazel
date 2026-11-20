// @vitest-environment jsdom
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { toAccountRow } from "../../../customers/queries"
import { AcceptSuggestion, DismissSuggestion, SuggestionMessage } from "../../../customers/suggestions"
import { successToast } from "../../../data/actions"
import { ACCOUNTS, overviewFixture } from "../../../lab/fixtures/customers"
import {
	STRONG_SUGGESTION,
	SUGGESTION_CHANNEL_OPTIONS,
	SUGGESTIONS,
} from "../../../lab/fixtures/customers-suggestions"
import { makeShared, organizationId, pageScene, storyUpdate, userId } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { FetchSuggestedChannelLinks } from "./commands"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The overview's "Suggested channel links" card: asked when the page opens, quiet when empty. */

const shared = makeShared()
const step = storyUpdate(update, shared)
const opened = init(undefined, shared)
const live = [
	Message.SucceededFetchOverview({ range: "30d", overview: overviewFixture("30d") }),
	Message.UpdatedAccounts({ accounts: ACCOUNTS.map(toAccountRow) }),
	Message.UpdatedSignals({ signals: [] }),
	Message.UpdatedConnectedProviders({ providers: ["clerk", "stripe"] }),
	Message.UpdatedChannelOptions({ channels: SUGGESTION_CHANNEL_OPTIONS }),
]
const loaded: Model = live.reduce((current, next) => step(current, next).model, opened.model)
const withSuggestions = step(loaded, Message.SucceededFetchSuggestions({ items: SUGGESTIONS })).model
const card = Scene.role("list", { name: "Suggested channel links" })

describe("customers overview: suggested channel links", () => {
	test("the page asks for them once, with the overview", () => {
		expect(opened.commands?.map((command) => command.name)).toContain("FetchSuggestedChannelLinks")
		expect(step(loaded, Message.UpdatedAccounts({ accounts: [] })).commands ?? []).toEqual([])
	})

	test("Link hides the row, links, toasts what was linked, and asks again", () => {
		story(
			step,
			given(withSuggestions),
			message(Message.PressedAcceptSuggestion({ suggestionId: STRONG_SUGGESTION.id })),
			model((current) => expect(current.suggestions.hidden).toEqual([STRONG_SUGGESTION.id])),
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
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: successToast("Linked #acme-shared to Acme Robotics"),
				}),
			),
			Command.resolve(
				FetchSuggestedChannelLinks,
				Message.SucceededFetchSuggestions({ items: SUGGESTIONS.slice(1) }),
			),
		)
	})

	test("Dismiss hides the row and asks again", () => {
		story(
			step,
			given(withSuggestions),
			message(Message.PressedDismissSuggestion({ suggestionId: STRONG_SUGGESTION.id })),
			model((current) =>
				expect(
					step(current, Message.PressedDismissSuggestion({ suggestionId: STRONG_SUGGESTION.id }))
						.commands,
				).toBeUndefined(),
			),
			Command.expectExact(DismissSuggestion({ organizationId, suggestion: STRONG_SUGGESTION })),
			Command.resolve(
				DismissSuggestion,
				SuggestionMessage.SucceededDismiss({ suggestion: STRONG_SUGGESTION }),
			),
			Command.resolve(FetchSuggestedChannelLinks, Message.SucceededFetchSuggestions({ items: [] })),
			model((current) => expect(current.suggestions.items).toEqual([])),
		)
	})
})

describe("customers overview: suggested channel links card", () => {
	test("hidden while there are none", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(step(loaded, Message.SucceededFetchSuggestions({ items: [] })).model),
			Scene.expect(Scene.role("heading", { name: /^Needs attention/ })).toExist(),
			Scene.expect(card).toBeAbsent(),
		)
	})

	test("each row names channel → account with its top reason; a channel unknown locally is left out", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(withSuggestions),
			Scene.expect(Scene.role("heading", { name: /^Suggested channel links/ })).toExist(),
			Scene.expect(Scene.within(card, Scene.role("link", { name: "Acme Robotics" }))).toExist(),
			Scene.expect(Scene.role("button", { name: "Link acme-shared to Acme Robotics" })).toExist(),
			Scene.expect(Scene.within(card, Scene.text("hidden"))).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Dismiss: acme-shared is not Acme Robotics" })),
			Scene.Command.resolve(
				DismissSuggestion,
				SuggestionMessage.SucceededDismiss({ suggestion: STRONG_SUGGESTION }),
			),
			Scene.expect(Scene.role("button", { name: "Link acme-shared to Acme Robotics" })).toBeAbsent(),
			Scene.Command.resolve(
				FetchSuggestedChannelLinks,
				Message.SucceededFetchSuggestions({ items: SUGGESTIONS.slice(1) }),
			),
		)
	})
})
