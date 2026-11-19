// @vitest-environment jsdom
import * as Customers from "@hazel/domain/customers"
import type { SignalEvidence } from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerContactId,
	CustomerEventId,
	CustomerNoteId,
	CustomerOverviewLayoutId,
	CustomerSignalId,
	CustomerSignalRuleId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Effect, Fiber, Option, Schema, Stream } from "effect"
import { describe, expect, test } from "vitest"
import * as OverviewData from "../../../customers/overview/data"
import type { LayoutRow } from "../../../customers/overview/rows"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { snoozeUntil } from "../../../customers/ui/menus"
import { AppRoute, type CustomerTab } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import type { Shared } from "../../contract"
import { sharedDefaults } from "../../test-shared"
import { Message } from "./message"
import {
	actionEntries,
	AUTOMATIC_LAYOUT,
	canImpersonate,
	EMPTY_NOTE_DRAFTS,
	environmentEntries,
	isNotFound,
	layoutEntries,
	linkCandidates,
	type Model,
	type NoteRow,
	openSignals,
	overviewLayoutOf,
	ownerEntries,
	positionOf,
	signalMoreEntries,
	snoozeEntries,
	sortedNotes,
} from "./model"
import { page } from "./index"
import {
	clearNoteDrafts,
	readNoteDrafts,
	restoredNoteDrafts,
	restoreNoteDraft,
	writeNoteDrafts,
} from "./note-drafts"
import { init, routeChanged, update } from "./update"
import { StartCustomerImpersonation } from "./commands"

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
	featureFlags: {},
	primaryAccountId: null,
	environment: null,
	attentionMutedAtMs: null,
	attentionMutedUntilMs: null,
	attentionMutedByUserId: null,
	pinnedLayoutId: null,
	layoutId: null,
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

const layout = (n: number, name: string, isDefault: boolean): LayoutRow => ({
	id: Schema.decodeSync(CustomerOverviewLayoutId)(uuid(500 + n)),
	name,
	position: n,
	isDefault,
	rule: Customers.EMPTY_LAYOUT_RULE,
	widgets: Customers.DEFAULT_LAYOUT_WIDGETS,
	accountCount: 0,
	updatedBy: null,
	updatedAtMs: NOW,
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
		expect(commandNames(init(route(null), shared))).toEqual(
			expect.arrayContaining(["FetchOverviewMetricWindows", "FetchOverviewChartSeries"]),
		)
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

	test("a layout's new chart range replaces the viewer's pick; other picks stay", () => {
		const usage = Customers.DEFAULT_LAYOUT_WIDGETS.find((widget) => widget.id === "usage")
		if (usage?._tag !== "chart") throw new Error("the default layout has a usage chart")
		const base = layout(2, "Default", true)
		const picked = run(loaded(), [
			Message.UpdatedLayouts({ layouts: [base] }),
			Message.GotOverviewDataMessage({
				message: OverviewData.Message.ClickedChartRange({ widgetId: "usage", range: "7d" }),
			}),
		])
		expect(picked.overview.charts.usage?.range).toBe("7d")
		const same = run(picked, [Message.UpdatedLayouts({ layouts: [{ ...base, name: "Renamed" }] })])
		expect(same.overview.charts.usage?.range).toBe("7d")
		const changed = update(
			picked,
			Message.UpdatedLayouts({
				layouts: [
					{
						...base,
						widgets: base.widgets.map((widget) =>
							widget.id === "usage" ? { ...usage, range: "90d" as const } : widget,
						),
					},
				],
			}),
			shared,
		)
		expect(changed.model.overview.charts.usage?.range).toBe("90d")
		expect(commandNames(changed)).toContain("FetchOverviewChartSeries")
	})

	test("a chart that leaves the active layout drops its state; coming back opens at its own range", () => {
		const base = layout(2, "Default", true)
		const other = { ...layout(1, "Observability", false), widgets: [] }
		const picked = run(loaded(), [
			Message.UpdatedLayouts({ layouts: [other, base] }),
			Message.GotOverviewDataMessage({
				message: OverviewData.Message.ClickedChartRange({ widgetId: "usage", range: "7d" }),
			}),
		])
		const away = run(picked, [
			Message.UpdatedAccounts({ accounts: [acme, { ...beta, layoutId: other.id }, gamma] }),
		])
		expect(away.overview.charts.usage).toBeUndefined()
		const back = run(away, [
			Message.UpdatedAccounts({ accounts: [acme, { ...beta, layoutId: base.id }, gamma] }),
		])
		expect(back.overview.charts.usage?.range).toBe("30d")
	})

	test("a chart's answer for a range the user left is dropped", () => {
		const series = (asked: string) =>
			Message.GotOverviewDataMessage({
				message: OverviewData.Message.SucceededFetchChartSeries({
					accountId: beta.id,
					widgetId: "usage",
					asked,
					series: [],
				}),
			})
		const switched = run(loaded(), [
			Message.GotOverviewDataMessage({
				message: OverviewData.Message.ClickedChartRange({ widgetId: "usage", range: "90d" }),
			}),
		])
		expect(run(switched, [series("active_users@30d")]).overview.charts.usage?.series._tag).toBe("Loading")
		expect(run(switched, [series("active_users@90d")]).overview.charts.usage?.series._tag).toBe("Success")
	})

	test("the Overview draws the layout Hazel assigned, else the default", () => {
		const layouts = [layout(1, "Observability", false), layout(2, "Default", true)]
		const withLayouts = run(loaded(), [Message.UpdatedLayouts({ layouts })])
		expect(overviewLayoutOf(withLayouts).layout?.name).toBe("Default")
		const assigned = run(withLayouts, [
			Message.UpdatedAccounts({ accounts: [acme, { ...beta, layoutId: layouts[0]!.id }, gamma] }),
		])
		expect(overviewLayoutOf(assigned).layout?.name).toBe("Observability")
		expect(overviewLayoutOf(loaded()).widgets).toEqual(Customers.DEFAULT_LAYOUT_WIDGETS)
	})

	test("the layout menu pins the customer, or hands it back to the rules", () => {
		const layouts = [layout(1, "Observability", false), layout(2, "Default", true)]
		const withLayouts = run(loaded(), [Message.UpdatedLayouts({ layouts })])
		const wrap = (message: Menu.Message) => Message.GotLayoutMenuMessage({ message })
		const pinned = pick(withLayouts, wrap, layouts[0]!.id, layoutEntries(layouts))
		expect(commandNames(pinned)).toEqual(["SetCustomerLayout"])
		expect(pinned.commands?.[0]?.args).toMatchObject({ layoutId: layouts[0]!.id })
		const automatic = pick(withLayouts, wrap, AUTOMATIC_LAYOUT, layoutEntries(layouts))
		expect(commandNames(automatic)).toEqual([])
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
			Message.GotOverviewDataMessage({
				message: OverviewData.Message.SucceededFetchChartSeries({
					accountId: beta.id,
					widgetId: "usage",
					asked: "active_users@30d",
					series: [],
				}),
			}),
		])
		expect(stale.detail._tag).toBe("Loading")
		expect(stale.overview.charts.usage?.series._tag).toBe("Loading")
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

describe("customer page: feature flags", () => {
	test("the ticked flags turn on at once, and one turns off", () => {
		const added = update(
			run(loaded(), [
				Message.UpdatedCreatedFeatureFlags({ keys: ["beta", "new_nav"] }),
				Message.ToggledFlagSelection({ key: "beta", isSelected: true }),
				Message.ToggledFlagSelection({ key: "new_nav", isSelected: true }),
			]),
			Message.PressedAddFlags(),
			shared,
		)
		expect(added.model.flagSelection).toEqual([])
		expect(added.commands?.at(-1)).toMatchObject({
			name: "SetCustomerFeatureFlags",
			args: { accountId: beta.id, keys: ["beta", "new_nav"], enabled: true },
		})
		expect(
			update(loaded(), Message.PressedRemoveFlag({ key: "beta" }), shared).commands?.[0],
		).toMatchObject({
			name: "SetCustomerFeatureFlags",
			args: { accountId: beta.id, keys: ["beta"], enabled: false },
		})
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

	test("Mute in Needs attention mutes until unmuted; Unmute brings the customer back", () => {
		const wrap = (message: Menu.Message) => Message.GotActionsMenuMessage({ message })
		const opened = run(loaded(), [
			wrap(Menu.Message.PressedTrigger({ pointerType: "mouse" })),
			wrap(
				Menu.Message.ClickedItem({
					key: "mute_attention",
					entries: actionEntries(loaded(), false, false),
				}),
			),
		])
		const muting = update(
			opened,
			wrap(
				Menu.Message.ClickedItem({
					key: "mute:forever",
					entries: actionEntries(loaded(), false, false),
				}),
			),
			shared,
		)
		const accountOf = (current: Model) => current.accounts?.find((row) => row.id === current.accountId)
		expect(accountOf(muting.model)).toMatchObject({
			attentionMutedAtMs: NOW,
			attentionMutedUntilMs: null,
			attentionMutedByUserId: ada,
		})
		expect(commandNames(muting)).toEqual(["SetCustomerAttentionMute"])
		const unmuting = pick(muting.model, wrap, "unmute_attention", actionEntries(loaded(), false, true))
		expect(accountOf(unmuting.model)).toMatchObject({
			attentionMutedAtMs: null,
			attentionMutedByUserId: null,
		})
		expect(commandNames(unmuting)).toEqual(["SetCustomerAttentionMute"])
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

	test("a save failing after the user came back reaches the open instance before its write-back", async () => {
		const open = run(init(route("notes", gamma.id), shared).model, [
			Message.LoadedNoteDrafts({ drafts: EMPTY_NOTE_DRAFTS }),
		])
		const restored = await Effect.runPromise(
			Effect.gen(function* () {
				const listening = yield* restoredNoteDrafts(gamma.id).pipe(
					Stream.take(1),
					Stream.runCollect,
					Effect.forkChild({ startImmediately: true }),
				)
				yield* restoreNoteDraft(beta.id, { noteId: null, body: "For Beta" })
				yield* restoreNoteDraft(gamma.id, { noteId: null, body: "Call booked" })
				return yield* Fiber.join(listening)
			}),
		)
		expect(restored).toEqual([{ noteId: null, body: "Call booked" }])
		const shown = run(
			open,
			restored.map((draft) => Message.RestoredNoteDraft({ draft })),
		)
		// The instance's drafts, which it writes back, now hold the text.
		expect(shown.composer.body).toBe("Call booked")

		// A new sign-in drops every customer's drafts.
		Effect.runSync(clearNoteDrafts)
		expect(Effect.runSync(readNoteDrafts(beta.id))).toEqual(EMPTY_NOTE_DRAFTS)
		expect(Effect.runSync(readNoteDrafts(gamma.id))).toEqual(EMPTY_NOTE_DRAFTS)
	})

	test("a failed edit of a deleted note drops its text", () => {
		const failed = update(
			loaded("notes"),
			Message.FailedNoteAction({
				action: "update",
				reason: "NotFound",
				draft: { noteId: note(1).id, body: "Edited" },
			}),
			shared,
		)
		expect(failed.model.editingNote).toBeNull()
	})

	test("one instance per organization and customer", () => {
		const onHazel = Option.getOrThrow(page.init(route("notes", gamma.id), shared, 1))
		const onAcme = Option.getOrThrow(
			page.init(
				AppRoute.CustomerDetail({ orgSlug: "acme", accountId: gamma.id, tab: Option.none() }),
				shared,
				2,
			),
		)
		expect(onHazel.slot.key).not.toBe(onAcme.slot.key)
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

describe("customer page: impersonation", () => {
	const contactId = Schema.decodeSync(CustomerContactId)
	const contactRow = (n: number, name: string): Customers.ContactRow => ({
		contact: {
			id: contactId(uuid(500 + n)),
			accountId: beta.id,
			email: `${name.toLowerCase()}@beta.test`,
			name,
			avatarUrl: null,
			title: null,
			role: null,
			isBillingContact: false,
			joinedAt: null,
			firstActiveAt: null,
			lastSeenAt: null,
			lastSignInAt: null,
			signInCount30d: 0,
			eventCount30d: 0,
			attributes: {},
			fieldSources: {},
			createdAt: new Date(NOW),
			updatedAt: new Date(NOW),
			deletedAt: null,
		},
		status: "active",
		activity: [],
	})
	const linus = contactRow(1, "Linus")
	const margaret = contactRow(2, "Margaret")
	const users = (isImpersonator = true) =>
		run(routeChanged(loaded(), route("users"), shared).model, [
			Message.SucceededFetchContacts({
				accountId: beta.id,
				page: { items: [linus, margaret], nextCursor: null },
			}),
			Message.UpdatedConnectedProviders({ providers: ["clerk", "stripe"] }),
			Message.UpdatedIsImpersonator({ isImpersonator }),
		])
	const impersonate = (model: Model) =>
		update(model, Message.PressedImpersonate({ contactId: linus.contact.id }), shared)

	test("Impersonate shows only to a granted user, while Clerk is connected", () => {
		expect(canImpersonate(users(false))).toBe(false)
		expect(canImpersonate(users())).toBe(true)
		expect(
			canImpersonate(run(users(), [Message.UpdatedConnectedProviders({ providers: ["stripe"] })])),
		).toBe(false)
	})

	test("Impersonate opens the dialog at once, asking; the link lands in it; closing drops it", () => {
		const asked = impersonate(users())
		expect(asked.model.impersonateModal.isOpen).toBe(true)
		expect(asked.model.impersonation).toEqual({
			attempt: 1,
			contactId: linus.contact.id,
			name: "Linus",
			url: null,
			failure: null,
		})
		expect(
			asked.commands?.find((command) => command.name === "StartCustomerImpersonation")?.args,
		).toEqual(
			StartCustomerImpersonation({ organizationId, contactId: linus.contact.id, attempt: 1 }).args,
		)
		const url = "https://accounts.beta.test/v1/tickets/accept?ticket=t_1"
		const answered = run(asked.model, [Message.SucceededStartImpersonation({ attempt: 1, url })])
		expect(answered.impersonation?.url).toBe(url)
		const closed = run(answered, [
			Message.GotImpersonateModalMessage({ message: Modal.Message.RequestedClose() }),
		])
		expect(closed.impersonateModal.isOpen).toBe(false)
		expect(closed.impersonation).toBeNull()
		// An answer for a dialog closed since is dropped.
		expect(
			run(closed, [Message.SucceededStartImpersonation({ attempt: 1, url })]).impersonation,
		).toBeNull()
	})

	test("an earlier attempt's late answer never lands in the reopened dialog for the same user", () => {
		const first = impersonate(users()).model
		const closed = run(first, [
			Message.GotImpersonateModalMessage({ message: Modal.Message.RequestedClose() }),
		])
		const reopened = impersonate(closed).model
		expect(reopened.impersonation?.attempt).toBe(2)
		const url = "https://accounts.beta.test/v1/tickets/accept?ticket=t_2"
		const late = run(reopened, [
			Message.SucceededStartImpersonation({ attempt: 2, url }),
			Message.FailedStartImpersonation({ attempt: 1, reason: "Offline" }),
			Message.SucceededStartImpersonation({ attempt: 1, url: "https://stale.test" }),
		])
		expect(late.impersonation).toMatchObject({ attempt: 2, url, failure: null })
	})

	test("a refusal keeps the provider's explanation for the dialog", () => {
		const refused = run(impersonate(users()).model, [
			Message.FailedStartImpersonation({
				attempt: 1,
				reason: { _tag: "Refused", message: "You have reached your monthly impersonation limit." },
			}),
		])
		expect(refused.impersonateModal.isOpen).toBe(true)
		expect(refused.impersonation?.failure).toEqual({
			_tag: "Refused",
			message: "You have reached your monthly impersonation limit.",
		})
		expect(refused.impersonation?.url).toBeNull()
	})
})

describe("customer page: environments", () => {
	// Delta's US primary (with a signal) and its EU environment.
	const delta: AccountRow = { ...account(4, "Delta"), environment: "US" }
	const deltaEu: AccountRow = { ...account(5, "Delta"), primaryAccountId: delta.id, environment: "EU" }
	const deltaSignal: SignalRow = {
		...signal,
		id: Schema.decodeSync(CustomerSignalId)(uuid(210)),
		accountId: delta.id,
	}
	const loadedOn = (id: CustomerAccountId): Model =>
		run(init(route(null, id), shared).model, [
			Message.UpdatedAccounts({ accounts: [acme, beta, gamma, delta, deltaEu] }),
			Message.UpdatedSignals({ signals: [signal, deltaSignal] }),
		])
	const keysOf = (entries: ReadonlyArray<Menu.Entry>) =>
		entries.flatMap((entry) => (entry._tag === "Item" ? [entry.item.key] : []))
	const accountIn = (model: Model, id: CustomerAccountId) => model.accounts?.find((row) => row.id === id)
	const action = (model: Model, key: string) =>
		pick(
			model,
			(message) => Message.GotActionsMenuMessage({ message }),
			key,
			actionEntries(model, true, false),
		)

	test("a grouped account lists its environments, primary first, and opens another", () => {
		const onEu = loadedOn(deltaEu.id)
		expect(keysOf(environmentEntries(onEu))).toEqual([delta.id, deltaEu.id])
		expect(environmentEntries(loadedOn(beta.id))).toEqual([])
		const opened = pick(
			onEu,
			(message) => Message.GotEnvironmentMenuMessage({ message }),
			delta.id,
			environmentEntries(onEu),
		)
		expect(opened.outMessage).toMatchObject({ _tag: "RequestedNavigation", route: route(null, delta.id) })
	})

	test("an environment shows its customer's signals, raised on the primary", () => {
		expect(openSignals(loadedOn(deltaEu.id)).map((row) => row.id)).toEqual([deltaSignal.id])
		expect(openSignals(loadedOn(delta.id)).map((row) => row.id)).toEqual([deltaSignal.id])
	})

	test("grouping is for admins; make primary and unlink only on an environment", () => {
		const grouping = ["link_customer", "make_primary", "unlink", "name_environment"]
		const shown = (model: Model, isAdmin: boolean) =>
			keysOf(actionEntries(model, isAdmin, false)).filter((key) => grouping.includes(key))
		expect(shown(loadedOn(deltaEu.id), false)).toEqual([])
		expect(shown(loadedOn(deltaEu.id), true)).toEqual(grouping)
		expect(shown(loadedOn(delta.id), true)).toEqual(["link_customer", "name_environment"])
	})

	test("linking picks another customer's primary, once, and shows the store's refusal", () => {
		const opened = action(loadedOn(beta.id), "link_customer").model
		expect(opened.linkModal.isOpen).toBe(true)
		// Not itself, not an environment: those can't lead a customer.
		expect(linkCandidates(opened).map((row) => row.id)).toEqual([acme.id, gamma.id, delta.id])
		const searched = run(opened, [Message.ChangedLinkQuery({ value: "us" })])
		expect(linkCandidates(searched).map((row) => row.id)).toEqual([delta.id])
		expect(run(searched, [Message.PickedLinkPrimary({ pickedId: deltaEu.id })]).linkPrimaryId).toBeNull()
		const picked = run(searched, [Message.PickedLinkPrimary({ pickedId: delta.id })])
		const linking = update(picked, Message.PressedConfirmLink(), shared)
		expect(commandNames(linking)).toEqual(["LinkCustomerAccount"])
		expect(linking.commands?.[0]?.args).toMatchObject({ accountId: beta.id, primaryAccountId: delta.id })
		expect(commandNames(update(linking.model, Message.PressedConfirmLink(), shared))).toEqual([])

		const refusal = "Delta is an environment of another customer: link to its primary"
		const refused = run(linking.model, [
			Message.FailedGroupAction({
				accountId: beta.id,
				action: "link",
				reason: "Stale",
				message: refusal,
			}),
		])
		expect(refused.linkModal.isOpen).toBe(true)
		expect(refused.linkError).toBe(refusal)
		expect(refused.isLinking).toBe(false)

		const linked = update(
			update(refused, Message.PressedConfirmLink(), shared).model,
			Message.SucceededGroupAction({ accountId: beta.id, action: "link" }),
			shared,
		)
		expect(linked.model.linkModal.isOpen).toBe(false)
		expect(accountIn(linked.model, beta.id)?.primaryAccountId).toBe(delta.id)
		expect(linked.outMessage).toMatchObject({ _tag: "RequestedToast" })
	})

	test("make primary and unlink regroup at once and run their RPC", () => {
		const promoted = action(loadedOn(deltaEu.id), "make_primary")
		expect(commandNames(promoted)).toEqual(["SetCustomerPrimary"])
		expect(promoted.commands?.[0]?.args).toMatchObject({ accountId: deltaEu.id })
		expect(accountIn(promoted.model, delta.id)?.primaryAccountId).toBe(deltaEu.id)
		expect(accountIn(promoted.model, deltaEu.id)?.primaryAccountId).toBeNull()

		const unlinked = action(loadedOn(deltaEu.id), "unlink")
		expect(commandNames(unlinked)).toEqual(["UnlinkCustomerAccount"])
		expect(accountIn(unlinked.model, deltaEu.id)?.primaryAccountId).toBeNull()
		const failed = update(
			unlinked.model,
			Message.FailedGroupAction({
				accountId: deltaEu.id,
				action: "unlink",
				reason: "Offline",
				message: null,
			}),
			shared,
		)
		expect(failed.outMessage).toMatchObject({ _tag: "RequestedToast" })
	})

	test("naming the environment saves the trimmed text; empty clears it", () => {
		const opened = action(loadedOn(deltaEu.id), "name_environment").model
		expect(opened.environmentModal.isOpen).toBe(true)
		expect(opened.environmentDraft).toBe("EU")
		const saving = update(
			run(opened, [Message.ChangedEnvironmentDraft({ value: "  Europe " })]),
			Message.SubmittedEnvironment(),
			shared,
		)
		expect(commandNames(saving)).toEqual(["SetCustomerEnvironment"])
		expect(saving.commands?.[0]?.args).toMatchObject({ accountId: deltaEu.id, environment: "Europe" })
		expect(commandNames(update(saving.model, Message.SubmittedEnvironment(), shared))).toEqual([])
		const saved = run(saving.model, [
			Message.SucceededGroupAction({ accountId: deltaEu.id, action: "set_environment" }),
		])
		expect(saved.environmentModal.isOpen).toBe(false)
		expect(accountIn(saved, deltaEu.id)?.environment).toBe("Europe")

		const cleared = update(
			run(action(saved, "name_environment").model, [Message.ChangedEnvironmentDraft({ value: "   " })]),
			Message.SubmittedEnvironment(),
			shared,
		)
		expect(cleared.commands?.[0]?.args).toMatchObject({ environment: null })
	})
})
