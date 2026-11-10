import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerNoteId, CustomerSignalId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, MemberRow, msOf, SignalRow } from "../../../customers/queries"
import { CustomerTab } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"

/**
 * One customer (`docs/customers/spec.md` §4): a header over five tabs and a properties sidebar. The
 * synced account, signals and notes are live; detail, series and the paged lists are RPCs, loaded
 * when their tab first shows.
 */

// MODEL

/** A note as the page keeps it. */
export const NoteRow = Schema.Struct({
	id: CustomerNoteId,
	accountId: CustomerAccountId,
	authorUserId: UserId,
	body: Schema.String,
	pinned: Schema.Boolean,
	signalId: Schema.NullOr(CustomerSignalId),
	editedAtMs: Schema.NullOr(Schema.Number),
	createdAtMs: Schema.Number,
})
export type NoteRow = typeof NoteRow.Type

/** A metric the usage chart can show. */
export const MetricRow = Schema.Struct({
	key: Schema.String,
	name: Schema.String,
	unit: Schema.NullOr(Schema.String),
})
export type MetricRow = typeof MetricRow.Type

export const DetailFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type DetailFailure = typeof DetailFailure.Type

export const Detail = AsyncData.Schema(Customers.AccountDetail, DetailFailure)
export const Series = AsyncData.Schema(Schema.Array(Customers.MetricSeries), CommonReason)

export const PageStatus = Schema.Literals(["Idle", "Loading", "Loaded", "Failed"])
export type PageStatus = typeof PageStatus.Type

/** A paged list: the pages so far, the next cursor, and whether a page is on its way. */
const paged = <S extends Schema.Top>(item: S) =>
	Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(Schema.String), status: PageStatus })

export const Contacts = paged(Customers.ContactRow)
export const Invoices = paged(Customers.Invoice.Schema)
export const Events = paged(Customers.Event.Schema)
export type Paged<A> = Readonly<{ items: ReadonlyArray<A>; nextCursor: string | null; status: PageStatus }>

export const EMPTY_PAGE = { items: [], nextCursor: null, status: "Idle" } as const

export const ContactFilter = Schema.Literals(["all", "active", "dormant", "never_active"])
export type ContactFilter = typeof ContactFilter.Type

export const EventType = Schema.Literals(["all", "billing", "signals", "contacts", "health", "notes"])
export type EventType = typeof EventType.Type

/** `customers.events.list` type prefixes per filter. */
export const EVENT_TYPE_PREFIXES = {
	all: [],
	billing: ["invoice.", "subscription."],
	signals: ["signal."],
	contacts: ["contact."],
	health: ["health."],
	notes: ["note."],
} as const satisfies Record<EventType, ReadonlyArray<string>>

export const SignalMenu = Schema.Literals(["snooze", "done", "more"])
export type SignalMenu = typeof SignalMenu.Type

export const Model = Schema.Struct({
	accountId: CustomerAccountId,
	tab: CustomerTab,
	/** Live rows; null until each query answers. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	notes: Schema.NullOr(Schema.Array(NoteRow)),
	members: Schema.Array(MemberRow),
	metrics: Schema.Array(MetricRow),
	connectedProviders: Schema.Array(Customers.CustomerProvider),
	/** The org's health bands (the breakdown's colors and "At risk is 40–69"). */
	bands: Customers.HealthBands,
	detail: Detail.schema,
	usageMetric: Schema.String,
	usageRange: Customers.CustomersRange,
	usage: Series.schema,
	hoveredUsage: Schema.NullOr(Schema.Int),
	mrrHistory: Series.schema,
	hoveredMrr: Schema.NullOr(Schema.Int),
	contacts: Contacts,
	contactFilter: ContactFilter,
	contactSearch: Schema.String,
	invoices: Invoices,
	events: Events,
	eventProvider: Schema.NullOr(Customers.CustomerSource),
	eventType: EventType,
	composer: Schema.Struct({ body: Schema.String, pinned: Schema.Boolean }),
	editingNote: Schema.NullOr(Schema.Struct({ noteId: CustomerNoteId, body: Schema.String })),
	isSidebarOpen: Schema.Boolean,
	ownerMenu: Menu.Model,
	actionsMenu: Menu.Model,
	metricMenu: Menu.Model,
	eventTypeMenu: Menu.Model,
	/** The open signal whose action menus show (each signal row has its own buttons). */
	activeSignalId: Schema.NullOr(CustomerSignalId),
	snoozeMenu: Menu.Model,
	doneMenu: Menu.Model,
	signalMoreMenu: Menu.Model,
	tagPopover: Popover.Model,
	tagInput: Schema.String,
	rawModal: Modal.Model,
})
export type Model = typeof Model.Type

export const OWNER_MENU_ID = "customer-owner"
export const ACTIONS_MENU_ID = "customer-actions"
export const METRIC_MENU_ID = "customer-metric"
export const EVENT_TYPE_MENU_ID = "customer-event-type"
export const SNOOZE_MENU_ID = "customer-signal-snooze"
export const DONE_MENU_ID = "customer-signal-done"
export const SIGNAL_MORE_MENU_ID = "customer-signal-more"
export const TAG_POPOVER_ID = "customer-tag"
export const RAW_MODAL_ID = "customer-raw"
export const COMPOSER_ID = "customer-note-composer"

export const PAGE_SIZE = 50
const DAY_MS = 86_400_000

// WHAT IS SHOWN

export const accountOf = (model: Model): AccountRow | undefined =>
	model.accounts?.find((account) => account.id === model.accountId)

/** "2 of 214": this account's place among all of them (by name), and its neighbours. */
export const positionOf = (
	model: Model,
): Readonly<{
	index: number
	total: number
	previous: AccountRow | null
	next: AccountRow | null
}> | null => {
	const accounts = model.accounts ?? []
	const index = accounts.findIndex((account) => account.id === model.accountId)
	if (index < 0) return null
	return {
		index,
		total: accounts.length,
		previous: accounts[index - 1] ?? null,
		next: accounts[index + 1] ?? null,
	}
}

/** Gone: the RPC says so, or the synced list has loaded without it. */
export const isNotFound = (model: Model): boolean =>
	(model.detail._tag === "Failure" && model.detail.error === "NotFound") ||
	(model.accounts !== null && accountOf(model) === undefined && model.detail._tag !== "Success")

/** Open and snoozed signals on this account, highest priority first. */
export const openSignals = (model: Model): ReadonlyArray<SignalRow> =>
	(model.signals ?? []).filter(
		(signal) =>
			signal.accountId === model.accountId && (signal.status === "open" || signal.status === "snoozed"),
	)

/** Pinned first, then newest. */
export const sortedNotes = (model: Model): ReadonlyArray<NoteRow> =>
	[...(model.notes ?? [])].sort((left, right) =>
		left.pinned === right.pinned ? right.createdAtMs - left.createdAtMs : left.pinned ? -1 : 1,
	)

export const visibleContacts = (model: Model): ReadonlyArray<Customers.ContactRow> => {
	const query = model.contactSearch.trim().toLowerCase()
	return model.contacts.items.filter(
		(row) =>
			(model.contactFilter === "all" || row.status === model.contactFilter) &&
			(query === "" ||
				(row.contact.name ?? "").toLowerCase().includes(query) ||
				(row.contact.email ?? "").toLowerCase().includes(query)),
	)
}

/** The loaded contacts per status. */
export const contactCounts = (model: Model): Readonly<Record<ContactFilter, number>> => {
	const counts = { all: model.contacts.items.length, active: 0, dormant: 0, never_active: 0 }
	for (const row of model.contacts.items) counts[row.status] += 1
	return counts
}

/** An open invoice past its due date, or a subscription in arrears: the billing banner. */
export const paymentIssue = (
	detail: Customers.AccountDetail,
	nowMs: number,
): Readonly<{
	invoice: Customers.Invoice | null
	subscription: Customers.Subscription | null
	daysOverdue: number
}> | null => {
	const msOrNull = (date: Customers.Invoice["dueAt"]) => (date === null ? null : msOf(date))
	const invoice =
		detail.openInvoices.find((entry) => {
			const due = msOrNull(entry.dueAt)
			return due !== null && due < nowMs
		}) ?? null
	const subscription =
		detail.subscriptions.find((entry) => entry.status === "past_due" || entry.status === "unpaid") ?? null
	if (invoice === null && subscription === null) return null
	const due = invoice === null ? null : msOrNull(invoice.dueAt)
	return { invoice, subscription, daysOverdue: due === null ? 0 : Math.floor((nowMs - due) / DAY_MS) }
}

// MENUS

export const OWNER_NONE = "none"
const OWNER_USER = "user:"
export const ownerKeyOf = (userId: UserId) => `${OWNER_USER}${userId}`
export const userIdOfOwnerKey = (key: string): string | null =>
	key.startsWith(OWNER_USER) ? key.slice(OWNER_USER.length) : null

export const ownerEntries = (members: ReadonlyArray<MemberRow>): ReadonlyArray<Menu.Entry> => [
	...members.map((member) => Menu.item(ownerKeyOf(member.id), { textValue: member.name })),
	Menu.separator,
	Menu.item(OWNER_NONE, { textValue: "Remove owner" }),
]

export const ActionKey = Schema.Literals([
	"copy_link",
	"change_owner",
	"recompute",
	"link_source",
	"merge",
	"raw_data",
	"archive",
])
export type ActionKey = typeof ActionKey.Type

/** What the RPCs support runs; the rest shows, disabled, with why. */
export const actionEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("copy_link"),
	Menu.item("change_owner"),
	Menu.item("recompute", { isDisabled: true, hasDescription: true }),
	Menu.separator,
	Menu.item("link_source", { isDisabled: true, hasDescription: true }),
	Menu.item("merge", { isDisabled: true, hasDescription: true }),
	Menu.item("raw_data"),
	Menu.separator,
	Menu.item("archive", { isDisabled: true, intent: "Danger", hasDescription: true }),
]

export const metricEntries = (metrics: ReadonlyArray<MetricRow>): ReadonlyArray<Menu.Entry> =>
	(metrics.length === 0 ? [{ key: "active_users", name: "Active users", unit: null }] : metrics).map(
		(metric) => Menu.item(metric.key, { textValue: metric.name }),
	)

export const eventTypeEntries: ReadonlyArray<Menu.Entry> = EventType.literals.map((type) => Menu.item(type))

/** Snooze presets (days from now, at 9:00 local like the queue's). */
export const SNOOZE_DAYS = { tomorrow: 1, in_3_days: 3, next_week: 7 } as const
export const snoozeEntries: ReadonlyArray<Menu.Entry> = Object.keys(SNOOZE_DAYS).map((key) => Menu.item(key))
export const doneEntries: ReadonlyArray<Menu.Entry> = Customers.SignalOutcome.literals.map((outcome) =>
	Menu.item(outcome),
)

export const ASSIGN_ME = "assign_me"
export const UNASSIGN = "unassign"
export const DISMISS = "dismiss"
export const OPEN_QUEUE = "open_queue"
export const signalMoreEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item(ASSIGN_ME),
	Menu.item(UNASSIGN),
	Menu.separator,
	Menu.item(OPEN_QUEUE),
	Menu.item(DISMISS, { intent: "Danger" }),
]
