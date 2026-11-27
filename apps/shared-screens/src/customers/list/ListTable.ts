// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customers list's table as a child: `listTable` over its props, its presses as events. For a
 * parent that draws the table as its own child rather than in its view (today's list page's hole).
 */
import { UiSchema } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { ListTableData, listTable } from "./table"

export const ListTableEvents = UiSchema.TaggedEnum({
	ClickedSortHeader: { column: Customers.ListColumn },
	ToggledRow: { accountId: CustomerAccountId, selected: Schema.Boolean },
	ToggledAllRows: { selected: Schema.Boolean },
	PressedRow: { accountId: CustomerAccountId },
	PressedShowMore: {},
})
export type ListTableEvents = typeof ListTableEvents.Type

const ListTableMessage = UiSchema.TaggedEnum({ Asked: { event: ListTableEvents } })

export const ListTable = Hazel.component({
	name: "CustomersListTable",
	props: ListTableData,
	model: Schema.Struct({}),
	message: ListTableMessage,
	events: ListTableEvents,
	restore: false,
}).make({
	init: () => ({}),
	update: { Asked: ($, { event }) => $.emit(event) },
	view: (h) => {
		const ask = (event: ListTableEvents) => ListTableMessage.Asked({ event })
		return listTable(h, {
			...h.props,
			onSort: (column) => ask(ListTableEvents.ClickedSortHeader({ column })),
			onToggleRow: (accountId, selected) => ask(ListTableEvents.ToggledRow({ accountId, selected })),
			onToggleAll: (selected) => ask(ListTableEvents.ToggledAllRows({ selected })),
			onPressRow: (accountId) => ask(ListTableEvents.PressedRow({ accountId })),
			onShowMore: ask(ListTableEvents.PressedShowMore()),
		})
	},
})
