import { describe, expect, test } from "vitest"
import {
	CONTACT_SUGGESTION,
	LONG_SUGGESTION,
	STRONG_SUGGESTION,
	SUGGESTION_CHANNEL_OPTIONS,
	SUGGESTION_CHANNELS,
	SUGGESTIONS,
	UNSEEN_SUGGESTION,
} from "../lab/fixtures/customers-suggestions"
import { originOf } from "./channels"
import {
	EMPTY_SUGGESTIONS,
	hideSuggestion,
	reasonLines,
	reasonSummary,
	receivedSuggestions,
	shownSuggestions,
	unhideSuggestion,
} from "./suggestions"

/** The suggestion helpers: which rows show, and their words. */

const loaded = receivedSuggestions(EMPTY_SUGGESTIONS, SUGGESTIONS)

describe("suggested channel links: rows", () => {
	test("nothing shows before the first answer, or when there are no suggestions", () => {
		expect(shownSuggestions(EMPTY_SUGGESTIONS, SUGGESTION_CHANNEL_OPTIONS)).toEqual([])
		expect(
			shownSuggestions(receivedSuggestions(EMPTY_SUGGESTIONS, []), SUGGESTION_CHANNEL_OPTIONS),
		).toEqual([])
	})

	test("rows keep the server's order and drop channels the org's collection does not know", () => {
		const shown = shownSuggestions(loaded, SUGGESTION_CHANNEL_OPTIONS)
		expect(shown.map(({ suggestion }) => suggestion.id)).toEqual(
			SUGGESTIONS.filter((row) => row.id !== UNSEEN_SUGGESTION.id).map((row) => row.id),
		)
		expect(shown[0]?.channel).toEqual(SUGGESTION_CHANNELS.acme)
	})

	test("a row acted on leaves at once and stays out of later answers until its write fails", () => {
		const hidden = hideSuggestion(loaded, STRONG_SUGGESTION.id)
		const ids = (list: typeof loaded) =>
			shownSuggestions(list, SUGGESTION_CHANNEL_OPTIONS).map(({ suggestion }) => suggestion.id)
		expect(ids(hidden)).not.toContain(STRONG_SUGGESTION.id)
		// An answer that raced the write still has it.
		expect(ids(receivedSuggestions(hidden, SUGGESTIONS))).not.toContain(STRONG_SUGGESTION.id)
		expect(hideSuggestion(hidden, STRONG_SUGGESTION.id)).toBe(hidden)
		expect(ids(unhideSuggestion(hidden, STRONG_SUGGESTION.id))).toContain(STRONG_SUGGESTION.id)
	})
})

describe("suggested channel links: reasons", () => {
	test("each reason is the domain's sentence, strongest first", () => {
		expect(reasonLines(STRONG_SUGGESTION)).toEqual([
			"3 of 4 external members have @acmerobotics.io, Acme Robotics's domain",
			'The Acme Robotics name contains "acme"',
		])
	})

	test("the summary is the top reason and the rest for hover", () => {
		expect(reasonSummary(CONTACT_SUGGESTION)).toEqual({
			top: "1 of 5 external members is a Kestrel Systems contact",
			others: [],
		})
		expect(reasonSummary(LONG_SUGGESTION)?.others).toHaveLength(2)
		expect(reasonSummary({ ...STRONG_SUGGESTION, reasons: [] })).toBeNull()
	})
})

describe("channel origin", () => {
	test("a Connect channel is Connect's even when chat sync mirrors it", () => {
		const id = SUGGESTION_CHANNELS.acme.id
		expect(originOf(id, new Map([[id, "slack"]]), new Set([id]))).toBe("connect")
		expect(originOf(id, new Map([[id, "discord"]]), new Set())).toBe("discord")
		expect(originOf(id, new Map(), new Set())).toBe("hazel")
	})
})
