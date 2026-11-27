import { describe, expect, test } from "vitest"
import { localDateOf, pickedSnoozeMs, snoozeUntil, snoozeUntilMs } from "./menus"
import {
	clearNarrowing,
	DEFAULT_FILTERS,
	isFilterActive,
	neighbourOf,
	type QueueState,
	rowIds,
	tabCounts,
	toggleFilter,
	visibleSignals,
} from "./model"
import { account, ada, DAY, grace, NOW, signal, signalId } from "./test-rows"

/** The queue's pure selectors (`queue/model.ts`) and the snooze arithmetic (`queue/menus.ts`). */

const state = (overrides: Partial<QueueState> = {}): QueueState => ({
	tab: "open",
	grouping: "signals",
	sort: "priority",
	isSortReversed: false,
	filters: { ...DEFAULT_FILTERS, owner: "anyone" },
	search: "",
	accounts: [account(1), account(2, { ownerUserId: grace }), account(3, { ownerUserId: ada })],
	signals: [
		signal(1, 2),
		signal(2, 1, { severity: "high" }),
		signal(3, 2),
		signal(4, 3, { status: "snoozed", snoozedUntilMs: NOW + DAY }),
		signal(5, 1, { status: "done", resolvedAtMs: NOW - DAY }),
		signal(6, 1, { status: "auto_resolved", closedAtMs: NOW - 10 * DAY }),
	],
	...overrides,
})

const viewer = { userId: ada, nowMs: NOW }
const titles = (s: QueueState) => visibleSignals(s, viewer).map((row) => row.title)

describe("the queue's selectors", () => {
	test("ranks by priority and keeps an account's signals together", () => {
		expect(titles(state())).toEqual(["Signal 1", "Signal 3", "Signal 2"])
		expect(titles(state({ sort: "severity" }))).toEqual(["Signal 2", "Signal 1", "Signal 3"])
		expect(titles(state({ sort: "severity", isSortReversed: true }))).toEqual([
			"Signal 1",
			"Signal 3",
			"Signal 2",
		])
	})

	test("counts each tab; done drops an auto-resolved signal older than a week", () => {
		expect(tabCounts(state(), viewer)).toEqual({ open: 3, snoozed: 1, done: 1 })
		expect(titles(state({ tab: "done" }))).toEqual(["Signal 5"])
	})

	test("the owner filter keeps mine or unowned by default; a muted account leaves every tab", () => {
		expect(titles(state({ filters: DEFAULT_FILTERS }))).toEqual(["Signal 2"])
		const muted = state({ accounts: [account(1, { attentionMutedAtMs: NOW }), account(2), account(3)] })
		expect(titles(muted)).toEqual(["Signal 1", "Signal 3"])
	})

	test("account grouping steps through each account's lead signal", () => {
		expect(rowIds(state({ grouping: "accounts" }), viewer)).toEqual([signalId(1), signalId(2)])
	})

	test("search matches the account or the title", () => {
		expect(titles(state({ search: "account 1" }))).toEqual(["Signal 2"])
		expect(titles(state({ search: "signal 3" }))).toEqual(["Signal 3"])
	})

	test("a filter key toggles; the owner falls back to anyone; clearing keeps the owner scope", () => {
		const kind = toggleFilter(DEFAULT_FILTERS, "kind:risk")
		expect(kind.kind).toBe("risk")
		expect(isFilterActive(kind, "kind:risk")).toBe(true)
		expect(toggleFilter(kind, "kind:risk").kind).toBeNull()
		expect(toggleFilter(DEFAULT_FILTERS, "owner:mine_or_unowned").owner).toBe("anyone")
		expect(toggleFilter(DEFAULT_FILTERS, "kind:nonsense")).toBe(DEFAULT_FILTERS)
		expect(clearNarrowing({ ...kind, owner: "unowned" })).toEqual({ ...DEFAULT_FILTERS, owner: "anyone" })
	})

	test("a row that leaves hands the selection to the row now at its place", () => {
		const [a, b, c, d] = [signalId(1), signalId(2), signalId(3), signalId(4)]
		expect(neighbourOf([a, b, c], [a, c], b)).toBe(c)
		expect(neighbourOf([a, b, c], [a, b], c)).toBe(b)
		expect(neighbourOf([a, b, c, d], [d], c)).toBe(d)
		expect(neighbourOf([a], [], a)).toBeNull()
		expect(neighbourOf([a, b], [a, b], b)).toBe(b)
	})
})

describe("snoozing", () => {
	test("presets land at 9:00 local; next week is the coming Monday", () => {
		const now = new Date(2026, 10, 26, 15)
		expect(snoozeUntil("tomorrow", now)).toEqual(new Date(2026, 10, 27, 9))
		expect(snoozeUntil("next_week", now)).toEqual(new Date(2026, 10, 30, 9))
	})

	test("after the next retry, or tomorrow once the retry has passed", () => {
		const evidence = {
			_tag: "amount",
			step: 2,
			amountMinor: 100,
			currency: "USD",
			invoiceId: null,
			invoiceNumber: null,
			subscriptionStatus: null,
			dueAt: null,
			daysOverdue: 1,
			attemptCount: 1,
			declineReason: null,
			nextRetryAt: new Date(NOW + 2 * DAY).toISOString(),
		} as const
		expect(snoozeUntilMs("next_retry", NOW, signal(1, 1, { evidence }))).toBe(NOW + 2 * DAY)
		expect(snoozeUntilMs("next_retry", NOW + 3 * DAY, signal(1, 1, { evidence }))).toBe(
			snoozeUntil("tomorrow", new Date(NOW + 3 * DAY)).getTime(),
		)
	})

	test("a picked day must be after now", () => {
		expect(pickedSnoozeMs(localDateOf(NOW, 1), NOW)).not.toBeNull()
		expect(pickedSnoozeMs(localDateOf(NOW, -1), NOW)).toBeNull()
		expect(pickedSnoozeMs("soon", NOW)).toBeNull()
	})
})
