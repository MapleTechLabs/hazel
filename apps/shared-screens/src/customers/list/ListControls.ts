// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customers list's controls (today's `controls` in `page/customers/list/view.ts`): search, a
 * chip per active filter, `+ Filter` and its builder, the count, the sort menu and the column
 * picker. Controlled: filters, sort, columns and search come in as props; it keeps only what the
 * page never stores (the popovers, the builder's pending filters, the fields' typing) and emits
 * what the user asked for.
 */
import { UiSchema } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import { UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { formatCount } from "../data/format"
import { AccountRow, MemberRow } from "../data/queries"
import { addFilterButton, filterBar, filterChip, searchBox, sortTrigger } from "../ui/filter-bar"
import { columnPicker } from "./column-picker"
import { moveColumn, parseSortKey, sortLabel, sortMenuGroups, toggleColumn } from "./columns"
import { daysFrom, fieldsFor, filterBuilder, isInactiveWindow, minorOf, withWindow } from "./filter-builder"
import { activeFields, Builder, chipOf, FilterField, type Viewer, withFilter } from "./filters"

export const ListControlsProps = Schema.Struct({
	/** Every synced account: the builder's options and its preview count. */
	accounts: Schema.Array(AccountRow),
	members: Schema.Array(MemberRow),
	filters: Customers.ViewFilters,
	search: Schema.String,
	sort: Customers.ViewSort,
	columns: Schema.Array(Customers.ListColumn),
	/** The rows the list shows now. */
	count: Schema.Int,
	/** The org's reporting currency: MRR filters are in it. */
	currency: Schema.String,
	userId: Schema.NullOr(UserId),
	nowMs: Schema.Finite,
	/** The phone layout: the builder stacks its fields above the editor. */
	compact: Schema.Boolean,
})
export type ListControlsProps = typeof ListControlsProps.Type

const Fields = Schema.Struct({ min: TextField.State, max: TextField.State, days: TextField.State })

export const ListControlsModel = Schema.Struct({
	/** The search box's typing; the page owns its text (`search`). */
	searchField: TextField.State,
	filterOpen: Schema.Boolean,
	builder: Schema.NullOr(Builder),
	fields: Fields,
	columnsOpen: Schema.Boolean,
})
export type ListControlsModel = typeof ListControlsModel.Type

const Step = Schema.Literals([-1, 1])

export const ListControlsMessage = UiSchema.TaggedEnum({
	ChangedSearch: { payload: TextField.ChangePayload },
	PressedAddFilter: {},
	PressedChip: { field: FilterField },
	RemovedChip: { field: FilterField },
	DismissedFilter: {},
	PickedField: { field: FilterField },
	ChangedPending: { filters: Customers.ViewFilters },
	ChangedMin: { payload: TextField.ChangePayload },
	ChangedMax: { payload: TextField.ChangePayload },
	ChangedDays: { payload: TextField.ChangePayload },
	PickedPreset: { days: Schema.Int },
	PressedApply: {},
	PickedSort: { id: Schema.String },
	PressedColumns: {},
	DismissedColumns: {},
	ToggledColumn: { column: Customers.ListColumn, shown: Schema.Boolean },
	MovedColumn: { column: Customers.ListColumn, step: Step },
	PressedResetColumns: {},
})
export type ListControlsMessage = typeof ListControlsMessage.Type

/** What the page applies: its draft and search change only through these. */
export const ListControlsEvents = UiSchema.TaggedEnum({
	ChangedSearch: { value: Schema.String },
	ClearedFilter: { field: FilterField },
	AppliedFilters: { filters: Customers.ViewFilters },
	ChangedSort: { sort: Customers.ViewSort },
	ChangedColumns: { columns: Schema.Array(Customers.ListColumn) },
	/** Back to the current view's own columns. */
	ResetColumns: {},
})
export type ListControlsEvents = typeof ListControlsEvents.Type

const viewerOf = (props: ListControlsProps): Viewer => ({
	userId: props.userId,
	nowMs: props.nowMs,
	isAdmin: false,
})

/** The search box against the page's text: a clear from outside replaces what is typed. */
const searchFieldOf = (model: ListControlsModel, search: string): TextField.State =>
	model.searchField.text === search ? model.searchField : TextField.set(model.searchField, search)

const emptyFields = { min: TextField.empty, max: TextField.empty, days: TextField.empty }

/** The builder opened on `field` over the applied filters. */
const opened = (
	model: ListControlsModel,
	props: ListControlsProps,
	field: FilterField,
): ListControlsModel => ({
	...model,
	filterOpen: true,
	columnsOpen: false,
	builder: { field, pending: props.filters },
	fields: fieldsFor(props.filters, props.currency, model.fields),
})

const ListControlsDef = Hazel.component({
	name: "CustomersListControls",
	props: ListControlsProps,
	model: ListControlsModel,
	message: ListControlsMessage,
	events: ListControlsEvents,
	restore: false,
})

const anyUpdate = ListControlsDef.update(($) => $.model)
type Step$ = Parameters<typeof anyUpdate>[0]

/** A pending edit; the number fields follow when it changed what they show. */
const withPending = ($: Step$, filters: Customers.ViewFilters) =>
	$.evolve({
		builder: (builder) => (builder === null ? builder : { ...builder, pending: filters }),
		fields: (fields) => fieldsFor(filters, $.props.currency, fields),
	})

/** A number field's typing: the field takes it, the pending filters take its value. */
const typed = (
	$: Step$,
	key: "min" | "max" | "days",
	payload: TextField.ChangePayload,
	apply: (pending: Customers.ViewFilters, raw: string) => Customers.ViewFilters,
) =>
	$.evolve({
		fields: (fields) => ({ ...fields, [key]: TextField.changed(fields[key], payload) }),
		builder: (builder) =>
			builder === null ? builder : { ...builder, pending: apply(builder.pending, payload.value) },
	})

export const ListControls = ListControlsDef.make({
	init: () => ({
		searchField: TextField.empty,
		filterOpen: false,
		builder: null,
		fields: emptyFields,
		columnsOpen: false,
	}),
	update: {
		ChangedSearch: ($, { payload }) => {
			const field = searchFieldOf($.model, $.props.search)
			if (!TextField.current(field, payload)) return $.evolve({ searchField: () => field })
			return $.evolve({ searchField: () => TextField.changed(field, payload) }).emit(
				ListControlsEvents.ChangedSearch({ value: payload.value }),
			)
		},
		PressedAddFilter: ($) =>
			$.model.filterOpen
				? $.evolve({ filterOpen: () => false })
				: opened($.model, $.props, activeFields($.props.filters)[0] ?? "stage"),
		PressedChip: ($, { field }) => opened($.model, $.props, field),
		RemovedChip: ($, { field }) => $.emit(ListControlsEvents.ClearedFilter({ field })),
		DismissedFilter: ($) => $.evolve({ filterOpen: () => false }),
		PickedField: ($, { field }) =>
			$.evolve({ builder: (builder) => (builder === null ? builder : { ...builder, field }) }),
		ChangedPending: ($, { filters }) => withPending($, filters),
		ChangedMin: ($, { payload }) =>
			typed($, "min", payload, (pending, raw) =>
				withFilter(pending, "minMrrMinor", minorOf(raw, $.props.currency)),
			),
		ChangedMax: ($, { payload }) =>
			typed($, "max", payload, (pending, raw) =>
				withFilter(pending, "maxMrrMinor", minorOf(raw, $.props.currency)),
			),
		ChangedDays: ($, { payload }) =>
			typed($, "days", payload, (pending, raw) =>
				withWindow(pending, isInactiveWindow(pending), daysFrom(raw)),
			),
		PickedPreset: ($, { days }) => {
			const builder = $.model.builder
			return builder === null
				? $.model
				: withPending($, withWindow(builder.pending, isInactiveWindow(builder.pending), days))
		},
		PressedApply: ($) => {
			const builder = $.model.builder
			return builder === null
				? $.evolve({ filterOpen: () => false })
				: $.evolve({ filterOpen: () => false }).emit(
						ListControlsEvents.AppliedFilters({ filters: builder.pending }),
					)
		},
		PickedSort: ($, { id }) => {
			const sort = parseSortKey(id)
			return sort === null ? $.model : $.emit(ListControlsEvents.ChangedSort({ sort }))
		},
		PressedColumns: ($) => $.evolve({ columnsOpen: (open) => !open, filterOpen: () => false }),
		DismissedColumns: ($) => $.evolve({ columnsOpen: () => false }),
		ToggledColumn: ($, { column, shown }) =>
			$.emit(
				ListControlsEvents.ChangedColumns({ columns: toggleColumn($.props.columns, column, shown) }),
			),
		MovedColumn: ($, { column, step }) =>
			$.emit(ListControlsEvents.ChangedColumns({ columns: moveColumn($.props.columns, column, step) })),
		PressedResetColumns: ($) => $.emit(ListControlsEvents.ResetColumns()),
	},
	view: (h, model) => {
		const props = h.props
		const M = ListControlsMessage
		const viewer = viewerOf(props)
		const builder = model.builder
		const chips = activeFields(props.filters).flatMap((field) => {
			const chip = chipOf(field, props.filters, props.members, props.currency)
			return chip === null
				? []
				: [
						filterChip(h, {
							...chip,
							onPress: M.PressedChip({ field }),
							onRemove: M.RemovedChip({ field }),
						}).key(`chip-${field}`),
					]
		})
		// The builder opens from `+ Filter`; a chip's press opens it there on that chip's field.
		const filterPopover = h.popover
			.key("filter")
			.open(model.filterOpen && builder !== null)
			.anchor(addFilterButton(h, { onPress: M.PressedAddFilter() }))
			.on("dismiss", M.DismissedFilter())
			.children(
				builder === null
					? null
					: filterBuilder(h, {
							builder,
							fields: model.fields,
							accounts: props.accounts,
							members: props.members,
							search: props.search,
							currency: props.currency,
							viewer,
							compact: props.compact,
							onPickField: (field) => M.PickedField({ field }),
							onChange: (filters) => M.ChangedPending({ filters }),
							onChangeMin: (payload) => M.ChangedMin({ payload }),
							onChangeMax: (payload) => M.ChangedMax({ payload }),
							onChangeDays: (payload) => M.ChangedDays({ payload }),
							onPreset: (days) => M.PickedPreset({ days }),
							onApply: M.PressedApply(),
							onCancel: M.DismissedFilter(),
						}),
			)
		const sortMenu = h.menu
			.key("sort")
			.label("Sort")
			.entries(sortMenuGroups(props.sort))
			.trigger(sortTrigger(h, { label: sortLabel(props.sort) }))
			.on("select", ({ id }) => M.PickedSort({ id }))
		const columnsPopover = h.popover
			.key("columns")
			.open(model.columnsOpen)
			.anchor(
				h.button.label("Columns").variant("outline").size("small").on("press", M.PressedColumns()),
			)
			.on("dismiss", M.DismissedColumns())
			.children(
				columnPicker(h, {
					columns: props.columns,
					onToggle: (column, shown) => M.ToggledColumn({ column, shown }),
					onMove: (column, step) => M.MovedColumn({ column, step }),
					onReset: M.PressedResetColumns(),
				}),
			)
		return filterBar(h, {
			start: [
				searchBox(h, {
					value: searchFieldOf(model, props.search),
					placeholder: "Search name or domain…",
					onChange: (payload) => M.ChangedSearch({ payload }),
				}).key("search"),
				...chips,
				filterPopover,
			],
			end: [
				// HAZEL-GAP(pk4a-count-wide-only): today the count hides below the `lg` width (1024px); `regularOnly` hides it on the compact size class only.
				h.stack
					.key("count")
					.regularOnly()
					.children(
						h.text
							.tone("muted")
							.numeric()
							.children(
								`${formatCount(props.count)} ${props.count === 1 ? "customer" : "customers"}`,
							),
					),
				sortMenu,
				columnsPopover,
			],
		})
	},
})
