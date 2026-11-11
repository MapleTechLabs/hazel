import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSavedViewId, UserId } from "@hazel/schema"
import { Array, Order, Schema } from "effect"
import { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"

/**
 * The customers list (`docs/customers/spec.md` §3): saved-view tabs over the synced accounts, with
 * search, a filter builder, sort, a column picker, bulk actions and a hover preview. A view's
 * filters, sort and columns load into `draft`; editing the draft offers "Save view".
 */

// MODEL

/** A saved view with what it applies (the shared `SavedViewRow` leaves those out). */
export const ViewRow = Schema.Struct({
	id: CustomerSavedViewId,
	name: Schema.String,
	builtInKey: Schema.NullOr(Customers.BuiltInViewKey),
	/** Null: shared with the org. */
	ownerUserId: Schema.NullOr(UserId),
	position: Schema.Number,
	filters: Customers.ViewFilters,
	sort: Customers.ViewSort,
	columns: Schema.Array(Customers.ListColumn),
})
export type ViewRow = typeof ViewRow.Type

/** What the table applies now: the view's own, or the user's edits of it. */
export const Draft = Schema.Struct({
	filters: Customers.ViewFilters,
	sort: Customers.ViewSort,
	columns: Schema.Array(Customers.ListColumn),
})
export type Draft = typeof Draft.Type

/** The filter builder's fields; each chip clears one. */
export const FilterField = Schema.Literals([
	"stage",
	"plan",
	"owner",
	"tag",
	"health",
	"mrr",
	"last_active",
	"signals",
])
export type FilterField = typeof FilterField.Type

/** The builder edits a copy of the filters; Apply commits it. */
export const Builder = Schema.Struct({ field: FilterField, pending: Customers.ViewFilters })
export type Builder = typeof Builder.Type

export const SaveForm = Schema.Struct({
	/** Update the current view instead of creating one. */
	mode: Schema.Literals(["create", "rename"]),
	name: Schema.String,
	isShared: Schema.Boolean,
})
export type SaveForm = typeof SaveForm.Type

export const Model = Schema.Struct({
	/** `?view=`: a built-in key or a saved view's id; none is "All customers". */
	view: Schema.NullOr(Schema.String),
	draft: Draft,
	/** Typing narrows the table but is not part of a view. */
	search: Schema.String,
	/** Live rows; null until each query answers. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	views: Schema.NullOr(Schema.Array(ViewRow)),
	members: Schema.Array(MemberRow),
	connectedProviders: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	lastComputedAtMs: Schema.NullOr(Schema.Number),
	/** What totals and MRR filters are shown in (the org's settings). */
	reportingCurrency: Schema.String,
	/** 30 days of daily active users per account (`customers.sparklines`). */
	sparklines: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
	/** Accounts whose sparkline was asked for (answered or not), so none is asked twice. */
	requestedSparklines: Schema.Array(Schema.String),
	/** Always among the visible rows: a search or filter change drops what it hides. */
	selected: Schema.Array(CustomerAccountId),
	/** The table renders this many rows; "Show more" adds ROW_PAGE. */
	rowLimit: Schema.Int,
	/** The keyboard cursor (j/k). */
	focusedId: Schema.NullOr(CustomerAccountId),
	/** The pointer rests on this row's name; the card shows once the delay passes. */
	hoverPendingId: Schema.NullOr(CustomerAccountId),
	hoveredId: Schema.NullOr(CustomerAccountId),
	builder: Schema.NullOr(Builder),
	filterPopover: Popover.Model,
	columnsPopover: Popover.Model,
	tagPopover: Popover.Model,
	tagInput: Schema.String,
	sortMenu: Menu.Model,
	viewMenu: Menu.Model,
	ownerMenu: Menu.Model,
	saveModal: Modal.Model,
	saveForm: Schema.NullOr(SaveForm),
})
export type Model = typeof Model.Type

export const SEARCH_ID = "customers-list-search"
export const FILTER_POPOVER_ID = "customers-list-filter"
export const COLUMNS_POPOVER_ID = "customers-list-columns"
export const TAG_POPOVER_ID = "customers-list-tag"
export const SORT_MENU_ID = "customers-list-sort"
export const VIEW_MENU_ID = "customers-list-view"
export const OWNER_MENU_ID = "customers-list-owner"
export const SAVE_MODAL_ID = "customers-list-save"
export const HOVER_CARD_ID = "customers-list-hover-card"

/** Rows rendered at a time: thousands of rows make every keystroke slow. */
export const ROW_PAGE = 200

/** At most this many accounts per `customers.sparklines` call (the RPC's limit). */
export const SPARKLINE_BATCH = 200
export const SPARKLINE_DAYS = 30

const DAY_MS = 86_400_000

// VIEWS

/** What the seeded built-in views apply until the synced rows arrive (backend `defaults.ts`). */
const BUILT_IN_FALLBACK: ReadonlyArray<{
	readonly key: Customers.BuiltInViewKey
	readonly name: string
	readonly filters: Customers.ViewFilters
}> = [
	{ key: "my_customers", name: "My customers", filters: { ownedByMe: true } },
	{ key: "paying", name: "Paying", filters: { payingOnly: true } },
	{ key: "trialing", name: "Trialing", filters: { lifecycleStages: ["trialing"] } },
	{ key: "at_risk", name: "At risk", filters: { healthStatuses: ["at_risk", "critical"] } },
	{ key: "churned", name: "Churned", filters: { lifecycleStages: ["churned"] } },
]

export const ALL_DRAFT: Draft = {
	filters: {},
	sort: { column: "name", direction: "asc" },
	columns: Customers.DEFAULT_LIST_COLUMNS,
}

/** A tab: "All customers" (key null), a saved view, or a built-in before the views sync. */
export interface ViewTab {
	readonly key: string | null
	readonly name: string
	readonly draft: Draft
	/** The synced row; none for "All" and the fallbacks. */
	readonly row: ViewRow | null
}

const builtInFallbackTabs: ReadonlyArray<ViewTab> = BUILT_IN_FALLBACK.map((view) => ({
	key: view.key,
	name: view.name,
	draft: { filters: view.filters, sort: { column: "mrr", direction: "desc" }, columns: ALL_DRAFT.columns },
	row: null,
}))

const tabOfRow = (row: ViewRow): ViewTab => ({
	key: row.builtInKey ?? row.id,
	name: row.name,
	draft: { filters: row.filters, sort: row.sort, columns: row.columns },
	row,
})

/** Every tab, in order: All, then the synced views (or the built-ins until they sync). */
export const viewTabsOf = (views: ReadonlyArray<ViewRow> | null): ReadonlyArray<ViewTab> => [
	{ key: null, name: "All customers", draft: ALL_DRAFT, row: null },
	...(views === null ? builtInFallbackTabs : views.map(tabOfRow)),
]

/** The tab `?view=` names; an unknown id is "All". */
export const currentTab = (model: Pick<Model, "view" | "views">): ViewTab => {
	const tabs = viewTabsOf(model.views)
	return (
		tabs.find((tab) => tab.key !== null && (tab.key === model.view || tab.row?.id === model.view)) ??
		tabs[0]
	)
}

/** Filters compared as JSON: absent, empty lists and key order do not count. */
const canonicalFilters = (filters: Customers.ViewFilters): string =>
	JSON.stringify(
		Object.entries(filters)
			.filter(
				([, value]) =>
					value !== undefined && !(globalThis.Array.isArray(value) && value.length === 0),
			)
			.sort(([left], [right]) => left.localeCompare(right)),
	)

export const sameDraft = (left: Draft, right: Draft): boolean =>
	canonicalFilters(left.filters) === canonicalFilters(right.filters) &&
	left.sort.column === right.sort.column &&
	left.sort.direction === right.sort.direction &&
	left.columns.join() === right.columns.join()

export const isEdited = (model: Model): boolean => !sameDraft(model.draft, currentTab(model).draft)

export interface Viewer {
	readonly userId: UserId | null
	readonly nowMs: number
	/** Admins and owners edit shared and built-in views. */
	readonly isAdmin: boolean
}

/** The current view can take the edits: one's own view, or (admins) a shared or built-in one. */
export const canUpdateView = (tab: ViewTab, viewer: Viewer): boolean =>
	tab.row !== null && (tab.row.ownerUserId === viewer.userId || viewer.isAdmin)

/** The shipped name and draft of a built-in view (`BUILT_IN_FALLBACK`); none for other views. */
export const builtInDefaultOf = (tab: ViewTab): ViewTab | undefined =>
	builtInFallbackTabs.find((fallback) => fallback.key === tab.row?.builtInKey)

/** An admin-edited built-in view can go back to its shipped name and draft. */
const canRestoreDefault = (tab: ViewTab, viewer: Viewer): boolean => {
	const fallback = builtInDefaultOf(tab)
	return (
		fallback !== undefined &&
		canUpdateView(tab, viewer) &&
		(fallback.name !== tab.name || !sameDraft(fallback.draft, tab.draft))
	)
}

/** Built-in views stay; one's own personal view (or, for admins, a shared one) can go. */
export const canDeleteView = (tab: ViewTab, viewer: Viewer): boolean =>
	tab.row !== null && tab.row.builtInKey === null && canUpdateView(tab, viewer)

// FILTERING

const hasRisk = (account: AccountRow) =>
	account.openRiskHigh + account.openRiskMedium + account.openRiskLow > 0

const matchesOwner = (filters: Customers.ViewFilters, account: AccountRow, viewer: Viewer): boolean => {
	const ids = filters.ownerUserIds ?? []
	if (!filters.ownedByMe && ids.length === 0 && !filters.unowned) return true
	const owner = account.ownerUserId
	return owner === null
		? filters.unowned === true
		: (filters.ownedByMe === true && owner === viewer.userId) || ids.includes(owner)
}

/** One account against a view's filters (`ViewFilters`: every field narrows). */
export const matchesFilters = (
	filters: Customers.ViewFilters,
	account: AccountRow,
	viewer: Viewer,
): boolean => {
	const query = (filters.search ?? "").trim().toLowerCase()
	const inList = <A>(list: ReadonlyArray<A> | undefined, value: A) =>
		list === undefined || list.length === 0 || list.includes(value)
	return (
		matchesOwner(filters, account, viewer) &&
		inList(filters.lifecycleStages, account.lifecycleStage) &&
		inList(filters.healthStatuses, account.healthStatus) &&
		inList(filters.planNames, account.planName ?? "") &&
		(filters.tagsAny === undefined ||
			filters.tagsAny.length === 0 ||
			account.tags.some((tag) => filters.tagsAny?.includes(tag))) &&
		(filters.minMrrMinor === undefined || account.mrrMinor >= filters.minMrrMinor) &&
		(filters.maxMrrMinor === undefined || account.mrrMinor <= filters.maxMrrMinor) &&
		(!filters.payingOnly || account.mrrMinor > 0) &&
		(filters.hasOpenRiskSignals === undefined || hasRisk(account) === filters.hasOpenRiskSignals) &&
		(filters.lastActiveWithinDays === undefined ||
			(account.lastActiveAtMs !== null &&
				account.lastActiveAtMs >= viewer.nowMs - filters.lastActiveWithinDays * DAY_MS)) &&
		(filters.inactiveForDays === undefined ||
			account.lastActiveAtMs === null ||
			account.lastActiveAtMs < viewer.nowMs - filters.inactiveForDays * DAY_MS) &&
		(query === "" ||
			account.name.toLowerCase().includes(query) ||
			(account.domain ?? "").toLowerCase().includes(query))
	)
}

/** The draft's filters plus the search box. */
export const effectiveFilters = (model: Model): Customers.ViewFilters =>
	model.search.trim() === "" ? model.draft.filters : { ...model.draft.filters, search: model.search }

export const countMatching = (
	accounts: ReadonlyArray<AccountRow>,
	filters: Customers.ViewFilters,
	viewer: Viewer,
): number => accounts.filter((account) => matchesFilters(filters, account, viewer)).length

// SORTING

const STAGE_ORDER = { lead: 0, trialing: 1, active: 2, past_due: 3, churned: 4 } as const

const nullsLast = (value: number | null, direction: "asc" | "desc") =>
	value === null ? (direction === "asc" ? Infinity : -Infinity) : value

/** The column's sort key; text columns compare as text. */
const sortKeyOf = (
	column: Customers.ListColumn,
	account: AccountRow,
	ownerName: (id: UserId | null) => string,
	direction: "asc" | "desc",
): number | string => {
	switch (column) {
		case "name":
			return account.name.toLowerCase()
		case "owner":
			return account.ownerUserId === null ? "￿" : ownerName(account.ownerUserId).toLowerCase()
		case "stage":
			return STAGE_ORDER[account.lifecycleStage]
		case "plan":
			return (account.planName ?? "￿").toLowerCase()
		case "mrr":
			return account.mrrMinor
		case "health":
			return nullsLast(account.healthStatus === "unknown" ? null : account.healthScore, direction)
		case "active_users_30d":
			return account.activeUsers30d
		case "usage_trend":
			return nullsLast(account.activeUsersTrendPct, direction)
		case "last_active":
			return nullsLast(account.lastActiveAtMs, direction)
		case "open_signals":
			return account.openRiskHigh * 100 + account.openRiskMedium * 10 + account.openRiskLow
		case "customer_since":
			return nullsLast(account.customerSinceMs, direction)
		case "tags":
			return account.tags.length
	}
}

export const sortAccounts = (
	accounts: ReadonlyArray<AccountRow>,
	sort: Customers.ViewSort,
	members: ReadonlyArray<MemberRow>,
): ReadonlyArray<AccountRow> => {
	const names = new Map(members.map((member) => [member.id, member.name]))
	const ownerName = (id: UserId | null) => (id === null ? "" : (names.get(id) ?? ""))
	const keyed = accounts.map((account) => ({
		account,
		key: sortKeyOf(sort.column, account, ownerName, sort.direction),
	}))
	const byKey = Order.make<(typeof keyed)[number]>((left, right) => {
		const order =
			typeof left.key === "string" && typeof right.key === "string"
				? left.key.localeCompare(right.key)
				: Number(left.key) - Number(right.key)
		return order < 0 ? -1 : order > 0 ? 1 : 0
	})
	const byName = Order.mapInput(Order.String, (entry: (typeof keyed)[number]) => entry.account.name)
	return Array.sort(keyed, Order.combine(sort.direction === "asc" ? byKey : Order.flip(byKey), byName)).map(
		(entry) => entry.account,
	)
}

/**
 * Remembers the last result: update and view ask for the same derived rows many times per Message,
 * and recomputing them over thousands of accounts on each ask is what makes the list slow.
 */
const memoLast = <A>() => {
	let last: { readonly inputs: ReadonlyArray<unknown>; readonly value: A } | null = null
	return (inputs: ReadonlyArray<unknown>, compute: () => A): A => {
		if (last !== null && inputs.every((input, index) => Object.is(input, last?.inputs[index])))
			return last.value
		const value = compute()
		last = { inputs, value }
		return value
	}
}

const visibleMemo = memoLast<ReadonlyArray<AccountRow>>()

/** The rows the table shows, in order. */
export const visibleAccounts = (model: Model, viewer: Viewer): ReadonlyArray<AccountRow> =>
	visibleMemo(
		[
			model.accounts,
			model.draft.filters,
			model.draft.sort,
			model.search,
			model.members,
			viewer.userId,
			viewer.nowMs,
		],
		() =>
			sortAccounts(
				(model.accounts ?? []).filter((account) =>
					matchesFilters(effectiveFilters(model), account, viewer),
				),
				model.draft.sort,
				model.members,
			),
	)

const tabCountsMemo = memoLast<ReadonlyMap<string | null, number>>()

/** Each view tab's count, by tab key. */
export const viewTabCounts = (model: Model, viewer: Viewer): ReadonlyMap<string | null, number> =>
	tabCountsMemo([model.accounts, model.views, viewer.userId, viewer.nowMs], () => {
		const accounts = model.accounts ?? []
		return new Map(
			viewTabsOf(model.views).map((tab) => [
				tab.key,
				countMatching(accounts, tab.draft.filters, viewer),
			]),
		)
	})

const perOwnerMemo = memoLast<ReadonlyMap<UserId | null, number>>()

/** How many accounts each owner has (null: unowned): the owner menu's counts. */
export const accountsPerOwner = (
	accounts: ReadonlyArray<AccountRow> | null,
): ReadonlyMap<UserId | null, number> =>
	perOwnerMemo([accounts], () => {
		const counts = new Map<UserId | null, number>()
		for (const account of accounts ?? [])
			counts.set(account.ownerUserId, (counts.get(account.ownerUserId) ?? 0) + 1)
		return counts
	})

/** The selection and the keyboard cursor without the rows the list no longer shows. */
export const keepVisibleSelection = (model: Model, viewer: Viewer): Model => {
	if (model.selected.length === 0 && model.focusedId === null) return model
	const visible = new Set<string>(visibleAccounts(model, viewer).map((account) => account.id))
	const selected = model.selected.filter((id) => visible.has(id))
	const focusedId = model.focusedId !== null && visible.has(model.focusedId) ? model.focusedId : null
	return selected.length === model.selected.length && focusedId === model.focusedId
		? model
		: { ...model, selected, focusedId }
}

/** A header press: the same column flips, another starts descending (ascending for text). */
export const nextSort = (sort: Customers.ViewSort, column: Customers.ListColumn): Customers.ViewSort =>
	sort.column === column
		? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
		: { column, direction: TEXT_COLUMNS.includes(column) ? "asc" : "desc" }

const TEXT_COLUMNS: ReadonlyArray<Customers.ListColumn> = ["name", "owner", "plan", "stage"]

// COLUMNS

export const COLUMN_LABEL = {
	name: "Customer",
	owner: "Owner",
	stage: "Stage",
	plan: "Plan",
	mrr: "MRR",
	health: "Health",
	active_users_30d: "Active 30d",
	usage_trend: "Trend",
	last_active: "Last active",
	open_signals: "Signals",
	customer_since: "Since",
	tags: "Tags",
} as const satisfies Record<Customers.ListColumn, string>

/** The picker's longer names. */
export const COLUMN_NAME = {
	...COLUMN_LABEL,
	active_users_30d: "Active users 30d",
	usage_trend: "Usage trend",
	open_signals: "Open signals",
	customer_since: "Customer since",
} as const satisfies Record<Customers.ListColumn, string>

/** The name column always shows, first. */
export const shownColumns = (
	columns: ReadonlyArray<Customers.ListColumn>,
): ReadonlyArray<Customers.ListColumn> => ["name", ...columns.filter((column) => column !== "name")]

export const hiddenColumns = (
	columns: ReadonlyArray<Customers.ListColumn>,
): ReadonlyArray<Customers.ListColumn> =>
	Customers.ListColumn.literals.filter((column) => !shownColumns(columns).includes(column))

export const toggleColumn = (
	columns: ReadonlyArray<Customers.ListColumn>,
	column: Customers.ListColumn,
	isShown: boolean,
): ReadonlyArray<Customers.ListColumn> =>
	column === "name"
		? shownColumns(columns)
		: isShown
			? [...shownColumns(columns).filter((entry) => entry !== column), column]
			: shownColumns(columns).filter((entry) => entry !== column)

/** Moves a shown column one place (the name column stays first). */
export const moveColumn = (
	columns: ReadonlyArray<Customers.ListColumn>,
	column: Customers.ListColumn,
	step: -1 | 1,
): ReadonlyArray<Customers.ListColumn> => {
	const shown = [...shownColumns(columns)]
	const index = shown.indexOf(column)
	const target = index + step
	if (column === "name" || index < 0 || target < 1 || target >= shown.length) return shown
	shown[index] = shown[target]
	shown[target] = column
	return shown
}

// FILTER CHIPS

const FIELD_KEYS = {
	owner: ["ownedByMe", "ownerUserIds", "unowned"],
	stage: ["lifecycleStages"],
	plan: ["planNames"],
	tag: ["tagsAny"],
	health: ["healthStatuses"],
	mrr: ["minMrrMinor", "maxMrrMinor", "payingOnly"],
	last_active: ["lastActiveWithinDays", "inactiveForDays"],
	signals: ["hasOpenRiskSignals"],
} as const satisfies Record<FilterField, ReadonlyArray<keyof Customers.ViewFilters>>

/** The filters without one field's keys. */
export const clearField = (filters: Customers.ViewFilters, field: FilterField): Customers.ViewFilters =>
	Object.fromEntries(
		Object.entries(filters).filter(
			([key]) => !(FIELD_KEYS[field] as ReadonlyArray<string>).includes(key),
		),
	) as Customers.ViewFilters

export const isFieldActive = (filters: Customers.ViewFilters, field: FilterField): boolean =>
	canonicalFilters(clearField(filters, field)) !== canonicalFilters(filters)

/** The active fields, in builder order. */
export const activeFields = (filters: Customers.ViewFilters): ReadonlyArray<FilterField> =>
	FilterField.literals.filter((field) => isFieldActive(filters, field))

/** For "No customers match": the filter whose removal shows the most rows, and how many. */
export const bestFilterToRemove = (
	model: Model,
	viewer: Viewer,
): Readonly<{ field: FilterField; count: number }> | null => {
	const accounts = model.accounts ?? []
	const filters = effectiveFilters(model)
	return activeFields(model.draft.filters).reduce<Readonly<{ field: FilterField; count: number }> | null>(
		(best, field) => {
			const count = countMatching(accounts, clearField(filters, field), viewer)
			return best === null || count > best.count ? { field, count } : best
		},
		null,
	)
}

/** Distinct plans and tags of the accounts, for the builder's options. */
export const plansOf = (accounts: ReadonlyArray<AccountRow>): ReadonlyArray<string> =>
	[...new Set(accounts.flatMap((account) => (account.planName === null ? [] : [account.planName])))].sort()

export const tagsOf = (accounts: ReadonlyArray<AccountRow>): ReadonlyArray<string> =>
	[...new Set(accounts.flatMap((account) => account.tags))].sort()

/** Adds or removes `value` from a list filter; an empty list drops the key. */
export const toggleIn = <A>(list: ReadonlyArray<A> | undefined, value: A): ReadonlyArray<A> | undefined => {
	const next = (list ?? []).includes(value)
		? (list ?? []).filter((entry) => entry !== value)
		: [...(list ?? []), value]
	return next.length === 0 ? undefined : next
}

/** Sets a key, or removes it when `value` is undefined (the schema has optional keys, not undefined). */
export const withFilter = <K extends keyof Customers.ViewFilters>(
	filters: Customers.ViewFilters,
	key: K,
	value: Customers.ViewFilters[K] | undefined,
): Customers.ViewFilters => {
	const { [key]: _removed, ...rest } = filters
	return value === undefined ? rest : { ...rest, [key]: value }
}

// SPARKLINES

/** The next rendered accounts (by display order) whose sparkline was not asked for yet. */
export const missingSparklines = (model: Model, viewer: Viewer): ReadonlyArray<CustomerAccountId> => {
	const requested = new Set(model.requestedSparklines)
	return visibleAccounts(model, viewer)
		.slice(0, model.rowLimit)
		.filter((account) => !requested.has(account.id))
		.slice(0, SPARKLINE_BATCH)
		.map((account) => account.id)
}

// MENUS

export const SORT_COLUMNS: ReadonlyArray<Customers.ListColumn> = [
	"name",
	"mrr",
	"health",
	"active_users_30d",
	"usage_trend",
	"last_active",
	"open_signals",
	"customer_since",
]

/** `<column>:<direction>`. */
export const sortEntries: ReadonlyArray<Menu.Entry> = SORT_COLUMNS.flatMap((column) =>
	TEXT_COLUMNS.includes(column)
		? [Menu.item(`${column}:asc`), Menu.item(`${column}:desc`)]
		: [Menu.item(`${column}:desc`), Menu.item(`${column}:asc`)],
)

export const sortLabel = (sort: Customers.ViewSort): string => {
	if (sort.column === "name") return sort.direction === "asc" ? "Name A–Z" : "Name Z–A"
	return `${COLUMN_NAME[sort.column]}, ${sort.direction === "desc" ? "high to low" : "low to high"}`
}

export const parseSortKey = (key: string): Customers.ViewSort | null => {
	const [column, direction] = key.split(":")
	const parsedColumn = Customers.ListColumn.literals.find((literal) => literal === column)
	return parsedColumn === undefined || (direction !== "asc" && direction !== "desc")
		? null
		: { column: parsedColumn, direction }
}

export const OWNER_ME = "me"
export const OWNER_NONE = "none"
const OWNER_USER = "user:"
export const ownerKeyOf = (userId: UserId) => `${OWNER_USER}${userId}`
export const userIdOfOwnerKey = (key: string): string | null =>
	key.startsWith(OWNER_USER) ? key.slice(OWNER_USER.length) : null

export const ownerEntries = (
	members: ReadonlyArray<MemberRow>,
	viewer: Viewer,
): ReadonlyArray<Menu.Entry> => [
	Menu.item(OWNER_ME),
	...members
		.filter((member) => member.id !== viewer.userId)
		.map((member) => Menu.item(ownerKeyOf(member.id), { textValue: member.name })),
	Menu.separator,
	Menu.item(OWNER_NONE, { textValue: "Remove owner" }),
]

export const ViewMenuKey = Schema.Literals([
	"save",
	"save_as",
	"rename",
	"reset",
	"restore_default",
	"delete",
])
export type ViewMenuKey = typeof ViewMenuKey.Type

export const viewMenuEntries = (model: Model, viewer: Viewer): ReadonlyArray<Menu.Entry> => {
	const tab = currentTab(model)
	const edited = isEdited(model)
	return [
		Menu.item("save", { isDisabled: !edited || !canUpdateView(tab, viewer) }),
		Menu.item("save_as"),
		Menu.item("rename", { isDisabled: !canUpdateView(tab, viewer) || tab.row?.builtInKey !== null }),
		Menu.item("reset", { isDisabled: !edited }),
		...(builtInDefaultOf(tab) === undefined
			? []
			: [Menu.item("restore_default", { isDisabled: !canRestoreDefault(tab, viewer) })]),
		Menu.separator,
		Menu.item("delete", { intent: "Danger", isDisabled: !canDeleteView(tab, viewer) }),
	]
}

/** The keys the list answers to while nothing else holds the keyboard. */
export const ListKey = Schema.Literals(["next", "previous", "open", "select", "search", "escape"])
export type ListKey = typeof ListKey.Type
