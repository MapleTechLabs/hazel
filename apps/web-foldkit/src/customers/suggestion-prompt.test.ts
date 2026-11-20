import { describe, expect, test } from "vitest"
import { STRONG_SUGGESTION, SUGGESTION_CHANNELS } from "../lab/fixtures/customers-suggestions"
import { organizationId } from "../test/pages-fixtures"
import { Message, type Model, request, shownSuggestion, update } from "./suggestion-prompt"
import { SuggestionMessage } from "./suggestions"

/** The one-channel prompt's own steps: what shows while it asks, links and dismisses. */

const channelId = STRONG_SUGGESTION.channelId
const ready: Model = { channelId, items: [STRONG_SUGGESTION], status: "Ready" }
const action = (message: SuggestionMessage) => Message.CompletedAction({ message })

describe("suggestion prompt", () => {
	test("asking again shows nothing until the answer, even for the same channel", () => {
		const asked = request(organizationId, channelId)
		expect(shownSuggestion(asked.model)).toBeNull()
		expect(asked.commands?.map((command) => command.name)).toContain("FetchChannelSuggestion")
	})

	test("dismissing hides it at once and keeps it hidden through the refetch (no flicker)", () => {
		const dismissing = update(ready, Message.PressedDismiss(), organizationId).model
		expect(shownSuggestion(dismissing)).toBeNull()
		const refetching = update(
			dismissing,
			action(SuggestionMessage.SucceededDismiss({ suggestion: STRONG_SUGGESTION })),
			organizationId,
		).model
		expect(shownSuggestion(refetching)).toBeNull()
	})

	test("Link stays shown, disabled, while it runs; a second press sends nothing", () => {
		const linking = update(ready, Message.PressedLink(), organizationId)
		expect(shownSuggestion(linking.model)).toEqual(STRONG_SUGGESTION)
		expect(update(linking.model, Message.PressedLink(), organizationId).commands).toBeUndefined()
	})

	test("the success toast shows even after the prompt moved to another channel", () => {
		const moved = request(organizationId, SUGGESTION_CHANNELS.kestrel.id).model
		const settled = update(
			moved,
			action(SuggestionMessage.SucceededAccept({ suggestion: STRONG_SUGGESTION })),
			organizationId,
		)
		expect(settled.toast?.title).toBe("Linked to Acme Robotics")
		expect(settled.model).toEqual(moved)
	})
})
