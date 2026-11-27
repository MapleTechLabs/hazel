/**
 * The ranked signal queue (`docs/customers/spec.md` §2): tabs, filters, sort, grouping and what each
 * shows, as pure functions over the live rows (today's `web-foldkit/src/page/customers/attention/model.ts`).
 * Needs attention draws it; the Support inbox (PK3) builds on the same pieces.
 */
import * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerSignalId, UserId } from "@hazel/schema"
import { Array, Match, Option, Order, Schema } from "effect"
import { customerAccountOf, queueNameOf } from "../data/groups"
import {
	type AccountRow,
	isAttentionMuted,
	type MemberRow,
	type QueueTab,
	queueTabOf,
	resolvedAtMsOf,
	type SignalRow,
} from "../data/queries"

export const Tab = Schema.Literals(["open", "snoozed", "done"])
export type Tab = typeof Tab.Type
export const Grouping = Schema.Literals(["signals", "accounts"])
export type Grouping = typeof Grouping.Type
export const Sort = Schema.Literals(["priority", "account", "signal", "severity", "age", "mrr"])
export type Sort = typeof Sort.Type

/** Each sort's own direction (the header's sort mark): # runs 1 down, Age oldest first. */
export const SORT_ASCENDING = {
	priority: true,
	account: true,
	signal: true,
	severity: false,
	age: false,
	mrr: false,
} as const satisfies Record<Sort, boolean>

export const SORT_LABEL = {
	priority: "Priority",
	account: "Account",
	signal: "Signal",
	severity: "Severity",
	age: "Age",
	mrr: "MRR",
} as const satisfies Record<Sort, string>

/** Whose accounts: the default, "Mine or unowned", is accounts I own plus ones nobody owns yet. */
export const OwnerFilter = Schema.Literals(["mine_or_unowned", "mine", "anyone", "unowned"])
export type OwnerFilter = typeof OwnerFilter.Type

export const OWNER_LABEL = {
	mine_or_unowned: "Mine or unowned",
	mine: "Mine",
	anyone: "Anyone",
	unowned: "Unowned",
} as const satisfies Record<OwnerFilter, string>

/** The owner scope as a subtitle suffix, e.g. " on your accounts". */
export const OWNER_SCOPE = {
	mine_or_unowned: " on your or unowned accounts",
	mine: " on your accounts",
	anyone: "",
	unowned: "",
} as const satisfies Record<OwnerFilter, string>

export const Filters = Schema.Struct({
	owner: OwnerFilter,
	kind: Schema.NullOr(Customers.SignalKind),
	template: Schema.NullOr(Customers.SignalTemplate),
	severity: Schema.NullOr(Customers.SignalSeverity),
	plan: Schema.NullOr(Schema.String),
})
export type Filters = typeof Filters.Type

export const FilterField = Schema.Literals(["owner", "kind", "template", "severity", "plan"])
export type FilterField = typeof FilterField.Type

export const DEFAULT_FILTERS: Filters = {
	owner: "mine_or_unowned",
	kind: null,
	template: null,
	severity: null,
	plan: null,
}

/** Done shows what was resolved in the last week, and every signal still muted. */
export const DONE_WINDOW_MS = 7 * 86_400_000

/** What the queue reads: the live rows, and how the user narrowed them. */
export interface QueueState {
	readonly tab: Tab
	readonly grouping: Grouping
	readonly sort: Sort
	readonly isSortReversed: boolean
	readonly filters: Filters
	readonly search: string
	readonly signals: ReadonlyArray<SignalRow> | null
	readonly accounts: ReadonlyArray<AccountRow> | null
}

/** Who is looking, and when. */
export interface Viewer {
	readonly userId: UserId | null
	readonly nowMs: number
}

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 } as const satisfies Record<
	Customers.SignalSeverity,
	number
>

const byPriority = Order.mapInput(Order.flip(Order.Number), (signal: SignalRow) => signal.priorityScore)
const bySeverity = Order.mapInput(
	Order.flip(Order.Number),
	(signal: SignalRow) => SEVERITY_WEIGHT[signal.severity],
)
const byOpened = Order.mapInput(Order.Number, (signal: SignalRow) => signal.openedAtMs)
const byWake = Order.mapInput(Order.Number, (signal: SignalRow) => signal.snoozedUntilMs ?? Infinity)
const byResolved = Order.mapInput(
	Order.flip(Order.Number),
	(signal: SignalRow) => resolvedAtMsOf(signal) ?? 0,
)

export const accountsByIdOf = (state: Pick<QueueState, "accounts">): ReadonlyMap<string, AccountRow> =>
	new Map((state.accounts ?? []).map((account) => [account.id, account]))

const matchesOwner = (owner: OwnerFilter, viewer: Viewer, ownerUserId: UserId | null): boolean => {
	const mine = viewer.userId !== null && ownerUserId === viewer.userId
	return Match.value(owner).pipe(
		Match.when("anyone", () => true),
		Match.when("mine", () => mine),
		Match.when("unowned", () => ownerUserId === null),
		Match.when("mine_or_unowned", () => mine || ownerUserId === null),
		Match.exhaustive,
	)
}

/** Every filter but the tab: the tab counts read this too. */
const matchesFilters = (
	state: QueueState,
	viewer: Viewer,
	accountsById: ReadonlyMap<string, AccountRow>,
	signal: SignalRow,
): boolean => {
	const account = accountsById.get(signal.accountId)
	if (account === undefined) return false
	const customer = customerAccountOf(account, accountsById)
	// A muted customer or environment stays out of every tab until unmuted (its page shows its signals).
	if (isAttentionMuted(account) || isAttentionMuted(customer)) return false
	const { filters } = state
	const query = state.search.trim().toLowerCase()
	return (
		matchesOwner(filters.owner, viewer, customer.ownerUserId) &&
		(filters.kind === null || signal.kind === filters.kind) &&
		(filters.template === null || signal.template === filters.template) &&
		(filters.severity === null || signal.severity === filters.severity) &&
		(filters.plan === null || account.planName === filters.plan) &&
		(query === "" ||
			queueNameOf(account).toLowerCase().includes(query) ||
			signal.title.toLowerCase().includes(query))
	)
}

/** Done keeps the last week, and a done or dismissed signal still true however old (to reopen it). */
const isInTab = (tab: QueueTab, viewer: Viewer, signal: SignalRow): boolean =>
	queueTabOf(signal) === tab &&
	(tab !== "done" ||
		(signal.status !== "auto_resolved" && signal.closedAtMs === null) ||
		(resolvedAtMsOf(signal) ?? 0) >= viewer.nowMs - DONE_WINDOW_MS)

const sortedForTab = (
	state: QueueState,
	accountsById: ReadonlyMap<string, AccountRow>,
	signals: ReadonlyArray<SignalRow>,
): ReadonlyArray<SignalRow> => {
	if (state.tab === "snoozed") return Array.sort(signals, byWake)
	if (state.tab === "done") return Array.sort(signals, byResolved)
	const accountOf = (signal: SignalRow) => accountsById.get(signal.accountId)
	const order = Match.value(state.sort).pipe(
		Match.when("priority", () => byPriority),
		Match.when("account", () =>
			Order.mapInput(Order.String, (signal: SignalRow) => {
				const account = accountOf(signal)
				return account === undefined ? "" : queueNameOf(account).toLowerCase()
			}),
		),
		Match.when("signal", () =>
			Order.mapInput(Order.String, (signal: SignalRow) => signal.title.toLowerCase()),
		),
		Match.when("severity", () => bySeverity),
		Match.when("age", () => byOpened),
		Match.when("mrr", () =>
			Order.mapInput(Order.flip(Order.Number), (signal: SignalRow) => accountOf(signal)?.mrrMinor ?? 0),
		),
		Match.exhaustive,
	)
	return Array.sort(signals, Order.combine(state.isSortReversed ? Order.flip(order) : order, byPriority))
}

/** Keeps each account's signals together, at its first signal's place in the sorted order. */
const clusterByAccount = (signals: ReadonlyArray<SignalRow>): ReadonlyArray<SignalRow> => {
	const byAccount = new Map<CustomerAccountId, Array<SignalRow>>()
	for (const signal of signals) {
		const cluster = byAccount.get(signal.accountId)
		if (cluster === undefined) byAccount.set(signal.accountId, [signal])
		else cluster.push(signal)
	}
	return [...byAccount.values()].flat()
}

/** The current tab's signals after the filters and search, in display order (an account's together). */
export const visibleSignals = (state: QueueState, viewer: Viewer): ReadonlyArray<SignalRow> => {
	const accountsById = accountsByIdOf(state)
	return clusterByAccount(
		sortedForTab(
			state,
			accountsById,
			(state.signals ?? []).filter(
				(signal) =>
					isInTab(state.tab, viewer, signal) && matchesFilters(state, viewer, accountsById, signal),
			),
		),
	)
}

/** Where a row sits in its account's run: whether the rows above and below are the same account's. */
export interface AccountRun {
	readonly continuesAbove: boolean
	readonly continuesBelow: boolean
}

export const NO_ACCOUNT_RUN: AccountRun = { continuesAbove: false, continuesBelow: false }

export const accountRunOf = (signals: ReadonlyArray<SignalRow>, index: number): AccountRun => ({
	continuesAbove: index > 0 && signals[index - 1]?.accountId === signals[index]?.accountId,
	continuesBelow: signals[index + 1]?.accountId === signals[index]?.accountId,
})

/** Each tab's count under the current filters. */
export const tabCounts = (state: QueueState, viewer: Viewer): Readonly<Record<QueueTab, number>> => {
	const accountsById = accountsByIdOf(state)
	const counts = { open: 0, snoozed: 0, done: 0 }
	for (const signal of state.signals ?? []) {
		if (!matchesFilters(state, viewer, accountsById, signal)) continue
		const tab = queueTabOf(signal)
		if (isInTab(tab, viewer, signal)) counts[tab] += 1
	}
	return counts
}

/** One account's signals, in display order; `lead` is the first. */
export interface AccountGroup {
	readonly accountId: CustomerAccountId
	readonly lead: SignalRow
	readonly signals: ReadonlyArray<SignalRow>
}

/** Account grouping: accounts ordered by their best signal. */
export const accountGroups = (signals: ReadonlyArray<SignalRow>): ReadonlyArray<AccountGroup> => {
	const groups = new Map<CustomerAccountId, { lead: SignalRow; signals: Array<SignalRow> }>()
	for (const signal of signals) {
		const group = groups.get(signal.accountId)
		if (group === undefined) groups.set(signal.accountId, { lead: signal, signals: [signal] })
		else group.signals.push(signal)
	}
	return [...groups].map(([accountId, group]) => ({ accountId, lead: group.lead, signals: group.signals }))
}

/** What j/k step through: every row's signal, or each account's leading signal. */
export const rowIds = (state: QueueState, viewer: Viewer): ReadonlyArray<CustomerSignalId> => {
	const signals = visibleSignals(state, viewer)
	return state.grouping === "accounts" && state.tab === "open"
		? accountGroups(signals).map((group) => group.lead.id)
		: signals.map((signal) => signal.id)
}

export const signalById = (
	state: Pick<QueueState, "signals">,
	signalId: CustomerSignalId | null,
): SignalRow | undefined =>
	signalId === null ? undefined : (state.signals ?? []).find((signal) => signal.id === signalId)

/** The row now at `id`'s place once it left (`before` the ids then, `after` now): the keyboard keeps going. */
export const neighbourOf = (
	before: ReadonlyArray<CustomerSignalId>,
	after: ReadonlyArray<CustomerSignalId>,
	id: CustomerSignalId,
): CustomerSignalId | null => {
	if (after.includes(id)) return id
	const index = before.indexOf(id)
	if (index < 0) return null
	const shown = new Set(after)
	// Less the rows above it that left too (a mute removes several).
	const removedAbove = before.slice(0, index).filter((other) => !shown.has(other)).length
	return after[Math.min(index - removedAbove, after.length - 1)] ?? null
}

/** What the server reopens: a snoozed, done or dismissed signal that is not closed yet. */
export const canReopen = (signal: SignalRow): boolean =>
	signal.closedAtMs === null &&
	(signal.status === "snoozed" || signal.status === "done" || signal.status === "dismissed")

/** Mark done and snooze act on an open or snoozed signal. */
export const isActionable = (signal: SignalRow): boolean =>
	signal.status === "open" || signal.status === "snoozed"

/** Distinct plans of the accounts with signals, for the plan filter. */
export const plansOf = (state: QueueState): ReadonlyArray<string> => {
	const accountsById = accountsByIdOf(state)
	const plans = new Set<string>()
	for (const signal of state.signals ?? []) {
		const plan = accountsById.get(signal.accountId)?.planName
		if (plan) plans.add(plan)
	}
	return [...plans].sort()
}

/** A filter chip's remove: owner back to anyone, the rest to none. */
export const clearFilter = (filters: Filters, field: FilterField): Filters =>
	field === "owner" ? { ...filters, owner: "anyone" } : { ...filters, [field]: null }

/** Whether the search or a filter narrower than the owner scope is set, so an empty tab may hide signals. */
export const isNarrowed = (state: Pick<QueueState, "search" | "filters">): boolean =>
	state.search.trim() !== "" ||
	state.filters.owner === "unowned" ||
	state.filters.kind !== null ||
	state.filters.template !== null ||
	state.filters.severity !== null ||
	state.filters.plan !== null

/** Clears every narrowing filter; the owner scope stays unless it was `unowned`. */
export const clearNarrowing = (filters: Filters): Filters => ({
	owner: filters.owner === "unowned" ? "anyone" : filters.owner,
	kind: null,
	template: null,
	severity: null,
	plan: null,
})

/** Applies a filter key (`<field>:<value>`): picking the active value clears it (owner falls back to anyone). */
export const toggleFilter = (filters: Filters, key: string): Filters => {
	const separator = key.indexOf(":")
	const field = key.slice(0, separator)
	const value = key.slice(separator + 1)
	const toggled = <A>(current: A | null, next: A): A | null => (current === next ? null : next)
	const apply = <A>(schema: Schema.Codec<A>, set: (next: A) => Filters): Filters =>
		Option.match(Schema.decodeUnknownOption(schema)(value), { onNone: () => filters, onSome: set })
	return Match.value(field).pipe(
		Match.when("owner", () =>
			apply(OwnerFilter, (owner) => ({
				...filters,
				owner: filters.owner === owner ? "anyone" : owner,
			})),
		),
		Match.when("kind", () =>
			apply(Customers.SignalKind, (kind) => ({ ...filters, kind: toggled(filters.kind, kind) })),
		),
		Match.when("severity", () =>
			apply(Customers.SignalSeverity, (severity) => ({
				...filters,
				severity: toggled(filters.severity, severity),
			})),
		),
		Match.when("template", () =>
			apply(Customers.SignalTemplate, (template) => ({
				...filters,
				template: toggled(filters.template, template),
			})),
		),
		Match.when("plan", () => ({ ...filters, plan: toggled(filters.plan, value) })),
		Match.orElse(() => filters),
	)
}

/** Whether a filter key (`<field>:<value>`) is the active filter. */
export const isFilterActive = (filters: Filters, key: string): boolean => {
	const separator = key.indexOf(":")
	const field = key.slice(0, separator)
	return Schema.is(FilterField)(field) && filters[field] === key.slice(separator + 1)
}

/** `6h`, `2d`, `5m`: how long a signal has been open. */
export const ageText = (fromMs: number, nowMs: number): string => {
	const ms = Math.max(0, nowMs - fromMs)
	return ms < 3_600_000
		? `${Math.floor(ms / 60_000)}m`
		: ms < 86_400_000
			? `${Math.floor(ms / 3_600_000)}h`
			: `${Math.floor(ms / 86_400_000)}d`
}

/** A member by id, as the queue's people marks take them. */
export const personOf = (membersById: ReadonlyMap<string, MemberRow>, userId: string | null) => {
	const member = userId === null ? undefined : membersById.get(userId)
	return member === undefined ? null : { name: member.name, avatarUrl: member.avatarUrl }
}
