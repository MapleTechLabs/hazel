import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSignalId, type UserId } from "@hazel/schema"
import { Array, Option, Order, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import {
	AccountRow,
	type AccountRow as AccountRowType,
	MemberRow,
	type QueueTab,
	queueTabOf,
	resolvedAtMsOf,
	SignalRow,
	type SignalRow as SignalRowType,
} from "../../../customers/queries"
import {
	isSnoozeKey,
	PICK_DATE_KEY,
	SNOOZE_KEYS,
	type SnoozeKey,
	snoozeUntil,
} from "../../../customers/ui/menus"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"

/** The ranked signal queue (`docs/customers/spec.md` §2): tabs, filters, grouping, selection, preview. */

// MODEL

export const Tab = Schema.Literals(["open", "snoozed", "done"])
export const Grouping = Schema.Literals(["signals", "accounts"])
export type Grouping = typeof Grouping.Type
export const Sort = Schema.Literals(["priority", "severity", "age", "mrr"])
export type Sort = typeof Sort.Type
/** Whose accounts: "Mine" (the default) is accounts I own. */
export const OwnerFilter = Schema.Literals(["mine", "anyone", "unowned"])
export type OwnerFilter = typeof OwnerFilter.Type

export const Filters = Schema.Struct({
	owner: OwnerFilter,
	kind: Schema.NullOr(Customers.SignalKind),
	template: Schema.NullOr(Customers.SignalTemplate),
	severity: Schema.NullOr(Customers.SignalSeverity),
	plan: Schema.NullOr(Schema.String),
})
export type Filters = typeof Filters.Type

export const DEFAULT_FILTERS: Filters = {
	owner: "mine",
	kind: null,
	template: null,
	severity: null,
	plan: null,
}

/** The mark-done dialog's form, for one signal. */
export const DoneForm = Schema.Struct({
	signalId: CustomerSignalId,
	outcome: Customers.SignalOutcome,
	note: Schema.String,
})
export type DoneForm = typeof DoneForm.Type

export const Detail = AsyncData.Schema(Customers.AccountDetail, CommonReason)
export type Detail = typeof Detail.schema.Type

/** The preview panel's account detail (`customers.account.detail`), for the selected signal's account. */
export const PreviewDetail = Schema.Struct({ accountId: CustomerAccountId, data: Detail.schema })
export type PreviewDetail = typeof PreviewDetail.Type

/** "Pick date…": the day a signal snoozes until. */
export const SnoozeDateForm = Schema.Struct({ signalId: CustomerSignalId, date: Schema.String })

export const Model = Schema.Struct({
	tab: Tab,
	grouping: Grouping,
	sort: Sort,
	filters: Filters,
	search: Schema.String,
	/** Live rows; null until each query answers. */
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	members: Schema.Array(MemberRow),
	lastComputedAtMs: Schema.NullOr(Schema.Number),
	/** The selected signal (in account grouping, the account's top signal). */
	selectedId: Schema.NullOr(CustomerSignalId),
	isPreviewOpen: Schema.Boolean,
	detail: Schema.NullOr(PreviewDetail),
	assignMenu: Menu.Model,
	snoozeMenu: Menu.Model,
	moreMenu: Menu.Model,
	filterMenu: Menu.Model,
	sortMenu: Menu.Model,
	doneModal: Modal.Model,
	doneForm: Schema.NullOr(DoneForm),
	snoozeDateModal: Modal.Model,
	snoozeDateForm: Schema.NullOr(SnoozeDateForm),
})
export type Model = typeof Model.Type

export const SEARCH_ID = "attention-search"
export const ASSIGN_MENU_ID = "attention-assign"
export const SNOOZE_MENU_ID = "attention-snooze"
export const MORE_MENU_ID = "attention-more"
export const FILTER_MENU_ID = "attention-filter"
export const SORT_MENU_ID = "attention-sort"
export const DONE_MODAL_ID = "attention-done"
export const SNOOZE_DATE_MODAL_ID = "attention-snooze-date"

/** Done shows what was resolved in the last week. */
export const DONE_WINDOW_MS = 7 * 86_400_000

// WHAT IS SHOWN

/** What the selectors read besides the Model. */
export interface Viewer {
	readonly userId: UserId | null
	readonly nowMs: number
}

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 } as const satisfies Record<
	Customers.SignalSeverity,
	number
>

const byPriority = Order.mapInput(Order.flip(Order.Number), (signal: SignalRowType) => signal.priorityScore)
const bySeverity = Order.mapInput(
	Order.flip(Order.Number),
	(signal: SignalRowType) => SEVERITY_WEIGHT[signal.severity],
)
const byOpened = Order.mapInput(Order.Number, (signal: SignalRowType) => signal.openedAtMs)
const byWake = Order.mapInput(Order.Number, (signal: SignalRowType) => signal.snoozedUntilMs ?? Infinity)
const byResolved = Order.mapInput(
	Order.flip(Order.Number),
	(signal: SignalRowType) => resolvedAtMsOf(signal) ?? 0,
)

export const accountsByIdOfModel = (model: Model): ReadonlyMap<string, AccountRowType> =>
	new Map((model.accounts ?? []).map((account) => [account.id, account]))

/** Every filter but the tab: the tab counts read this too. */
const matchesFilters = (
	model: Model,
	viewer: Viewer,
	accountsById: ReadonlyMap<string, AccountRowType>,
	signal: SignalRowType,
): boolean => {
	const account = accountsById.get(signal.accountId)
	if (account === undefined) return false
	const { filters } = model
	const query = model.search.trim().toLowerCase()
	return (
		(filters.owner === "anyone" ||
			(filters.owner === "mine"
				? viewer.userId !== null && account.ownerUserId === viewer.userId
				: account.ownerUserId === null)) &&
		(filters.kind === null || signal.kind === filters.kind) &&
		(filters.template === null || signal.template === filters.template) &&
		(filters.severity === null || signal.severity === filters.severity) &&
		(filters.plan === null || account.planName === filters.plan) &&
		(query === "" ||
			account.name.toLowerCase().includes(query) ||
			signal.title.toLowerCase().includes(query))
	)
}

/** Done keeps the last week; the rest of a tab is its status. */
const isInTab = (tab: QueueTab, viewer: Viewer, signal: SignalRowType): boolean =>
	queueTabOf(signal) === tab &&
	(tab !== "done" || (resolvedAtMsOf(signal) ?? 0) >= viewer.nowMs - DONE_WINDOW_MS)

const sortedForTab = (
	model: Model,
	accountsById: ReadonlyMap<string, AccountRowType>,
	signals: ReadonlyArray<SignalRowType>,
): ReadonlyArray<SignalRowType> => {
	if (model.tab === "snoozed") return Array.sort(signals, byWake)
	if (model.tab === "done") return Array.sort(signals, byResolved)
	const byMrr = Order.mapInput(
		Order.flip(Order.Number),
		(signal: SignalRowType) => accountsById.get(signal.accountId)?.mrrMinor ?? 0,
	)
	const order = {
		priority: byPriority,
		severity: Order.combine(bySeverity, byPriority),
		age: byOpened,
		mrr: Order.combine(byMrr, byPriority),
	}[model.sort]
	return Array.sort(signals, order)
}

/** The current tab's signals after the filters and search, in display order. */
export const visibleSignals = (model: Model, viewer: Viewer): ReadonlyArray<SignalRowType> => {
	const accountsById = accountsByIdOfModel(model)
	return sortedForTab(
		model,
		accountsById,
		(model.signals ?? []).filter(
			(signal) =>
				isInTab(model.tab, viewer, signal) && matchesFilters(model, viewer, accountsById, signal),
		),
	)
}

/** Each tab's count under the current filters. */
export const tabCounts = (model: Model, viewer: Viewer): Readonly<Record<QueueTab, number>> => {
	const accountsById = accountsByIdOfModel(model)
	const counts = { open: 0, snoozed: 0, done: 0 }
	for (const signal of model.signals ?? []) {
		if (!matchesFilters(model, viewer, accountsById, signal)) continue
		const tab = queueTabOf(signal)
		if (isInTab(tab, viewer, signal)) counts[tab] += 1
	}
	return counts
}

/** One account's signals, in display order; `lead` is the first. */
export interface AccountGroup {
	readonly accountId: CustomerAccountId
	readonly lead: SignalRowType
	readonly signals: ReadonlyArray<SignalRowType>
}

/** Account grouping: accounts ordered by their best signal. */
export const accountGroups = (signals: ReadonlyArray<SignalRowType>): ReadonlyArray<AccountGroup> => {
	const groups = new Map<CustomerAccountId, { lead: SignalRowType; signals: Array<SignalRowType> }>()
	for (const signal of signals) {
		const group = groups.get(signal.accountId)
		if (group === undefined) groups.set(signal.accountId, { lead: signal, signals: [signal] })
		else group.signals.push(signal)
	}
	return [...groups].map(([accountId, group]) => ({ accountId, lead: group.lead, signals: group.signals }))
}

/** What j/k step through: every row's signal, or each account's leading signal. */
export const rowIds = (model: Model, viewer: Viewer): ReadonlyArray<CustomerSignalId> => {
	const signals = visibleSignals(model, viewer)
	return model.grouping === "accounts"
		? accountGroups(signals).map((group) => group.lead.id)
		: signals.map((signal) => signal.id)
}

export const signalById = (model: Model, signalId: CustomerSignalId | null): SignalRowType | undefined =>
	signalId === null ? undefined : (model.signals ?? []).find((signal) => signal.id === signalId)

export const selectedSignal = (model: Model): SignalRowType | undefined => signalById(model, model.selectedId)

/** The selection, kept while it is still a row; otherwise none. */
export const isSelectionVisible = (model: Model, viewer: Viewer): boolean =>
	model.selectedId !== null && rowIds(model, viewer).includes(model.selectedId)

/**
 * Whether the selected row's action buttons (and so the Assign, Snooze and `⋯` menus) are on screen:
 * in the preview, or inline on a visible row (an account group row has none).
 */
export const areActionsShown = (model: Model, viewer: Viewer): boolean =>
	isSelectionVisible(model, viewer) &&
	(model.isPreviewOpen || model.tab !== "open" || model.grouping === "signals")

/** What the server reopens: a snoozed, done or dismissed signal that is not closed yet. */
export const canReopen = (signal: SignalRowType): boolean =>
	signal.closedAtMs === null &&
	(signal.status === "snoozed" || signal.status === "done" || signal.status === "dismissed")

/** Distinct plans of the accounts with signals, for the plan filter. */
export const plansOf = (model: Model): ReadonlyArray<string> => {
	const accountsById = accountsByIdOfModel(model)
	const plans = new Set<string>()
	for (const signal of model.signals ?? []) {
		const plan = accountsById.get(signal.accountId)?.planName
		if (plan) plans.add(plan)
	}
	return [...plans].sort()
}

/** The open signals the header sums up: on accounts I own, or any. */
// MENUS

export const ASSIGN_ME = "me"
export const ASSIGN_NONE = "none"
const ASSIGN_USER = "user:"
export const assignKeyOf = (userId: UserId) => `${ASSIGN_USER}${userId}`
export const userIdOfAssignKey = (key: string): string | null =>
	key.startsWith(ASSIGN_USER) ? key.slice(ASSIGN_USER.length) : null

export const assignEntries = (
	members: ReadonlyArray<typeof MemberRow.Type>,
	viewer: Viewer,
): ReadonlyArray<Menu.Entry> => [
	Menu.item(ASSIGN_ME),
	Menu.section(
		"Team",
		members
			.filter((member) => member.id !== viewer.userId)
			.map((member) => Menu.item(assignKeyOf(member.id), { textValue: member.name })),
	),
	Menu.separator,
	Menu.item(ASSIGN_NONE),
]

/** The kit's snooze keys, plus a failed payment's next retry. */
export const NEXT_RETRY = "next_retry"
export type SnoozeOption = SnoozeKey | typeof NEXT_RETRY
export const isSnoozeOption = (key: string): key is SnoozeOption => key === NEXT_RETRY || isSnoozeKey(key)

/** The payment's next retry, when the signal's evidence knows it. */
export const nextRetryMsOf = (signal: SignalRowType): number | null =>
	signal.evidence._tag === "amount" && signal.evidence.nextRetryAt !== null
		? Date.parse(signal.evidence.nextRetryAt)
		: null

/** `Snooze until` · Tomorrow · In 3 days · Next week (· After next retry) · ─ · Pick date… */
export const snoozeEntries = (signal: SignalRowType | undefined): ReadonlyArray<Menu.Entry> => [
	Menu.section("Snooze until", [
		...SNOOZE_KEYS.map((key) => Menu.item(key)),
		...(signal !== undefined && nextRetryMsOf(signal) !== null
			? [Menu.item(NEXT_RETRY, { textValue: "After next retry" })]
			: []),
	]),
	Menu.separator,
	Menu.item(PICK_DATE_KEY, { textValue: "Pick date" }),
]

/** A retry already past (the evidence is as old as the last compute) snoozes until tomorrow instead. */
export const snoozeUntilMs = (option: SnoozeOption, nowMs: number, signal: SignalRowType): number => {
	if (option !== NEXT_RETRY) return snoozeUntil(option, new Date(nowMs)).getTime()
	const retryMs = nextRetryMsOf(signal)
	return retryMs !== null && retryMs > nowMs ? retryMs : snoozeUntil("tomorrow", new Date(nowMs)).getTime()
}

/** A picked day (`YYYY-MM-DD`, local) at 9:00 local, the kit's snooze hour; none unless after `nowMs`. */
export const pickedSnoozeMs = (date: string, nowMs: number): number | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
	if (match === null) return null
	const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9).getTime()
	return at > nowMs ? at : null
}

/** `YYYY-MM-DD` of the local day `days` after `nowMs` (the date field's value). */
export const localDateOf = (nowMs: number, days = 0): string => {
	const date = new Date(nowMs)
	date.setDate(date.getDate() + days)
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export const moreEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("open_customer"),
	Menu.separator,
	Menu.item("dismiss", { intent: "Danger" }),
]

export const sortEntries: ReadonlyArray<Menu.Entry> = Sort.literals.map((sort) => Menu.item(sort))

/** Filter keys: `<field>:<value>` toggles that filter. */
export const filterEntries = (model: Model): ReadonlyArray<Menu.Entry> => [
	Menu.section(
		"Owner",
		OwnerFilter.literals.map((owner) => Menu.item(`owner:${owner}`)),
	),
	Menu.section(
		"Kind",
		Customers.SignalKind.literals.map((kind) => Menu.item(`kind:${kind}`)),
	),
	Menu.section(
		"Severity",
		Customers.SignalSeverity.literals.map((severity) => Menu.item(`severity:${severity}`)),
	),
	Menu.section(
		"Signal type",
		Customers.SignalTemplate.literals.map((template) => Menu.item(`template:${template}`)),
	),
	...(plansOf(model).length === 0
		? []
		: [
				Menu.section(
					"Plan",
					plansOf(model).map((plan) => Menu.item(`plan:${plan}`)),
				),
			]),
]

/** A filter chip's remove: owner back to anyone, the rest to none. */
export const clearFilter = (filters: Filters, field: keyof Filters): Filters =>
	field === "owner" ? { ...filters, owner: "anyone" } : { ...filters, [field]: null }

/** Whether the search or a filter narrower than the owner scope is set, so an empty tab may be hiding signals. */
export const isNarrowed = (model: Model): boolean =>
	model.search.trim() !== "" ||
	model.filters.owner === "unowned" ||
	model.filters.kind !== null ||
	model.filters.template !== null ||
	model.filters.severity !== null ||
	model.filters.plan !== null

/** Clears the search and every narrowing filter; the owner scope stays unless it was `unowned`. */
export const clearNarrowing = (filters: Filters): Filters => ({
	owner: filters.owner === "unowned" ? "anyone" : filters.owner,
	kind: null,
	template: null,
	severity: null,
	plan: null,
})

/** Applies a filter key: picking the active value clears it (owner falls back to anyone). */
export const toggleFilter = (filters: Filters, key: string): Filters => {
	const separator = key.indexOf(":")
	const field = key.slice(0, separator)
	const value = key.slice(separator + 1)
	const toggled = <A>(current: A | null, next: A): A | null => (current === next ? null : next)
	const apply = <A>(schema: Schema.Codec<A>, set: (next: A) => Filters): Filters =>
		Option.match(Schema.decodeUnknownOption(schema)(value), { onNone: () => filters, onSome: set })
	switch (field) {
		case "owner":
			return apply(OwnerFilter, (owner) => ({
				...filters,
				owner: filters.owner === owner ? "anyone" : owner,
			}))
		case "kind":
			return apply(Customers.SignalKind, (kind) => ({ ...filters, kind: toggled(filters.kind, kind) }))
		case "severity":
			return apply(Customers.SignalSeverity, (severity) => ({
				...filters,
				severity: toggled(filters.severity, severity),
			}))
		case "template":
			return apply(Customers.SignalTemplate, (template) => ({
				...filters,
				template: toggled(filters.template, template),
			}))
		case "plan":
			return { ...filters, plan: toggled(filters.plan, value) }
		default:
			return filters
	}
}

/** The keys the queue answers to (`?` and `/` included); typing in a field never reaches them. */
export const QueueKey = Schema.Literals([
	"next",
	"previous",
	"assign",
	"snooze",
	"done",
	"dismiss",
	"reopen",
	"open",
	"preview",
	"close",
	"search",
])
export type QueueKey = typeof QueueKey.Type
