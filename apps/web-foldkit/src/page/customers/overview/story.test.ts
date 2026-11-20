import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { overviewFixture } from "../../../lab/fixtures/customers"
import { EMPTY_SUPPORT_REPORT, SUPPORT_REPORT } from "../../../lab/fixtures/issues"
import type { Shared } from "../../contract"
import { sharedDefaults } from "../../test-shared"
import { Message } from "./message"
import type { Model } from "./model"
import { init, update } from "./update"

/** Update-loop tests for the overview's range switch. */

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: {
		id: Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000001"),
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
	},
	member: null,
	nowMs: Date.UTC(2026, 10, 10, 12),
	...sharedDefaults,
}

const run = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message, shared).model, model)

const loaded = run(init(undefined, shared).model, [
	Message.SucceededFetchOverview({ range: "30d", overview: overviewFixture("30d") }),
])

describe("customers overview: range", () => {
	test("an answer for a range the user already left is dropped", () => {
		const switched = run(loaded, [Message.ClickedRange({ range: "90d" })])
		const stale = run(switched, [
			Message.SucceededFetchOverview({ range: "30d", overview: overviewFixture("30d") }),
		])
		expect(stale.overview._tag).toBe("Refreshing")
		expect(
			run(switched, [Message.FailedFetchOverview({ range: "30d", reason: "Offline" })]).overview._tag,
		).toBe("Refreshing")
	})

	test("a failed switch shows the failure, not the old range's numbers", () => {
		const failed = run(loaded, [
			Message.ClickedRange({ range: "90d" }),
			Message.FailedFetchOverview({ range: "90d", reason: "Offline" }),
		])
		expect(failed.overview._tag).toBe("Failure")
		expect(
			update(failed, Message.PressedRetry(), shared).commands?.map((command) => command.name),
		).toEqual(["FetchCustomersOverview"])
	})
})

describe("customers overview: support tiles", () => {
	const names = (result: { readonly commands?: ReadonlyArray<{ readonly name: string }> }) =>
		(result.commands ?? []).map((command) => command.name)

	test("open and every range switch load the support report for the same range", () => {
		expect(names(init(undefined, shared))).toContain("FetchOverviewSupport")
		expect(names(update(loaded, Message.ClickedRange({ range: "7d" }), shared))).toContain(
			"FetchOverviewSupport",
		)
	})

	test("a late answer for another range is dropped; a failure retries the tiles alone", () => {
		const withSupport = run(loaded, [
			Message.SucceededFetchSupport({ range: "30d", report: SUPPORT_REPORT }),
		])
		expect(withSupport.support._tag).toBe("Success")
		const switched = run(withSupport, [
			Message.ClickedRange({ range: "90d" }),
			Message.SucceededFetchSupport({ range: "30d", report: EMPTY_SUPPORT_REPORT }),
		])
		expect(switched.support._tag).toBe("Refreshing")
		const failed = run(switched, [Message.FailedFetchSupport({ range: "90d", reason: "Offline" })])
		expect(failed.support._tag).toBe("Failure")
		expect(names(update(failed, Message.PressedRetrySupport(), shared))).toEqual(["FetchOverviewSupport"])
	})
})
