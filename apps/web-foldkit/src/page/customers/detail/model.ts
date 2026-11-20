import * as Customers from "@hazel/domain/customers"
import { ChannelLinkRow, ChannelOption } from "../../../customers/channels"
import { SuggestionList } from "../../../customers/suggestions"
import { CustomerAccountId, CustomerContactId, CustomerNoteId, CustomerSignalId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { groupIdOf, groupOf } from "../../../customers/groups"
import { AccountRow, MemberRow, msOf, SignalRow } from "../../../customers/queries"
import { muteLeaves, SNOOZE_KEYS } from "../../../customers/ui/menus"
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

/** A metric the usage chart can show; `unit` is the one set by hand, else the source's. */
export const MetricRow = Schema.Struct({
	key: Schema.String,
	name: Schema.String,
	unit: Schema.NullOr(Schema.String),
	provider: Schema.NullOr(Customers.CustomerProvider),
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

/** The unsent note text: the composer's, and an edit's. */
export const NoteDrafts = Schema.Struct({
	composer: Schema.Struct({ body: Schema.String, pinned: Schema.Boolean }),
	editingNote: Schema.NullOr(Schema.Struct({ noteId: CustomerNoteId, body: Schema.String })),
})
export type NoteDrafts = typeof NoteDrafts.Type

export const EMPTY_NOTE_DRAFTS: NoteDrafts = { composer: { body: "", pinned: false }, editingNote: null }

/**
 * Why signing in as a customer's user failed: the provider would not (`Refused`, with its own
 * explanation), the user has no grant (`NotAllowed`), the contact is gone, or a common reason.
 */
export const ImpersonationFailure = Schema.Union([
	Schema.Literals(["NotAllowed", "NotFound"]),
	Schema.TaggedStruct("Refused", { message: Schema.String }),
	CommonReason,
])
export type ImpersonationFailure = typeof ImpersonationFailure.Type

/** The "Sign in as" dialog: asking (no url, no failure), then the one-time link or why not. */
export const Impersonation = Schema.Struct({
	/** Which press this dialog is for: an answer to an earlier one (closed since) is dropped. */
	attempt: Schema.Number,
	contactId: CustomerContactId,
	name: Schema.String,
	url: Schema.NullOr(Schema.String),
	failure: Schema.NullOr(ImpersonationFailure),
})
export type Impersonation = typeof Impersonation.Type

export const Model = Schema.Struct({
	accountId: CustomerAccountId,
	tab: CustomerTab,
	/** Live rows; null until each query answers. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	/** The synced list has had this account: it leaving then means merged or deleted, not still syncing. */
	hasSeenAccount: Schema.Boolean,
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
	composer: NoteDrafts.fields.composer,
	editingNote: NoteDrafts.fields.editingNote,
	/** The drafts kept for this customer (`note-drafts.ts`) are back; only then are they written. */
	hasLoadedDrafts: Schema.Boolean,
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
	/** The org's live channel links (every account's: a channel shows which customer has it). */
	channelLinks: Schema.Array(ChannelLinkRow),
	/** The org's channels the user sees that can be linked, with their origin. */
	channelOptions: Schema.Array(ChannelOption),
	channelPopover: Popover.Model,
	channelSearch: Schema.String,
	/** The customer's open suggested channel links (`customers.channel.suggestions`, not synced). */
	suggestions: SuggestionList,
	/** The customer they were asked for; asked again when it changes. */
	suggestionsFor: Schema.NullOr(CustomerAccountId),
	/** The flags created in Hazel (`customer_feature_flags`); the others come from the accounts. */
	createdFeatureFlags: Schema.Array(Schema.String),
	flagPopover: Popover.Model,
	/** The flags ticked in the "Add flags" picker. */
	flagSelection: Schema.Array(Schema.String),
	rawModal: Modal.Model,
	/** Switches to the customer's other environments. */
	environmentMenu: Menu.Model,
	/** "Link to another customer": the search, the picked primary, an RPC on its way, the store's refusal. */
	linkModal: Modal.Model,
	linkQuery: Schema.String,
	linkPrimaryId: Schema.NullOr(CustomerAccountId),
	isLinking: Schema.Boolean,
	linkError: Schema.NullOr(Schema.String),
	/** "Name environment": the text, an RPC on its way. */
	environmentModal: Modal.Model,
	environmentDraft: Schema.String,
	isSavingEnvironment: Schema.Boolean,
	/** The note the delete confirmation asks about (kept while the dialog animates out). */
	deletingNoteId: Schema.NullOr(CustomerNoteId),
	deleteNoteModal: Modal.Model,
	/** The user may sign in as this customer's users (an admin granted it, `customer_impersonators`). */
	isImpersonator: Schema.Boolean,
	/** Presses of Impersonate so far: each dialog is one attempt. */
	impersonationAttempts: Schema.Number,
	impersonateModal: Modal.Model,
	/** Dropped when the dialog closes: the link is good once, for a minute. */
	impersonation: Schema.NullOr(Impersonation),
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
export const CHANNEL_POPOVER_ID = "customer-channel"
export const FLAG_POPOVER_ID = "customer-feature-flags"
export const RAW_MODAL_ID = "customer-raw"
export const ENVIRONMENT_MENU_ID = "customer-environments"
export const LINK_MODAL_ID = "customer-link"
export const LINK_SEARCH_ID = "customer-link-search"
export const ENVIRONMENT_MODAL_ID = "customer-environment"
export const ENVIRONMENT_INPUT_ID = "customer-environment-name"
export const DELETE_NOTE_MODAL_ID = "customer-delete-note"
export const IMPERSONATE_MODAL_ID = "customer-impersonate"
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

/**
 * Gone: the RPC says so, or the synced list lacks it, having loaded without it (a new account may
 * reach the RPC first) or dropped it (merged or deleted while shown).
 */
export const isNotFound = (model: Model): boolean =>
	(model.detail._tag === "Failure" && model.detail.error === "NotFound") ||
	(model.accounts !== null &&
		accountOf(model) === undefined &&
		(model.detail._tag !== "Success" || model.hasSeenAccount))

// GROUP

/** This customer's environments, primary first; empty when it stands alone (`groups.ts`). */
export const groupOfModel = (model: Model): ReadonlyArray<AccountRow> =>
	groupOf(model.accounts ?? [], model.accountId)

/**
 * The customer an account belongs to: its group's live primary, else itself. Linked channels are
 * the customer's, stored on the primary (`docs/customers/channels.md`).
 */
export const customerOfAccount = (model: Model): ((accountId: CustomerAccountId) => CustomerAccountId) => {
	const accounts = model.accounts ?? []
	const liveIds = new Set<string>(accounts.map((account) => account.id))
	const byId = new Map(accounts.map((account) => [account.id, account]))
	return (accountId) => {
		const account = byId.get(accountId)
		return account === undefined ? accountId : groupIdOf(account, liveIds)
	}
}

/** The primary this account is an environment of; null for a primary or a standalone account. */
export const primaryOf = (model: Model): AccountRow | null => {
	const [primary] = groupOfModel(model)
	return primary === undefined || primary.id === model.accountId ? null : primary
}

/**
 * The customers this one can join: the other customers' primaries and standalone accounts (an
 * environment can't lead), by name or domain, not its own group.
 */
export const linkCandidates = (model: Model): ReadonlyArray<AccountRow> => {
	const accounts = model.accounts ?? []
	const liveIds = new Set(accounts.map((account) => account.id))
	const own = accountOf(model)
	const ownGroupId = own === undefined ? model.accountId : groupIdOf(own, liveIds)
	const needle = model.linkQuery.trim().toLowerCase()
	return accounts.filter(
		(account) =>
			groupIdOf(account, liveIds) === account.id &&
			account.id !== ownGroupId &&
			(needle === "" ||
				account.name.toLowerCase().includes(needle) ||
				(account.environment?.toLowerCase().includes(needle) ?? false) ||
				(account.domain?.toLowerCase().includes(needle) ?? false)),
	)
}

/**
 * Open and snoozed signals of this customer, highest priority first: an environment's are its
 * primary's (signals are raised for the whole customer, on the primary).
 */
export const openSignals = (model: Model): ReadonlyArray<SignalRow> => {
	const accountId = primaryOf(model)?.id ?? model.accountId
	return (model.signals ?? []).filter(
		(signal) =>
			signal.accountId === accountId && (signal.status === "open" || signal.status === "snoozed"),
	)
}

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

/** Impersonate shows for a granted user while Clerk (the provider that can) is connected. */
export const canImpersonate = (model: Model): boolean =>
	model.isImpersonator && model.connectedProviders.includes("clerk")

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
	"mute_attention",
	"unmute_attention",
	"recompute",
	"link_source",
	"link_customer",
	"make_primary",
	"unlink",
	"name_environment",
	"raw_data",
	"archive",
])
export type ActionKey = typeof ActionKey.Type

/**
 * What the RPCs support runs; the rest shows, disabled, with why. A muted customer offers Unmute
 * (described with until when); else Mute ▸ For a week · For a month · Until unmuted. Grouping is for
 * admins: linking to another customer, naming the environment, and for an environment making it
 * primary or unlinking it.
 */
export const actionEntries = (
	model: Model,
	isAdmin: boolean,
	isMuted: boolean,
): ReadonlyArray<Menu.Entry> => {
	const isEnvironment = primaryOf(model) !== null
	return [
		Menu.item("copy_link"),
		Menu.item("change_owner"),
		isMuted
			? Menu.item("unmute_attention", { hasDescription: true })
			: Menu.item("mute_attention", { submenu: muteLeaves }),
		Menu.item("recompute", { isDisabled: true, hasDescription: true }),
		Menu.separator,
		Menu.item("link_source", { isDisabled: true, hasDescription: true }),
		...(isAdmin
			? [
					Menu.item("link_customer"),
					...(isEnvironment ? [Menu.item("make_primary"), Menu.item("unlink")] : []),
					Menu.item("name_environment"),
				]
			: []),
		Menu.item("raw_data"),
		Menu.separator,
		Menu.item("archive", { isDisabled: true, intent: "Danger", hasDescription: true }),
	]
}

/** The environment menu: the customer's accounts, primary first. */
export const environmentEntries = (model: Model): ReadonlyArray<Menu.Entry> =>
	groupOfModel(model).map((account) =>
		Menu.item(account.id, { textValue: account.environment ?? account.name }),
	)

export const metricEntries = (metrics: ReadonlyArray<MetricRow>): ReadonlyArray<Menu.Entry> =>
	(metrics.length === 0
		? [{ key: "active_users", name: "Active users", unit: null, provider: null }]
		: metrics
	).map((metric) => Menu.item(metric.key, { textValue: metric.name }))

export const eventTypeEntries: ReadonlyArray<Menu.Entry> = EventType.literals.map((type) => Menu.item(type))

/** The queue's snooze presets (no date picker here). */
export const snoozeEntries: ReadonlyArray<Menu.Entry> = SNOOZE_KEYS.map((key) => Menu.item(key))
export const doneEntries: ReadonlyArray<Menu.Entry> = Customers.SignalOutcome.literals.map((outcome) =>
	Menu.item(outcome),
)

export const ASSIGN_ME = "assign_me"
export const UNASSIGN = "unassign"
export const OPEN_QUEUE = "open_queue"
export const signalMoreEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item(ASSIGN_ME),
	Menu.item(UNASSIGN),
	Menu.separator,
	Menu.item(OPEN_QUEUE),
]
