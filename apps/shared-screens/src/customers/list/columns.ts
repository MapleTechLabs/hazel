/**
 * The customers list's columns and sort: their names, what the column picker does to a view's
 * columns, the sort menu's entries and the rows' order. Pure; the list page and its table share it.
 */
import * as Customers from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Array, Order } from "effect"
import { fundingStageRank, headquartersLabel } from "../data/company"
import type { AccountRow, MemberRow } from "../data/queries"
import { groupRows } from "../data/groups"
import { employeeRangeOf, fundingOf, industryOf, matchesFilters, type Viewer } from "./filters"

export const COLUMN_LABEL = {
	name: "Customer",
	owner: "Owner",
	stage: "Stage",
	plan: "Plan",
	mrr: "MRR",
	active_users_30d: "Active 30d",
	usage_trend: "Trend",
	last_active: "Last active",
	open_signals: "Signals",
	customer_since: "Since",
	tags: "Tags",
	industry: "Industry",
	company_size: "Size",
	headquarters: "HQ",
	funding: "Funding",
} as const satisfies Record<Customers.ListColumn, string>

/** The picker's longer names. */
export const COLUMN_NAME = {
	...COLUMN_LABEL,
	active_users_30d: "Active users 30d",
	usage_trend: "Usage trend",
	open_signals: "Open signals",
	customer_since: "Customer since",
	company_size: "Company size",
	headquarters: "Headquarters",
} as const satisfies Record<Customers.ListColumn, string>

// PICKER

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

// SORT

const TEXT_COLUMNS: ReadonlyArray<Customers.ListColumn> = [
	"name",
	"owner",
	"plan",
	"stage",
	"industry",
	"headquarters",
]

/** Text columns whose sort reads as A–Z rather than low to high. */
const ALPHABETICAL_COLUMNS: ReadonlyArray<Customers.ListColumn> = ["industry", "headquarters"]

/** A header press: the same column flips, another starts descending (ascending for text). */
export const nextSort = (sort: Customers.ViewSort, column: Customers.ListColumn): Customers.ViewSort =>
	sort.column === column
		? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
		: { column, direction: TEXT_COLUMNS.includes(column) ? "asc" : "desc" }

/** The columns the sort menu offers. */
export const SORT_COLUMNS: ReadonlyArray<Customers.ListColumn> = [
	"name",
	"mrr",
	"active_users_30d",
	"usage_trend",
	"last_active",
	"open_signals",
	"customer_since",
	"company_size",
	"funding",
]

export const sortLabel = (sort: Customers.ViewSort): string => {
	if (sort.column === "name") return sort.direction === "asc" ? "Name A–Z" : "Name Z–A"
	if (ALPHABETICAL_COLUMNS.includes(sort.column))
		return `${COLUMN_NAME[sort.column]} ${sort.direction === "asc" ? "A–Z" : "Z–A"}`
	return `${COLUMN_NAME[sort.column]}, ${sort.direction === "desc" ? "high to low" : "low to high"}`
}

/** `<column>:<direction>`: a sort menu entry's id. */
export const sortKeyOf = (sort: Customers.ViewSort): string => `${sort.column}:${sort.direction}`

export const parseSortKey = (key: string): Customers.ViewSort | null => {
	const [column, direction] = key.split(":")
	const parsedColumn = Customers.ListColumn.literals.find((literal) => literal === column)
	return parsedColumn === undefined || (direction !== "asc" && direction !== "desc")
		? null
		: { column: parsedColumn, direction }
}

/** The sort menu: each column's two orders, the more useful first; the current one checked. */
export const sortMenuGroups = (current: Customers.ViewSort): Content.MenuGroups => [
	{
		entries: SORT_COLUMNS.flatMap((column) =>
			(TEXT_COLUMNS.includes(column) ? (["asc", "desc"] as const) : (["desc", "asc"] as const)).map(
				(direction) => {
					const sort = { column, direction }
					return {
						id: sortKeyOf(sort),
						label: sortLabel(sort),
						checked: current.column === column && current.direction === direction,
					}
				},
			),
		),
	},
]

const STAGE_ORDER = { lead: 0, trialing: 1, active: 2, past_due: 3, churned: 4 } as const

const nullsLast = (value: number | null, direction: "asc" | "desc") =>
	value === null ? (direction === "asc" ? Infinity : -Infinity) : value

const lowerOrNull = (text: string | null) => (text === null ? null : text.toLowerCase())

/** The column's sort key; text columns compare as text, and a null key sorts last either way. */
const keyOf = (
	column: Customers.ListColumn,
	account: AccountRow,
	ownerName: (id: UserId | null) => string,
	direction: "asc" | "desc",
): number | string | null => {
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
		case "active_users_30d":
			return account.activeUsers30d
		case "usage_trend":
			return nullsLast(account.activeUsersTrendPct, direction)
		case "last_active":
			return nullsLast(account.lastActiveAtMs, direction)
		case "open_signals":
			return account.openRiskHigh * 100 + account.openRiskMedium * 10 + account.openRiskLow
		case "customer_since":
			return account.firstSeenAtMs
		case "tags":
			return account.tags.length
		case "industry":
			return lowerOrNull(industryOf(account))
		case "company_size": {
			const range = employeeRangeOf(account)
			return range === null ? null : Customers.EmployeeRange.literals.indexOf(range)
		}
		case "headquarters":
			return lowerOrNull(account.company === null ? null : headquartersLabel(account.company))
		case "funding": {
			const stage = fundingOf(account)
			return stage === null ? null : fundingStageRank(stage)
		}
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
		key: keyOf(sort.column, account, ownerName, sort.direction),
	}))
	type Entry = (typeof keyed)[number]
	/** Unknowns after every known value, whichever the direction. */
	const knownFirst = Order.mapInput(Order.Boolean, (entry: Entry) => entry.key === null)
	const byKey = Order.make<Entry>((left, right) => {
		if (left.key === null || right.key === null) return 0
		const order =
			typeof left.key === "string" && typeof right.key === "string"
				? left.key.localeCompare(right.key)
				: Number(left.key) - Number(right.key)
		return order < 0 ? -1 : order > 0 ? 1 : 0
	})
	const byName = Order.mapInput(Order.String, (entry: Entry) => entry.account.name)
	return Array.sort(
		keyed,
		Order.combineAll([knownFirst, sort.direction === "asc" ? byKey : Order.flip(byKey), byName]),
	).map((entry) => entry.account)
}

/** The rows the list shows, in order: the kept accounts sorted, each customer's environments kept together. */
export const listRows = (
	accounts: ReadonlyArray<AccountRow>,
	filters: Customers.ViewFilters,
	sort: Customers.ViewSort,
	members: ReadonlyArray<MemberRow>,
	viewer: Viewer,
): ReadonlyArray<AccountRow> =>
	groupRows(
		sortAccounts(
			accounts.filter((account) => matchesFilters(filters, account, viewer)),
			sort,
			members,
		),
		new Set(accounts.map((account) => account.id)),
	)
