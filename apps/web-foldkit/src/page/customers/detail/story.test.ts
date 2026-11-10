// @vitest-environment jsdom
import type * as Customers from "@hazel/domain/customers"
import type { SignalEvidence } from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerEventId,
	CustomerNoteId,
	CustomerSignalId,
	CustomerSignalRuleId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { snoozeUntil } from "../../../customers/ui/menus"
import { AppRoute, type CustomerTab } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { sharedDefaults } from "../../test-shared"
import { Message } from "./message"
import {
	EMPTY_NOTE_DRAFTS,
	isNotFound,
	type Model,
	type NoteRow,
	ownerEntries,
	positionOf,
	signalMoreEntries,
	snoozeEntries,
	sortedNotes,
} from "./model"
import { page } from "./index"
import { restoreNoteDraft, writeNoteDrafts } from "./note-drafts"
import { init, routeChanged, update } from "./update"

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
		expect(commandNames(init(route(null), shared))).toContain("FetchCustomerUsage")
		expect(commandNames(init(route("users"), shared))).toContain("FetchCustomerContacts")
		const billing = routeChanged(loaded(), route("billing"), shared)
		expect(billing.model.tab).toBe("billing")
		expect(commandNames(billing)).toContain("FetchCustomerInvoices")
		expect(commandNames(billing)).toContain("FetchCustomerMrrHistory")
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
		expect(
			isNotFound(
				run(loaded(), [Message.FailedFetchDetail({ accountId: beta.id, reason: "NotFound" })]),
			),
		).toBe(true)
		expect(
			isNotFound(run(loaded(), [Message.FailedFetchDetail({ accountId: beta.id, reason: "Offline" })])),
		).toBe(false)
	})

	test("an account merged or deleted while shown is not found; one still syncing is not", () => {
		// Only its tag matters here; the constructor would check a whole detail.
		const fetched = { _tag: "SucceededFetchDetail", accountId: beta.id, detail: {} } as Message
		const shown = run(loaded(), [fetched])
		expect(isNotFound(shown)).toBe(false)
		expect(isNotFound(run(shown, [Message.UpdatedAccounts({ accounts: [acme, gamma] })]))).toBe(true)
		const syncing = run(init(route(null), shared).model, [
			fetched,
			Message.UpdatedAccounts({ accounts: [acme] }),
		])
		expect(isNotFound(syncing)).toBe(false)
	})

	test("an answer for a metric the user left is dropped", () => {
		const switched = run(loaded(), [Message.ClickedUsageRange({ range: "90d" })])
		const stale = run(switched, [
			Message.SucceededFetchUsage({
				accountId: beta.id,
				metricKey: "active_users",
				range: "30d",
				series: [],
			}),
		])
		expect(stale.usage._tag).toBe("Loading")
		const fresh = run(switched, [
			Message.SucceededFetchUsage({
				accountId: beta.id,
				metricKey: "active_users",
				range: "90d",
				series: [],
			}),
		])
		expect(fresh.usage._tag).toBe("Success")
	})

	test("an activity filter restarts the timeline and drops answers for the old one", () => {
		const activity = routeChanged(loaded(), route("activity"), shared).model
		const filtered = update(activity, Message.ClickedEventProvider({ provider: "stripe" }), shared)
		expect(commandNames(filtered)).toEqual(["FetchCustomerEvents"])
		expect(filtered.commands?.[0]?.args).toMatchObject({ providers: ["stripe"], cursor: null })
		const stale = run(filtered.model, [
			Message.SucceededFetchEvents({
				accountId: beta.id,
				filter: "all:all",
				page: { items: [], nextCursor: "50" },
			}),
		])
		expect(stale.events.status).toBe("Loading")
	})

	test("an answer for the customer shown before is dropped", () => {
		const fresh = init(route(null, gamma.id), shared).model
		const stale = run(fresh, [
			Message.FailedFetchDetail({ accountId: beta.id, reason: "NotFound" }),
			Message.SucceededFetchUsage({
				accountId: beta.id,
				metricKey: "active_users",
				range: "30d",
				series: [],
			}),
		])
		expect(stale.detail._tag).toBe("Loading")
		expect(stale.usage._tag).toBe("Loading")
	})

	test("a page appends without repeating rows, and a failed first page can be asked for again", () => {
		const users = routeChanged(loaded(), route("users"), shared).model
		const failed = run(users, [Message.FailedFetchContacts({ accountId: beta.id, reason: "Offline" })])
		const retried = update(failed, Message.PressedMoreContacts(), shared)
		expect(commandNames(retried)).toEqual(["FetchCustomerContacts"])
		expect(retried.commands?.[0]?.args).toMatchObject({ cursor: null })
		expect(commandNames(update(users, Message.PressedMoreContacts(), shared))).toEqual([])

		const event = (n: number): Customers.Event => ({
			id: Schema.decodeSync(CustomerEventId)(uuid(400 + n)),
			accountId: beta.id,
			contactId: null,
			provider: "hazel",
			type: "note.created",
			title: `Event ${n}`,
			data: {},
			occurredAt: new Date(NOW),
			externalId: null,
			actorUserId: null,
			createdAt: new Date(NOW),
		})
		const activity = routeChanged(loaded(), route("activity"), shared).model
		const appended = run(activity, [
			Message.SucceededFetchEvents({
				accountId: beta.id,
				filter: "all:all",
				page: { items: [event(1), event(2)], nextCursor: "2" },
			}),
			Message.SucceededFetchEvents({
				accountId: beta.id,
				filter: "all:all",
				page: { items: [event(2), event(3)], nextCursor: null },
			}),
		])
		expect(appended.events.items.map((item) => item.title)).toEqual(["Event 1", "Event 2", "Event 3"])
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

	test("pin, edit and a confirmed delete apply to the list at once", () => {
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

		const asking = update(editing, Message.PressedDeleteNote({ noteId: target }), shared)
		expect(asking.model.deleteNoteModal.isOpen).toBe(true)
		expect(asking.model.notes?.map((row) => row.id)).toContain(target)
		expect(commandNames(asking)).toEqual([])
		const deleted = update(asking.model, Message.PressedConfirmDeleteNote(), shared)
		expect(deleted.model.deleteNoteModal.isOpen).toBe(false)
		expect(deleted.model.notes?.map((row) => row.id)).not.toContain(target)
		expect(deleted.model.editingNote).toBeNull()
		expect(commandNames(deleted)).toEqual(["DeleteCustomerNote"])
	})

	test("a failed save or edit puts the text back", () => {
		const saved = update(
			run(loaded("notes"), [Message.ChangedComposer({ value: "Call booked" })]),
			Message.SubmittedNote(),
			shared,
		).model
		const failed = (draft: { noteId: CustomerNoteId | null; body: string }, model: Model) =>
			update(
				model,
				Message.FailedNoteAction({
					action: draft.noteId === null ? "create" : "update",
					reason: "Offline",
					draft,
				}),
				shared,
			)
		const restored = failed({ noteId: null, body: "Call booked" }, saved)
		expect(restored.model.composer.body).toBe("Call booked")
		// The Command tells the user itself (`showBackgroundToast`): the page may be gone by then.
		expect(restored.outMessage).toBeUndefined()
		expect(failed({ noteId: note(1).id, body: "Edited" }, saved).model.editingNote).toEqual({
			noteId: note(1).id,
			body: "Edited",
		})
		const typedSince = run(saved, [Message.ChangedComposer({ value: "Next one" })])
		expect(failed({ noteId: null, body: "Call booked" }, typedSince).model.composer.body).toBe("Next one")
	})

	test("a failed save answering after the user left for another customer stays with its own", () => {
		const fromBeta = Option.getOrThrow(page.init(route("notes", beta.id), shared, 1))
		const onAcme = Option.getOrThrow(page.init(route("notes", acme.id), shared, 2))
		const answer = {
			_tag: "CustomerDetail" as const,
			key: `${fromBeta.slot.key}#${fromBeta.slot.instance}`,
			message: Message.FailedNoteAction({
				action: "create",
				reason: "Offline",
				draft: { noteId: null, body: "Call booked" },
			}),
		}
		expect(Option.isNone(page.update(onAcme.slot, answer, shared))).toBe(true)
		expect(Option.getOrThrow(page.update(fromBeta.slot, answer, shared)).slot.model.composer.body).toBe(
			"Call booked",
		)
	})

	test("unsent text outlives the page instance: Prev/Next and back finds it again", () => {
		const loadDrafts = (opened: ReturnType<typeof init>) => {
			const command = opened.commands?.find((entry) => entry.name === "LoadNoteDrafts")
			if (command === undefined) throw new Error("no LoadNoteDrafts")
			return Effect.runSync(command.effect as Effect.Effect<Message>)
		}
		const opened = init(route("notes", gamma.id), shared)
		// Nothing is written over the kept drafts before they are read back.
		expect(opened.model.hasLoadedDrafts).toBe(false)
		const typed = run(opened.model, [
			loadDrafts(opened),
			Message.ChangedComposer({ value: "Renewal call" }),
		])
		Effect.runSync(
			writeNoteDrafts(gamma.id, { composer: typed.composer, editingNote: typed.editingNote }),
		)
		const back = init(route("notes", gamma.id), shared)
		expect(run(back.model, [loadDrafts(back)]).composer.body).toBe("Renewal call")

		// A save that fails after the user left keeps its text for the customer.
		Effect.runSync(writeNoteDrafts(gamma.id, EMPTY_NOTE_DRAFTS))
		Effect.runSync(restoreNoteDraft(gamma.id, { noteId: null, body: "Call booked" }))
		const returned = init(route("notes", gamma.id), shared)
		expect(run(returned.model, [loadDrafts(returned)]).composer.body).toBe("Call booked")
		Effect.runSync(writeNoteDrafts(gamma.id, EMPTY_NOTE_DRAFTS))
	})

	test("the delete confirmation runs once, for the note it asked about", () => {
		const asking = update(loaded(), Message.PressedDeleteNote({ noteId: note(1).id }), shared).model
		const deleted = update(asking, Message.PressedConfirmDeleteNote(), shared)
		expect(deleted.model.deletingNoteId).toBeNull()
		expect(commandNames(update(deleted.model, Message.PressedConfirmDeleteNote(), shared))).toEqual([])
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
		// The queue's presets: "Next week" is next Monday at 9:00, as in Needs attention.
		expect(snoozed.model.signals?.[0]?.snoozedUntilMs).toBe(
			snoozeUntil("next_week", new Date(NOW)).getTime(),
		)
		expect(commandNames(snoozed)).toContain("SnoozeSignal")

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
		expect(commandNames(assigned)).toContain("AssignSignal")
	})
	test("a failed signal or account action says so; the synced rows roll back on their own", () => {
		const signalFailed = update(
			loaded(),
			Message.FailedSignalAction({ signalId: signal.id, action: "snooze", reason: "Stale" }),
			shared,
		)
		expect(signalFailed.outMessage?._tag).toBe("RequestedToast")
		expect(signalFailed.model.signals).toEqual([signal])
		const accountFailed = update(loaded(), Message.FailedAccountUpdate({ reason: "NotFound" }), shared)
		expect(accountFailed.outMessage?._tag).toBe("RequestedToast")
		// The rollback arrives as the synced rows again, replacing the optimistic patch.
		const patched = update(loaded(), Message.RemovedTag({ tag: "pilot" }), shared).model
		const rolledBack = run(patched, [Message.UpdatedAccounts({ accounts: [acme, beta, gamma] })])
		expect(rolledBack.accounts?.find((row) => row.id === beta.id)?.tags).toEqual(["pilot"])
	})
})
