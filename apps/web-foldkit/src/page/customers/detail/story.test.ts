import type { SignalEvidence } from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerNoteId,
	CustomerSignalId,
	CustomerSignalRuleId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { AppRoute, type CustomerTab } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { sharedDefaults } from "../../test-shared"
import { Message } from "./message"
import {
	isNotFound,
	type Model,
	type NoteRow,
	ownerEntries,
	positionOf,
	signalMoreEntries,
	snoozeEntries,
	sortedNotes,
} from "./model"
import { init, routeChanged, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the customer page: tab routing and loading, owner and tags, notes, signals. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(3))
const accountId = Schema.decodeSync(CustomerAccountId)
const noteId = Schema.decodeSync(CustomerNoteId)
const NOW = Date.UTC(2026, 10, 10, 12)

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

const account = (n: number, name: string): AccountRow => ({
	id: accountId(uuid(100 + n)),
	name,
	domain: null,
	logoUrl: null,
	ownerUserId: ada,
	lifecycleStage: "active",
	planName: "Growth",
	mrrMinor: 10_000,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	healthScore: 80,
	healthStatus: "healthy",
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 10,
	activeUsers30d: 5,
	activeUsersTrendPct: 0,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW,
	lastActiveAtMs: NOW,
	customerSinceMs: NOW,
	churnedAtMs: null,
	tags: ["pilot"],
})
const acme = account(1, "Acme")
const beta = account(2, "Beta")
const gamma = account(3, "Gamma")

const evidence: SignalEvidence = {
	_tag: "last_active",
	step: 0,
	lastActiveAt: null,
	daysInactive: 18,
	priorActiveUsers: 12,
	contactId: null,
	contactName: null,
	contactEmail: null,
}
const signal: SignalRow = {
	id: Schema.decodeSync(CustomerSignalId)(uuid(200)),
	accountId: beta.id,
	ruleId: Schema.decodeSync(CustomerSignalRuleId)(uuid(201)),
	template: "inactive",
	kind: "risk",
	severity: "high",
	status: "open",
	title: "Stopped logging in",
	reason: "No activity for 18 days",
	evidence,
	priorityScore: 5,
	openedAtMs: NOW,
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
}

const note = (n: number, fields: Partial<NoteRow> = {}): NoteRow => ({
	id: noteId(uuid(300 + n)),
	accountId: beta.id,
	authorUserId: ada,
	body: `Note ${n}`,
	pinned: false,
	signalId: null,
	editedAtMs: null,
	createdAtMs: NOW - n * 1000,
	...fields,
})

const route = (tab: CustomerTab | null, id = beta.id) =>
	AppRoute.CustomerDetail({ orgSlug: "hazel", accountId: id, tab: Option.fromNullishOr(tab) })
const run = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message, shared).model, model)
const commandNames = (result: { readonly commands?: ReadonlyArray<{ readonly name: string }> | undefined }) =>
	(result.commands ?? []).map((command) => command.name)
const loaded = (tab: CustomerTab | null = null): Model =>
	run(init(route(tab), shared).model, [
		Message.UpdatedAccounts({ accounts: [acme, beta, gamma] }),
		Message.UpdatedSignals({ signals: [signal] }),
		Message.UpdatedNotes({
			notes: [note(1), note(2, { pinned: true }), note(3, { authorUserId: grace })],
		}),
		Message.UpdatedMembers({
			members: [
				{ id: ada, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
				{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
			],
		}),
	])
const pick = (
	model: Model,
	wrap: (message: Menu.Message) => Message,
	key: string,
	entries: ReadonlyArray<Menu.Entry>,
) =>
	update(
		run(model, [wrap(Menu.Message.PressedTrigger({ pointerType: "mouse" }))]),
		wrap(Menu.Message.ClickedItem({ key, entries })),
		shared,
	)

describe("customer page: tabs", () => {
	test("each tab loads what it shows, once", () => {
		expect(commandNames(init(route(null), shared))).toEqual(["FetchCustomerDetail", "FetchCustomerUsage"])
		expect(commandNames(init(route("users"), shared))).toEqual([
			"FetchCustomerDetail",
			"FetchCustomerContacts",
		])
		const billing = routeChanged(loaded(), route("billing"), shared)
		expect(billing.model.tab).toBe("billing")
		expect(commandNames(billing)).toEqual(["FetchCustomerInvoices", "FetchCustomerMrrHistory"])
		const back = routeChanged(
			routeChanged(billing.model, route(null), shared).model,
			route("billing"),
			shared,
		)
		expect(commandNames(back)).toEqual([])
	})

	test("a tab press navigates to the tab's URL", () => {
		const result = update(loaded(), Message.ClickedTab({ tab: "notes" }), shared)
		expect(result.outMessage).toMatchObject({ _tag: "RequestedNavigation", route: route("notes") })
		expect(update(loaded(), Message.ClickedTab({ tab: "overview" }), shared).outMessage).toBeUndefined()
	})

	test("prev / next follow the accounts by name", () => {
		const position = positionOf(loaded())
		expect(position).toMatchObject({ index: 1, total: 3 })
		expect(update(loaded(), Message.PressedNeighbour({ step: 1 }), shared).outMessage).toMatchObject({
			route: route(null, gamma.id),
		})
	})

	test("a missing account shows not found", () => {
		expect(
			isNotFound(
				run(init(route(null, accountId(uuid(999))), shared).model, [
					Message.UpdatedAccounts({ accounts: [acme] }),
				]),
			),
		).toBe(true)
		expect(isNotFound(run(loaded(), [Message.FailedFetchDetail({ reason: "NotFound" })]))).toBe(true)
		expect(isNotFound(run(loaded(), [Message.FailedFetchDetail({ reason: "Offline" })]))).toBe(false)
	})

	test("an answer for a metric the user left is dropped", () => {
		const switched = run(loaded(), [Message.ClickedUsageRange({ range: "90d" })])
		const stale = run(switched, [
			Message.SucceededFetchUsage({ metricKey: "active_users", range: "30d", series: [] }),
		])
		expect(stale.usage._tag).toBe("Loading")
		const fresh = run(switched, [
			Message.SucceededFetchUsage({ metricKey: "active_users", range: "90d", series: [] }),
		])
		expect(fresh.usage._tag).toBe("Success")
	})

	test("an activity filter restarts the timeline and drops answers for the old one", () => {
		const activity = routeChanged(loaded(), route("activity"), shared).model
		const filtered = update(activity, Message.ClickedEventProvider({ provider: "stripe" }), shared)
		expect(commandNames(filtered)).toEqual(["FetchCustomerEvents"])
		expect(filtered.commands?.[0]?.args).toMatchObject({ providers: ["stripe"], cursor: null })
		const stale = run(filtered.model, [
			Message.SucceededFetchEvents({ filter: "all:all", page: { items: [], nextCursor: "50" } }),
		])
		expect(stale.events.status).toBe("Loading")
	})
})

describe("customer page: owner and tags", () => {
	test("changing the owner updates the account at once", () => {
		const model = loaded()
		const result = pick(
			model,
			(message) => Message.GotOwnerMenuMessage({ message }),
			`user:${grace}`,
			ownerEntries(model.members),
		)
		expect(commandNames(result)).toEqual(["UpdateCustomerAccount"])
		expect(result.commands?.[0]?.args).toMatchObject({ ownerUserId: grace, accountId: beta.id })
		expect(result.model.accounts?.find((row) => row.id === beta.id)?.ownerUserId).toBe(grace)
		const removed = pick(
			model,
			(message) => Message.GotOwnerMenuMessage({ message }),
			"none",
			ownerEntries(model.members),
		)
		expect(removed.model.accounts?.find((row) => row.id === beta.id)?.ownerUserId).toBeNull()
	})

	test("tags add once and remove", () => {
		const added = update(
			run(loaded(), [Message.ChangedTagInput({ value: " renewal " })]),
			Message.SubmittedTag(),
			shared,
		)
		expect(added.model.accounts?.find((row) => row.id === beta.id)?.tags).toEqual(["pilot", "renewal"])
		expect(commandNames(added)).toContain("UpdateCustomerAccount")
		const duplicate = update(
			run(loaded(), [Message.ChangedTagInput({ value: "pilot" })]),
			Message.SubmittedTag(),
			shared,
		)
		expect(commandNames(duplicate)).not.toContain("UpdateCustomerAccount")
		const removed = update(loaded(), Message.RemovedTag({ tag: "pilot" }), shared)
		expect(removed.model.accounts?.find((row) => row.id === beta.id)?.tags).toEqual([])
	})
})

describe("customer page: notes", () => {
	test("pinned first, then newest", () => {
		expect(sortedNotes(loaded()).map((row) => row.body)).toEqual(["Note 2", "Note 1", "Note 3"])
	})

	test("saving a note clears the composer and creates it", () => {
		const typed = run(loaded("notes"), [
			Message.ChangedComposer({ value: "  Call booked  " }),
			Message.ToggledComposerPin({ pinned: true }),
		])
		const result = update(typed, Message.SubmittedNote(), shared)
		expect(commandNames(result)).toEqual(["CreateCustomerNote"])
		expect(result.commands?.[0]?.args).toMatchObject({
			body: "Call booked",
			pinned: true,
			authorUserId: ada,
		})
		expect(result.model.composer).toEqual({ body: "", pinned: false })
		expect(commandNames(update(loaded(), Message.SubmittedNote(), shared))).toEqual([])
	})

	test("pin, edit and delete apply to the list at once", () => {
		const target = note(1).id
		const pinned = update(loaded(), Message.PressedPinNote({ noteId: target, pinned: true }), shared)
		expect(pinned.model.notes?.find((row) => row.id === target)?.pinned).toBe(true)
		expect(commandNames(pinned)).toEqual(["UpdateCustomerNote"])

		const editing = run(loaded(), [
			Message.PressedEditNote({ noteId: target }),
			Message.ChangedEditNote({ value: "Edited" }),
		])
		const edited = update(editing, Message.SubmittedEditNote(), shared)
		expect(edited.model.editingNote).toBeNull()
		expect(edited.model.notes?.find((row) => row.id === target)).toMatchObject({
			body: "Edited",
			editedAtMs: NOW,
		})

		const deleted = update(editing, Message.PressedDeleteNote({ noteId: target }), shared)
		expect(deleted.model.notes?.map((row) => row.id)).not.toContain(target)
		expect(deleted.model.editingNote).toBeNull()
		expect(commandNames(deleted)).toEqual(["DeleteCustomerNote"])
	})

	test("Add note opens the notes tab and focuses the composer", () => {
		const result = update(loaded(), Message.PressedAddNote(), shared)
		expect(result.outMessage).toMatchObject({ route: route("notes") })
		expect(commandNames(result)).toEqual(["FocusNoteComposer"])
	})
})

describe("customer page: signals", () => {
	test("snooze and assign from a signal's menus", () => {
		const opened = update(
			loaded(),
			Message.PressedSignalMenu({ signalId: signal.id, menu: "snooze" }),
			shared,
		)
		expect(opened.model.activeSignalId).toBe(signal.id)
		expect(opened.model.snoozeMenu.popup._tag).toBe("Open")
		const snoozed = update(
			opened.model,
			Message.GotSnoozeMenuMessage({
				message: Menu.Message.ClickedItem({ key: "next_week", entries: snoozeEntries }),
			}),
			shared,
		)
		expect(snoozed.model.signals?.[0]?.status).toBe("snoozed")
		expect(commandNames(snoozed)).toContain("SnoozeCustomerSignal")

		const more = update(
			loaded(),
			Message.PressedSignalMenu({ signalId: signal.id, menu: "more" }),
			shared,
		)
		const assigned = update(
			more.model,
			Message.GotSignalMoreMenuMessage({
				message: Menu.Message.ClickedItem({ key: "assign_me", entries: signalMoreEntries }),
			}),
			shared,
		)
		expect(assigned.model.signals?.[0]?.assigneeUserId).toBe(ada)
		expect(commandNames(assigned)).toContain("AssignCustomerSignal")
	})
})
