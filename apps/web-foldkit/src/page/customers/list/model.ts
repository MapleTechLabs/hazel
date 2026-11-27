import * as Customers from "@hazel/domain/customers"
import { DragAndDrop } from "@foldkit/ui"
import { listRows } from "@hazel/shared-screens/customers/list/columns"
import {
	activeFields,
	canonicalFilters,
	clearField,
	countMatching,
	type FilterField,
	type Viewer,
	withSearch,
} from "@hazel/shared-screens/customers/list/filters"
import { CustomerAccountId, CustomerSavedViewId, CustomerViewLayoutId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import { lookOf, type ViewLook } from "../../../customers/ui/view-look"
import {
	ALL_KEY,
	arrange,
	canHideFromSidebar,
	CURRENT_KEY,
	layoutOf,
	sidebarKeysOf,
} from "../../../customers/view-layout"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"

/**
 * The customers list (`docs/customers/spec.md` §3): saved-view tabs over the synced accounts, with
 * search, filters, sort and columns (the hazel controls and table in the page's holes), bulk
 * actions and a hover preview. A view's
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
	position: Schema.Finite,
	filters: Customers.ViewFilters,
	sort: Customers.ViewSort,
	columns: Schema.Array(Customers.ListColumn),
	icon: Schema.NullOr(Customers.ViewIcon),
	color: Schema.NullOr(Customers.ViewColor),
})
export type ViewRow = typeof ViewRow.Type

/** What the table applies now: the view's own, or the user's edits of it. */
export const Draft = Schema.Struct({
	filters: Customers.ViewFilters,
	sort: Customers.ViewSort,
	columns: Schema.Array(Customers.ListColumn),
})
export type Draft = typeof Draft.Type

export const SaveForm = Schema.Struct({
	/** "edit": the current view's name and look instead of a new view. */
	mode: Schema.Literals(["create", "edit"]),
	name: Schema.String,
	icon: Schema.NullOr(Customers.ViewIcon),
	color: Schema.NullOr(Customers.ViewColor),
	isShared: Schema.Boolean,
})
export type SaveForm = typeof SaveForm.Type

export const Model = Schema.Struct({
	/** `?view=`: a built-in key, a saved view's id or `all`; none is "Current customers". */
	view: Schema.NullOr(Schema.String),
	draft: Draft,
	/** Typing narrows the table but is not part of a view. */
	search: Schema.String,
	/** Live rows; null until each query answers. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	views: Schema.NullOr(Schema.Array(ViewRow)),
	/** My order of the tabs and the views the sidebar leaves out; null: the default. */
	layout: Schema.NullOr(Customers.ViewLayoutDraft),
	/** Its synced row's id: null before the first save. */
	layoutId: Schema.NullOr(CustomerViewLayoutId),
	/** Dragging a tab to reorder the tabs (and the sidebar's views). */
	tabDrag: DragAndDrop.Model,
	members: Schema.Array(MemberRow),
	connectedProviders: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	lastComputedAtMs: Schema.NullOr(Schema.Finite),
	/** What totals and MRR filters are shown in (the org's settings). */
	reportingCurrency: Schema.String,
	/** 30 days of daily active users per account (`customers.sparklines`). */
	sparklines: Schema.Record(Schema.String, Schema.Array(Schema.Finite)),
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
	tagPopover: Popover.Model,
	tagInput: Schema.String,
	viewMenu: Menu.Model,
	ownerMenu: Menu.Model,
	saveModal: Modal.Model,
	saveForm: Schema.NullOr(SaveForm),
	/** "Delete view" asks first; it deletes the current view. */
	deleteModal: Modal.Model,
})
export type Model = typeof Model.Type

export const TAG_POPOVER_ID = "customers-list-tag"
export const VIEW_MENU_ID = "customers-list-view"
export const OWNER_MENU_ID = "customers-list-owner"
export const SAVE_MODAL_ID = "customers-list-save"
export const DELETE_MODAL_ID = "customers-list-delete-view"
export const TAB_LIST_ID = "customers-list-tabs"
export const HOVER_CARD_ID = "customers-list-hover-card"

/** Rows rendered at a time: thousands of rows make every keystroke slow. */
export const ROW_PAGE = 200

/** At most this many accounts per `customers.sparklines` call (the RPC's limit). */
export const SPARKLINE_BATCH = 200
export const SPARKLINE_DAYS = 30

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
	{ key: "churned", name: "Churned", filters: { lifecycleStages: ["churned"] } },
]

export const ALL_DRAFT: Draft = {
	filters: {},
	sort: { column: "name", direction: "asc" },
	columns: Customers.DEFAULT_LIST_COLUMNS,
}

/** The default tab: paying and trialing accounts (the backend's "customer"). */
export const CURRENT_DRAFT: Draft = {
	filters: { lifecycleStages: ["trialing", "active", "past_due"] },
	sort: { column: "mrr", direction: "desc" },
	columns: Customers.DEFAULT_LIST_COLUMNS,
}

/** `?view=` of the "All customers" tab. */
export const ALL_VIEW_KEY = ALL_KEY

/**
 * A tab: "Current customers" (key null, the default), a saved view, a built-in before the views
 * sync, or "All customers" (`ALL_VIEW_KEY`).
 */
export interface ViewTab {
	readonly key: string | null
	readonly name: string
	readonly draft: Draft
	/** The synced row; none for "Current", "All" and the fallbacks. */
	readonly row: ViewRow | null
	readonly look: ViewLook
}

/** The tab's key in the view layout (`customers/view-layout.ts`). */
export const layoutKeyOf = (tab: ViewTab): string => tab.key ?? CURRENT_KEY

const builtInFallbackTabs: ReadonlyArray<ViewTab> = BUILT_IN_FALLBACK.map((view) => ({
	key: view.key,
	name: view.name,
	draft: { filters: view.filters, sort: { column: "mrr", direction: "desc" }, columns: ALL_DRAFT.columns },
	row: null,
	look: lookOf(view.key, null),
}))

const tabOfRow = (row: ViewRow): ViewTab => ({
	key: row.builtInKey ?? row.id,
	name: row.name,
	draft: { filters: row.filters, sort: row.sort, columns: row.columns },
	row,
	look: lookOf(row.builtInKey ?? row.id, row),
})

/** Every tab, in order: Current, the synced views (or the built-ins until they sync), then All. */
export const viewTabsOf = (views: ReadonlyArray<ViewRow> | null): ReadonlyArray<ViewTab> => [
	{
		key: null,
		name: "Current customers",
		draft: CURRENT_DRAFT,
		row: null,
		look: lookOf(CURRENT_KEY, null),
	},
	...(views === null ? builtInFallbackTabs : views.map(tabOfRow)),
	{ key: ALL_VIEW_KEY, name: "All customers", draft: ALL_DRAFT, row: null, look: lookOf(ALL_KEY, null) },
]

/** The tabs in my order (the layout's), as the tab bar shows them. */
export const orderedTabsOf = (model: Pick<Model, "views" | "layout">): ReadonlyArray<ViewTab> =>
	arrange(viewTabsOf(model.views), layoutKeyOf, (model.layout ?? Customers.DEFAULT_VIEW_LAYOUT).order)

/** Whether the sidebar shows the tab, and whether it may hide it (one view always stays). */
export const sidebarStateOf = (model: Pick<Model, "views" | "layout">, key: string) => {
	const layout = layoutOf(model.layout)
	const keys = orderedTabsOf(model).map(layoutKeyOf)
	return {
		isShown: sidebarKeysOf(layout, keys).includes(key),
		canHide: canHideFromSidebar(layout, keys, key),
	}
}

/** The tab `?view=` names; an unknown id is "Current". */
export const currentTab = (model: Pick<Model, "view" | "views">): ViewTab => {
	const tabs = viewTabsOf(model.views)
	return (
		tabs.find((tab) => tab.key !== null && (tab.key === model.view || tab.row?.id === model.view)) ??
		tabs[0]
	)
}

export const sameDraft = (left: Draft, right: Draft): boolean =>
	canonicalFilters(left.filters) === canonicalFilters(right.filters) &&
	left.sort.column === right.sort.column &&
	left.sort.direction === right.sort.direction &&
	left.columns.join() === right.columns.join()

export const isEdited = (model: Model): boolean => !sameDraft(model.draft, currentTab(model).draft)

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

/** The draft's filters plus the search box. */
export const effectiveFilters = (model: Model): Customers.ViewFilters =>
	withSearch(model.draft.filters, model.search)

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

/** The rows the table shows, in order: sorted, then each customer's environments kept together. */
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
			listRows(model.accounts ?? [], effectiveFilters(model), model.draft.sort, model.members, viewer),
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

// FILTER CHIPS

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
	"edit",
	"sidebar",
	"reset",
	"restore_default",
	"delete",
])
export type ViewMenuKey = typeof ViewMenuKey.Type

export const viewMenuEntries = (model: Model, viewer: Viewer): ReadonlyArray<Menu.Entry> => {
	const tab = currentTab(model)
	const edited = isEdited(model)
	const sidebar = sidebarStateOf(model, layoutKeyOf(tab))
	return [
		Menu.item("save", { isDisabled: !edited || !canUpdateView(tab, viewer) }),
		Menu.item("save_as"),
		Menu.item("edit", { isDisabled: !canUpdateView(tab, viewer) }),
		Menu.item("sidebar", { isDisabled: sidebar.isShown && !sidebar.canHide }),
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
