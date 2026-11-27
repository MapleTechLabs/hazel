/**
 * The list page's holes for the hazel controls and table (`@hazel/shared-screens/customers/list`),
 * which the shell draws as its own children (`root/customers-list.ts`). The page writes what they
 * show on the hole as JSON; they read the accounts and members themselves and answer on the bus.
 * Part of the adapter: it goes when the list page is native (lane PK4b).
 */
import * as Customers from "@hazel/domain/customers"
import type { ListControlsEvents } from "@hazel/shared-screens/customers/list/ListControls"
import type { ListTableEvents } from "@hazel/shared-screens/customers/list/ListTable"
import { Schema } from "effect"

/** The attribute each hole carries the list's state in. */
export const STATE_ATTRIBUTE = "data-hazel-list-state"

export const ListHoleState = Schema.Struct({
	filters: Customers.ViewFilters,
	search: Schema.String,
	sort: Customers.ViewSort,
	columns: Schema.Array(Customers.ListColumn),
	selected: Schema.Array(Schema.String),
	focusedId: Schema.NullOr(Schema.String),
	rowLimit: Schema.Int,
	currency: Schema.String,
	nowMs: Schema.Finite,
	/** The shell's phone layout. */
	isMobile: Schema.Boolean,
	/** The drawn rows' 30 days of active users (the page asks for them). */
	sparklines: Schema.Record(Schema.String, Schema.Array(Schema.Finite)),
})
export type ListHoleState = typeof ListHoleState.Type

export const decodeHoleState = Schema.decodeUnknownOption(Schema.fromJsonString(ListHoleState))

/** The pointer resting on a row's name (the page's hover card), or leaving it. */
export type ListHover = { readonly _tag: "HoveredName"; readonly accountId: string | null }

/** The table cell of a row's name, where the hover card anchors. */
export const nameCellSelector = (accountId: string) =>
	`[data-hazel-hole="customers-list-table"] [data-hz-key="${CSS.escape(accountId)}"] > [data-hz="tableCell"][data-column="name"]`

/** The search box in the controls' hole, which `/` focuses. */
export const SEARCH_SELECTOR = '[data-hazel-hole="customers-list-controls"] [data-hz="searchField"] input'

/** The keyboard row in the table's hole, kept on screen. */
export const CURRENT_ROW_SELECTOR =
	'[data-hazel-hole="customers-list-table"] [data-hz="tableRow"][data-current]'

/** What the holes ask the page for. */
export type ListHoleEvent = ListControlsEvents | ListTableEvents | ListHover

export const encodeHoleState = Schema.encodeSync(Schema.fromJsonString(ListHoleState))
