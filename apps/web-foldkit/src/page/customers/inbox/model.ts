import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerIssueId, type UserId } from "@hazel/schema"
import { Array, Option, Order, Schema } from "effect"
import { ChannelOption } from "../../../customers/channels"
import {
	type IssueRow as IssueRowType,
	IssueRow,
	ISSUE_PRIORITIES,
	needsReply,
	PRIORITY_LABEL,
	PRIORITY_RANK,
	STATUS_LABEL,
} from "../../../customers/issues"
import { AccountRow, type AccountRow as AccountRowType, MemberRow } from "../../../customers/queries"
import { IssueSlaRow, overdueByMs } from "../../../customers/sla"
import * as Menu from "../../../ui/menu"

/**
 * The Support inbox (`docs/customers/issues.md`): every support issue across the linked channels,
 * the sibling of Needs attention. Replies happen in chat; the inbox triages (assign, status,
 * priority) and opens the thread.
 */

// MODEL

export const Tab = Schema.Literals(["open", "on_hold", "closed"])
export type Tab = typeof Tab.Type

/** Whose issues: the default, "Mine or unassigned", is what I own plus what nobody picked up. */
export const AssigneeFilter = Schema.Literals(["mine_or_unassigned", "mine", "unassigned", "anyone"])
export type AssigneeFilter = typeof AssigneeFilter.Type

export const Filters = Schema.Struct({
	assignee: AssigneeFilter,
	/** Only issues new or waiting on us. */
	waitingOnUs: Schema.Boolean,
	/** Only issues past an SLA deadline (a breached chip). */
	overdue: Schema.Boolean,
	accountId: Schema.NullOr(CustomerAccountId),
	priority: Schema.NullOr(Customers.IssuePriority),
	status: Schema.NullOr(Customers.IssueStatus),
})
export type Filters = typeof Filters.Type

export const DEFAULT_FILTERS: Filters = {
	assignee: "mine_or_unassigned",
	waitingOnUs: false,
	overdue: false,
	accountId: null,
	priority: null,
	status: null,
}

export const Model = Schema.Struct({
	tab: Tab,
	filters: Filters,
	search: Schema.String,
	/** Live rows; null until each query answers. */
	issues: Schema.NullOr(Schema.Array(IssueRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	/** The issues' SLA clocks, by issue id; an issue without one has no policy. */
	slas: Schema.Array(IssueSlaRow),
	channels: Schema.Array(ChannelOption),
	members: Schema.Array(MemberRow),
	selectedId: Schema.NullOr(CustomerIssueId),
	assignMenu: Menu.Model,
	statusMenu: Menu.Model,
	priorityMenu: Menu.Model,
	filterMenu: Menu.Model,
})
export type Model = typeof Model.Type

export const SEARCH_ID = "inbox-search"
export const ASSIGN_MENU_ID = "inbox-assign"
export const STATUS_MENU_ID = "inbox-status"
export const PRIORITY_MENU_ID = "inbox-priority"
export const FILTER_MENU_ID = "inbox-filter"

// WHAT IS SHOWN

export interface Viewer {
	readonly userId: UserId | null
	readonly nowMs: number
}

export const tabOf = (issue: IssueRowType): Tab =>
	issue.status === "closed" ? "closed" : issue.status === "on_hold" ? "on_hold" : "open"

export const accountsByIdOfModel = (model: Model): ReadonlyMap<string, AccountRowType> =>
	new Map((model.accounts ?? []).map((account) => [account.id, account]))

export const slasByIdOfModel = (model: Model): ReadonlyMap<string, IssueSlaRow> =>
	new Map(model.slas.map((sla) => [sla.id, sla]))

const matchesAssignee = (filter: AssigneeFilter, viewer: Viewer, assignee: UserId | null): boolean => {
	const mine = viewer.userId !== null && assignee === viewer.userId
	switch (filter) {
		case "anyone":
			return true
		case "mine":
			return mine
		case "unassigned":
			return assignee === null
		case "mine_or_unassigned":
			return mine || assignee === null
	}
}

/** Every filter but the tab: the tab counts read this too. */
const matchesFilters = (
	model: Model,
	viewer: Viewer,
	accountsById: ReadonlyMap<string, AccountRowType>,
	slasById: ReadonlyMap<string, IssueSlaRow>,
	issue: IssueRowType,
): boolean => {
	const { filters } = model
	const query = model.search.trim().toLowerCase()
	const account = accountsById.get(issue.accountId)
	return (
		matchesAssignee(filters.assignee, viewer, issue.assigneeUserId) &&
		(!filters.waitingOnUs || needsReply(issue)) &&
		(!filters.overdue || overdueByMs(slasById.get(issue.id), viewer.nowMs) !== null) &&
		(filters.accountId === null || issue.accountId === filters.accountId) &&
		(filters.priority === null || issue.priority === filters.priority) &&
		(filters.status === null || issue.status === filters.status) &&
		(query === "" ||
			issue.title.toLowerCase().includes(query) ||
			(account?.name.toLowerCase().includes(query) ?? false) ||
			issue.tags.some((tag) => tag.toLowerCase().includes(query)))
	)
}

/**
 * Waiting on us first, overdue ones at its top by how late; then the highest priority; then
 * whoever has waited longest.
 */
const byOpenOrder = (
	slasById: ReadonlyMap<string, IssueSlaRow>,
	nowMs: number,
): Order.Order<IssueRowType> => {
	const lateness = (issue: IssueRowType) =>
		needsReply(issue) ? (overdueByMs(slasById.get(issue.id), nowMs) ?? -1) : -1
	return Order.combine(
		Order.mapInput(Order.flip(Order.Boolean), (issue: IssueRowType) => needsReply(issue)),
		Order.combine(
			Order.mapInput(Order.flip(Order.Number), lateness),
			Order.combine(
				Order.mapInput(
					Order.flip(Order.Number),
					(issue: IssueRowType) => PRIORITY_RANK[issue.priority],
				),
				Order.mapInput(Order.Number, (issue: IssueRowType) => waitingSinceMs(issue)),
			),
		),
	)
}
const byClosed = Order.mapInput(Order.flip(Order.Number), (issue: IssueRowType) => issue.closedAtMs ?? 0)
const byActivity = Order.mapInput(Order.flip(Order.Number), (issue: IssueRowType) => issue.lastMessageAtMs)

/** Since when the issue waits on us: the customer's last message, else when it opened. */
export const waitingSinceMs = (issue: IssueRowType): number =>
	issue.lastCustomerMessageAtMs ?? issue.openedAtMs

/** Closed keeps what closed in the stream's window: an older row lingers until the next resync. */
export const CLOSED_WINDOW_MS = 30 * 86_400_000

const isShown = (issue: IssueRowType, viewer: Viewer): boolean =>
	issue.closedAtMs === null || issue.closedAtMs >= viewer.nowMs - CLOSED_WINDOW_MS

export const visibleIssues = (model: Model, viewer: Viewer): ReadonlyArray<IssueRowType> => {
	const accountsById = accountsByIdOfModel(model)
	const slasById = slasByIdOfModel(model)
	const rows = (model.issues ?? []).filter(
		(issue) =>
			tabOf(issue) === model.tab &&
			isShown(issue, viewer) &&
			matchesFilters(model, viewer, accountsById, slasById, issue),
	)
	return Array.sort(
		rows,
		model.tab === "open"
			? byOpenOrder(slasById, viewer.nowMs)
			: model.tab === "closed"
				? byClosed
				: byActivity,
	)
}

export const tabCounts = (model: Model, viewer: Viewer): Readonly<Record<Tab, number>> => {
	const accountsById = accountsByIdOfModel(model)
	const slasById = slasByIdOfModel(model)
	const counts = { open: 0, on_hold: 0, closed: 0 }
	for (const issue of model.issues ?? []) {
		if (isShown(issue, viewer) && matchesFilters(model, viewer, accountsById, slasById, issue))
			counts[tabOf(issue)] += 1
	}
	return counts
}

export const rowIds = (model: Model, viewer: Viewer): ReadonlyArray<CustomerIssueId> =>
	visibleIssues(model, viewer).map((issue) => issue.id)

export const issueById = (model: Model, issueId: CustomerIssueId | null): IssueRowType | undefined =>
	issueId === null ? undefined : (model.issues ?? []).find((issue) => issue.id === issueId)

export const selectedIssue = (model: Model): IssueRowType | undefined => issueById(model, model.selectedId)

export const isSelectionVisible = (model: Model, viewer: Viewer): boolean =>
	model.selectedId !== null && rowIds(model, viewer).includes(model.selectedId)

/** Whether a search or filter beyond the assignee scope is set, so an empty tab may be hiding issues. */
export const isNarrowed = (model: Model): boolean =>
	model.search.trim() !== "" ||
	model.filters.assignee === "unassigned" ||
	model.filters.waitingOnUs ||
	model.filters.overdue ||
	model.filters.accountId !== null ||
	model.filters.priority !== null ||
	model.filters.status !== null

export const clearNarrowing = (filters: Filters): Filters => ({
	...DEFAULT_FILTERS,
	assignee: filters.assignee === "unassigned" ? "anyone" : filters.assignee,
})

export type FilterField = keyof Filters

export const clearFilter = (filters: Filters, field: FilterField): Filters => {
	switch (field) {
		case "assignee":
			return { ...filters, assignee: "anyone" }
		case "waitingOnUs":
			return { ...filters, waitingOnUs: false }
		case "overdue":
			return { ...filters, overdue: false }
		default:
			return { ...filters, [field]: null }
	}
}

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

export const statusEntries: ReadonlyArray<Menu.Entry> = Customers.IssueStatus.literals.map((status) =>
	Menu.item(status, { textValue: STATUS_LABEL[status] }),
)

/** Urgent first, as Linear lists them. */
export const priorityEntries: ReadonlyArray<Menu.Entry> = [...ISSUE_PRIORITIES]
	.reverse()
	.map((priority) => Menu.item(priority, { textValue: PRIORITY_LABEL[priority] }))

/** Accounts that have issues, by name, for the account filter. */
export const accountsWithIssues = (model: Model): ReadonlyArray<AccountRowType> => {
	const ids = new Set((model.issues ?? []).map((issue) => issue.accountId))
	return (model.accounts ?? []).filter((account) => ids.has(account.id))
}

export const ASSIGNEE_LABEL = {
	mine_or_unassigned: "Mine or unassigned",
	mine: "Mine",
	unassigned: "Unassigned",
	anyone: "Anyone",
} as const satisfies Record<AssigneeFilter, string>

/** Filter keys: `<field>:<value>` toggles that filter. */
export const filterEntries = (model: Model): ReadonlyArray<Menu.Entry> => [
	Menu.section(
		"Assignee",
		AssigneeFilter.literals.map((assignee) =>
			Menu.item(`assignee:${assignee}`, { textValue: ASSIGNEE_LABEL[assignee] }),
		),
	),
	Menu.section("Waiting", [
		Menu.item("waitingOnUs:true", { textValue: "Waiting on us" }),
		Menu.item("overdue:true", { textValue: "Overdue" }),
	]),
	Menu.section(
		"Status",
		Customers.IssueStatus.literals.map((status) =>
			Menu.item(`status:${status}`, { textValue: STATUS_LABEL[status] }),
		),
	),
	Menu.section(
		"Priority",
		[...ISSUE_PRIORITIES]
			.reverse()
			.map((priority) => Menu.item(`priority:${priority}`, { textValue: PRIORITY_LABEL[priority] })),
	),
	...(accountsWithIssues(model).length === 0
		? []
		: [
				Menu.section(
					"Account",
					accountsWithIssues(model).map((account) =>
						Menu.item(`accountId:${account.id}`, { textValue: account.name }),
					),
				),
			]),
]

/** Applies a filter key: picking the active value clears it (the assignee falls back to anyone). */
export const toggleFilter = (filters: Filters, key: string): Filters => {
	const separator = key.indexOf(":")
	const field = key.slice(0, separator)
	const value = key.slice(separator + 1)
	const toggled = <A>(current: A | null, next: A): A | null => (current === next ? null : next)
	const apply = <A>(schema: Schema.Codec<A>, set: (next: A) => Filters): Filters =>
		Option.match(Schema.decodeUnknownOption(schema)(value), { onNone: () => filters, onSome: set })
	switch (field) {
		case "assignee":
			return apply(AssigneeFilter, (assignee) => ({
				...filters,
				assignee: filters.assignee === assignee ? "anyone" : assignee,
			}))
		case "waitingOnUs":
			return { ...filters, waitingOnUs: !filters.waitingOnUs }
		case "overdue":
			return { ...filters, overdue: !filters.overdue }
		case "status":
			return apply(Customers.IssueStatus, (status) => ({
				...filters,
				status: toggled(filters.status, status),
			}))
		case "priority":
			return apply(Customers.IssuePriority, (priority) => ({
				...filters,
				priority: toggled(filters.priority, priority),
			}))
		case "accountId": {
			const accountId = CustomerAccountId.make(value)
			return { ...filters, accountId: filters.accountId === accountId ? null : accountId }
		}
		default:
			return filters
	}
}

/** The keys the inbox answers to; typing in a field never reaches them. */
export const InboxKey = Schema.Literals([
	"next",
	"previous",
	"assign",
	"assignToMe",
	"status",
	"priority",
	"close",
	"open",
	"openCustomer",
	"deselect",
	"search",
])
export type InboxKey = typeof InboxKey.Type
