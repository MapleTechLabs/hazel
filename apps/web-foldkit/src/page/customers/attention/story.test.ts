import type { SignalEvidence } from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerSignalId,
	CustomerSignalRuleId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { customerRoute } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { sharedDefaults } from "../../test-shared"
import { AssignSignal, DismissSignal, FetchAccountDetail, MarkSignalDone, SnoozeSignal } from "./commands"
import { Message } from "./message"
import {
	accountGroups,
	assignEntries,
	filterEntries,
	type Model,
	rowIds,
	snoozeEntries,
	snoozeUntilMs,
	tabCounts,
	toggleFilter,
	visibleSignals,
} from "./model"
import { queueKeyOf } from "./subscription"
import { init, update, viewerOf } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the queue: tabs, filters, grouping, selection, keys and the optimistic actions. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(3))
const accountId = Schema.decodeSync(CustomerAccountId)
const signalId = Schema.decodeSync(CustomerSignalId)
const ruleId = Schema.decodeSync(CustomerSignalRuleId)(uuid(4))

const NOW = Date.UTC(2026, 10, 10, 12)
const DAY = 86_400_000

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: NOW,
	...sharedDefaults,
}
const viewer = viewerOf(shared)

const account = (
	n: number,
	name: string,
	ownerUserId: UserId | null,
	mrrMinor: number,
	planName: string,
): AccountRow => ({
	id: accountId(uuid(100 + n)),
	name,
	domain: null,
	logoUrl: null,
	ownerUserId,
	lifecycleStage: "active",
	planName,
	mrrMinor,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	healthScore: 54,
	healthStatus: "at_risk",
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 10,
	activeUsers30d: 5,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW - 400 * DAY,
	lastActiveAtMs: NOW - DAY,
	customerSinceMs: NOW - 300 * DAY,
	churnedAtMs: null,
	tags: [],
})
const acme = account(1, "Acme Robotics", ada, 215_000, "Growth")
const kestrel = account(2, "Kestrel Systems", ada, 132_000, "Scale")
const northwind = account(3, "Northwind Labs", grace, 480_000, "Scale")

const inactive: SignalEvidence = {
	_tag: "last_active",
	step: 0,
	lastActiveAt: null,
	daysInactive: 18,
	priorActiveUsers: 12,
	contactId: null,
	contactName: null,
	contactEmail: null,
}
const overdue: SignalEvidence = {
	_tag: "amount",
	step: 1,
	amountMinor: 215_000,
	currency: "USD",
	invoiceId: null,
	invoiceNumber: "INV-2041",
	subscriptionStatus: "past_due",
	dueAt: null,
	daysOverdue: 9,
	attemptCount: 3,
	declineReason: null,
	nextRetryAt: new Date(NOW + 2 * DAY).toISOString(),
}

const signal = (
	n: number,
	of: AccountRow,
	fields: Partial<SignalRow> & Pick<SignalRow, "title" | "priorityScore">,
): SignalRow => ({
	id: signalId(uuid(200 + n)),
	accountId: of.id,
	ruleId,
	template: "inactive",
	kind: "risk",
	severity: "high",
	status: "open",
	reason: `${fields.title} because`,
	evidence: inactive,
	openedAtMs: NOW - n * DAY,
	assigneeUserId: null,
	snoozedUntilMs: null,
	snoozedByUserId: null,
	snoozedAtMs: null,
	snoozeNote: null,
	resolvedAtMs: null,
	resolvedByUserId: null,
	outcome: null,
	resolutionNote: null,
	dismissReason: null,
	closedAtMs: null,
	...fields,
})

const paymentFailed = signal(1, acme, {
	title: "Payment failed",
	template: "payment_failed",
	evidence: overdue,
	priorityScore: 10,
})
const stoppedLogging = signal(2, kestrel, { title: "Stopped logging in", priorityScore: 8 })
const usageDown = signal(3, acme, { title: "Usage down 42%", severity: "medium", priorityScore: 5 })
const nearLimit = signal(4, northwind, {
	title: "Near API request limit",
	kind: "opportunity",
	severity: "medium",
	priorityScore: 6,
})
const snoozed = signal(5, acme, {
	title: "Champion inactive",
	status: "snoozed",
	snoozedUntilMs: NOW + DAY,
	priorityScore: 4,
})
const done = signal(6, kestrel, {
	title: "Health dropped",
	status: "done",
	outcome: "fixed",
	resolvedAtMs: NOW - DAY,
	priorityScore: 3,
})
const oldDone = signal(7, kestrel, {
	title: "Seat growth",
	status: "done",
	resolvedAtMs: NOW - 20 * DAY,
	priorityScore: 2,
})

const signals = [paymentFailed, stoppedLogging, usageDown, nearLimit, snoozed, done, oldDone]

const pageUpdate = (current: Model, next: Message) => update(current, next, shared)

const loaded = (): Model => {
	const steps: ReadonlyArray<Message> = [
		Message.UpdatedAccounts({ accounts: [acme, kestrel, northwind] }),
		Message.UpdatedSignals({ signals }),
		Message.UpdatedMembers({
			members: [
				{ id: ada, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
				{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
			],
		}),
	]
	return steps.reduce((current, step) => pageUpdate(current, step).model, init().model)
}

const withSelection = (selected: SignalRow): Model => ({ ...loaded(), selectedId: selected.id })
const key = (queueKey: Parameters<typeof Message.PressedQueueKey>[0]["key"]) =>
	Message.PressedQueueKey({ key: queueKey })
const statusOf = (current: Model, id: SignalRow["id"]) =>
	current.signals?.find((row) => row.id === id)?.status
const ids = (rows: ReadonlyArray<SignalRow>) => rows.map((row) => row.id)

describe("needs attention: what shows", () => {
	test("Open, Mine by default, by priority", () => {
		const current = loaded()
		expect(ids(visibleSignals(current, viewer))).toEqual(ids([paymentFailed, stoppedLogging, usageDown]))
		expect(tabCounts(current, viewer)).toEqual({ open: 3, snoozed: 1, done: 1 })
	})

	test("Done keeps the last week only", () => {
		const current = pageUpdate(loaded(), Message.ClickedTab({ tab: "done" })).model
		expect(ids(visibleSignals(current, viewer))).toEqual(ids([done]))
	})

	test("removing the owner chip shows everyone's signals", () => {
		const current = pageUpdate(loaded(), Message.ClearedFilter({ field: "owner" })).model
		expect(current.filters.owner).toBe("anyone")
		expect(ids(visibleSignals(current, viewer))).toEqual(
			ids([paymentFailed, stoppedLogging, nearLimit, usageDown]),
		)
	})

	test("a filter key toggles its value", () => {
		const anyone = { ...loaded().filters, owner: "anyone" as const }
		const risks = toggleFilter(anyone, "kind:opportunity")
		expect(risks.kind).toBe("opportunity")
		expect(toggleFilter(risks, "kind:opportunity").kind).toBeNull()
		expect(toggleFilter(anyone, "owner:mine").owner).toBe("mine")
		expect(toggleFilter(anyone, "severity:bogus")).toEqual(anyone)
	})

	test("the filter menu applies and lists the plans", () => {
		const current = loaded()
		const entries = filterEntries(current)
		const opened = pageUpdate(
			current,
			Message.GotFilterMenuMessage({ message: Menu.Message.PressedTrigger({ pointerType: "mouse" }) }),
		).model
		const next = pageUpdate(
			opened,
			Message.GotFilterMenuMessage({
				message: Menu.Message.ClickedItem({ key: "plan:Scale", entries }),
			}),
		).model
		expect(next.filters.plan).toBe("Scale")
		expect(ids(visibleSignals(next, viewer))).toEqual(ids([stoppedLogging]))
	})

	test("search matches account names and signal titles", () => {
		const current = pageUpdate(loaded(), Message.ChangedSearch({ value: "usage" })).model
		expect(ids(visibleSignals(current, viewer))).toEqual(ids([usageDown]))
	})

	test("sorting by MRR puts the biggest account first", () => {
		const current = { ...loaded(), sort: "mrr" as const }
		expect(ids(visibleSignals(current, viewer))).toEqual(ids([paymentFailed, usageDown, stoppedLogging]))
	})

	test("grouping by account steps through each account's lead signal", () => {
		const current = pageUpdate(loaded(), Message.ClickedGrouping({ grouping: "accounts" })).model
		const groups = accountGroups(visibleSignals(current, viewer))
		expect(groups.map((group) => ids(group.signals))).toEqual([
			ids([paymentFailed, usageDown]),
			ids([stoppedLogging]),
		])
		expect(rowIds(current, viewer)).toEqual(ids([paymentFailed, stoppedLogging]))
	})

	test("switching tabs drops the selection", () => {
		const current = pageUpdate(withSelection(paymentFailed), Message.ClickedTab({ tab: "snoozed" })).model
		expect(current.selectedId).toBeNull()
		expect(ids(visibleSignals(current, viewer))).toEqual(ids([snoozed]))
	})
})

describe("needs attention: keyboard", () => {
	test("j and k move the selection within the rows", () => {
		const first = pageUpdate(loaded(), key("next")).model
		expect(first.selectedId).toBe(paymentFailed.id)
		const second = pageUpdate(first, key("next")).model
		expect(second.selectedId).toBe(stoppedLogging.id)
		expect(pageUpdate(pageUpdate(second, key("next")).model, key("next")).model.selectedId).toBe(
			usageDown.id,
		)
		expect(pageUpdate(second, key("previous")).model.selectedId).toBe(paymentFailed.id)
	})

	test("space opens the preview and loads the account", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(key("preview")),
			model((current) => {
				expect(current.isPreviewOpen).toBe(true)
				expect(current.selectedId).toBe(paymentFailed.id)
				expect(current.detail?.accountId).toBe(acme.id)
				expect(current.detail?.data._tag).toBe("Loading")
			}),
			Command.resolve(
				FetchAccountDetail,
				Message.FailedFetchDetail({ accountId: acme.id, reason: "Offline" }),
			),
			model((current) => expect(current.detail?.data._tag).toBe("Failure")),
		)
	})

	test("Escape closes the preview, then clears the selection", () => {
		const open = { ...withSelection(paymentFailed), isPreviewOpen: true }
		const closed = pageUpdate(open, key("close")).model
		expect(closed.isPreviewOpen).toBe(false)
		expect(closed.selectedId).toBe(paymentFailed.id)
		expect(pageUpdate(closed, key("close")).model.selectedId).toBeNull()
	})

	test("Enter opens the customer", () => {
		story(
			pageUpdate,
			given(withSelection(stoppedLogging)),
			message(key("open")),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: customerRoute("hazel", kestrel.id),
					replace: false,
				}),
			),
		)
	})

	test("a and s open their menus on the selected row", () => {
		const assigning = pageUpdate(withSelection(stoppedLogging), key("assign")).model
		expect(assigning.assignMenu.popup._tag).toBe("Open")
		const snoozing = pageUpdate(loaded(), key("snooze")).model
		expect(snoozing.selectedId).toBe(paymentFailed.id)
		expect(snoozing.snoozeMenu.popup._tag).toBe("Open")
	})

	test("a and s open nothing whose button is not on screen", () => {
		// Grouped by account, a row shows no actions until the preview opens.
		const grouped = pageUpdate(
			withSelection(stoppedLogging),
			Message.ClickedGrouping({ grouping: "accounts" }),
		).model
		expect(pageUpdate(grouped, key("assign")).model.assignMenu.popup._tag).toBe("Closed")
		const previewed = { ...grouped, isPreviewOpen: true }
		expect(pageUpdate(previewed, key("assign")).model.assignMenu.popup._tag).toBe("Open")
		// A selection filtered out of the rows moves to the first row.
		const hidden = pageUpdate(withSelection(nearLimit), Message.ChangedSearch({ value: "kestrel" })).model
		expect(pageUpdate(hidden, key("snooze")).model.selectedId).toBe(stoppedLogging.id)
		// The snoozed tab has no Assign button.
		const snoozedTab = { ...loaded(), tab: "snoozed" as const, selectedId: snoozed.id }
		expect(pageUpdate(snoozedTab, key("assign")).model.assignMenu.popup._tag).toBe("Closed")
	})

	test("keys inside fields or with modifiers are left alone", () => {
		const event = (
			key: string,
			extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {},
		) => ({
			key,
			target: null,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			repeat: false,
			...extra,
		})
		expect(queueKeyOf(event("j"))).toBe("next")
		expect(queueKeyOf(event("J"))).toBe("next")
		expect(queueKeyOf(event("ArrowUp"))).toBe("previous")
		expect(queueKeyOf(event(" "))).toBe("preview")
		expect(queueKeyOf(event("d", { metaKey: true }))).toBeNull()
		expect(queueKeyOf(event("x"))).toBeNull()
		expect(queueKeyOf(event("j", { repeat: true }))).toBe("next")
		expect(queueKeyOf(event("e", { repeat: true }))).toBeNull()
	})
})

describe("needs attention: actions", () => {
	test("snoozing hides the row at once and selects the next", () => {
		const current = pageUpdate(withSelection(paymentFailed), key("snooze")).model
		const untilMs = snoozeUntilMs("tomorrow", NOW, paymentFailed)
		story(
			pageUpdate,
			given(current),
			message(
				Message.GotSnoozeMenuMessage({
					message: Menu.Message.ClickedItem({
						key: "tomorrow",
						entries: snoozeEntries(paymentFailed),
					}),
				}),
			),
			model((next) => {
				expect(statusOf(next, paymentFailed.id)).toBe("snoozed")
				expect(next.signals?.find((row) => row.id === paymentFailed.id)?.snoozedUntilMs).toBe(untilMs)
				expect(next.selectedId).toBe(stoppedLogging.id)
				expect(tabCounts(next, viewer)).toEqual({ open: 2, snoozed: 2, done: 1 })
			}),
			Command.resolve(
				SnoozeSignal,
				Message.SucceededSignalAction({ signalId: paymentFailed.id, action: "snooze" }),
			),
			expectNoOutMessage(),
		)
	})

	test("snooze options: 9:00 local, next week on Monday, a payment's next retry", () => {
		const tomorrow = new Date(snoozeUntilMs("tomorrow", NOW, paymentFailed))
		expect([tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([9, 0])
		expect(new Date(snoozeUntilMs("next_week", NOW, paymentFailed)).getDay()).toBe(1)
		expect(snoozeUntilMs("next_retry", NOW, paymentFailed)).toBe(NOW + 2 * DAY)
		// A retry already past snoozes until tomorrow.
		expect(snoozeUntilMs("next_retry", NOW + 3 * DAY, paymentFailed)).toBe(
			snoozeUntilMs("tomorrow", NOW + 3 * DAY, paymentFailed),
		)
		const items = (signal: SignalRow) =>
			snoozeEntries(signal).flatMap((entry) =>
				entry._tag === "Section" ? entry.items.map((item) => item.key) : [],
			)
		expect(items(stoppedLogging)).toEqual(["tomorrow", "in_3_days", "next_week"])
		expect(items(paymentFailed)).toEqual(["tomorrow", "in_3_days", "next_week", "next_retry"])
	})

	test("Pick date snoozes until 9:00 on the chosen day", () => {
		const opened = pageUpdate(withSelection(stoppedLogging), key("snooze")).model
		const picking = pageUpdate(
			opened,
			Message.GotSnoozeMenuMessage({
				message: Menu.Message.ClickedItem({
					key: "pick_date",
					entries: snoozeEntries(stoppedLogging),
				}),
			}),
		).model
		expect(picking.snoozeDateModal.isOpen).toBe(true)
		expect(picking.snoozeDateForm?.signalId).toBe(stoppedLogging.id)
		// A day in the past is refused.
		const past = pageUpdate(picking, Message.ChangedSnoozeDate({ value: "2026-11-01" })).model
		expect(pageUpdate(past, Message.SubmittedSnoozeDate()).commands ?? []).toHaveLength(0)
		const chosen = pageUpdate(picking, Message.ChangedSnoozeDate({ value: "2026-11-20" })).model
		const submitted = pageUpdate(chosen, Message.SubmittedSnoozeDate())
		expect(submitted.model.snoozeDateModal.isOpen).toBe(false)
		const row = submitted.model.signals?.find((entry) => entry.id === stoppedLogging.id)
		expect(row?.status).toBe("snoozed")
		expect(row?.snoozedUntilMs).toBe(new Date(2026, 10, 20, 9).getTime())
		expect(submitted.commands).toHaveLength(1)
	})

	test("d opens the done dialog; submitting marks it done with the outcome and note", () => {
		story(
			pageUpdate,
			given(withSelection(paymentFailed)),
			message(key("done")),
			model((current) => {
				expect(current.doneModal.isOpen).toBe(true)
				expect(current.doneForm).toEqual({
					signalId: paymentFailed.id,
					outcome: "contacted",
					note: "",
				})
			}),
			message(Message.ChangedDoneOutcome({ outcome: "fixed" })),
			message(Message.ChangedDoneNote({ value: " Card updated " })),
			message(Message.SubmittedDone()),
			model((current) => {
				expect(current.doneModal.isOpen).toBe(false)
				expect(current.doneForm).toBeNull()
				const row = current.signals?.find((entry) => entry.id === paymentFailed.id)
				expect(row?.status).toBe("done")
				expect(row?.outcome).toBe("fixed")
				expect(row?.resolutionNote).toBe("Card updated")
				expect(current.selectedId).toBe(stoppedLogging.id)
			}),
			Command.resolve(
				MarkSignalDone,
				Message.SucceededSignalAction({ signalId: paymentFailed.id, action: "done" }),
			),
		)
	})

	test("a failed dismiss toasts why (the live rows roll the row back)", () => {
		story(
			pageUpdate,
			given(withSelection(usageDown)),
			message(key("dismiss")),
			model((current) => expect(statusOf(current, usageDown.id)).toBe("dismissed")),
			Command.resolve(
				DismissSignal,
				Message.FailedSignalAction({ signalId: usageDown.id, action: "dismiss", reason: "Stale" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Couldn't dismiss the signal",
						description: "Someone else acted on it first.",
					},
				}),
			),
		)
	})

	test("a closed or auto-resolved signal is not reopened (the server refuses it)", () => {
		const doneTab = { ...loaded(), tab: "done" as const }
		const closed = { ...doneTab, signals: [{ ...done, closedAtMs: NOW }], selectedId: done.id }
		expect(pageUpdate(closed, key("reopen")).commands ?? []).toEqual([])
		const auto = {
			...doneTab,
			signals: [{ ...done, status: "auto_resolved" as const }],
			selectedId: done.id,
		}
		expect(pageUpdate(auto, Message.PressedReopen({ signalId: done.id })).commands ?? []).toEqual([])
		const reopened = pageUpdate({ ...doneTab, selectedId: done.id }, key("reopen"))
		expect((reopened.commands ?? []).map((command) => command.name)).toEqual(["ReopenSignal"])
	})

	test("assigning keeps the row and its selection", () => {
		const current = pageUpdate(withSelection(stoppedLogging), key("assign")).model
		story(
			pageUpdate,
			given(current),
			message(
				Message.GotAssignMenuMessage({
					message: Menu.Message.ClickedItem({
						key: "me",
						entries: assignEntries(current.members, viewer),
					}),
				}),
			),
			model((next) => {
				expect(next.signals?.find((row) => row.id === stoppedLogging.id)?.assigneeUserId).toBe(ada)
				expect(next.selectedId).toBe(stoppedLogging.id)
			}),
			Command.resolve(
				AssignSignal,
				Message.SucceededSignalAction({ signalId: stoppedLogging.id, action: "assign" }),
			),
		)
	})
})
