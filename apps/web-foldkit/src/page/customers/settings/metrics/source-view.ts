import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { type Segment, segmented } from "../../../../customers/ui/filter-bar"
import { SOURCE_LABEL } from "../../../../customers/ui/identity"
import { IconClose, IconPlus } from "../../../../icons"
import type { MetricSourceKind } from "../../../../route"
import { button } from "../../../../ui/button"
import * as Field from "../../../../ui/field"
import { input } from "../../../../ui/input"
import { tabStrip, tabView } from "../../../../ui/tab-strip"
import { textField } from "../../../../ui/text-field"
import { checkFormula, type Editability, type FormErrors, sqlOf } from "./form"
import { Message } from "./message"
import type { FilterForm, MetricForm, MetricRow } from "./model"
import { card, SOURCE_KIND_LABEL, textInput } from "./parts"

/** The editor's Source card: the Maple query builder and SQL, product events, or a formula. */

type H = HtmlBuilder<Message>

export type SourceContext = Readonly<{
	form: MetricForm
	errors: FormErrors
	metric: MetricRow | undefined
	metrics: ReadonlyArray<MetricRow>
	editability: Editability
	isAdmin: boolean
}>

const icon = { attributes: { "data-slot": "icon" } }

const KINDS: ReadonlyArray<MetricSourceKind> = ["maple_query", "product_event", "formula"]

const TABLE_SEGMENTS: ReadonlyArray<Segment<Customers.MapleQueryTable>> = [
	{ key: "metrics_sum", label: "Metrics" },
	{ key: "metrics_gauge", label: "Gauges" },
	{ key: "traces", label: "Traces" },
	{ key: "logs", label: "Logs" },
	{ key: "product_events", label: "Product events" },
]

const VALUE_SEGMENTS: ReadonlyArray<Segment<MetricForm["builder"]["value"]>> = [
	{ key: "sum", label: "Sum of Value" },
	{ key: "count", label: "Count rows" },
	{ key: "uniq", label: "Distinct" },
]

const OP_SEGMENTS: ReadonlyArray<Segment<FilterForm["op"]>> = [
	{ key: "eq", label: "=" },
	{ key: "neq", label: "≠" },
	{ key: "in", label: "in" },
]

const errorText = (h: H, error: string | undefined): ReadonlyArray<Html> =>
	error === undefined ? [] : [h.p([h.Role("alert"), h.Class("text-danger-subtle-fg text-xs")], [error])]

/** A builder row: its label on the left, its controls on the right. */
const builderRow = (h: H, label: string, controls: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("grid gap-2 px-3 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-start")],
		[
			h.span([h.Class("pt-1.5 text-muted-fg text-sm")], [label]),
			h.div([h.Class("flex min-w-0 flex-col gap-2")], [...controls]),
		],
	)

const textBox = (
	h: H,
	options: Readonly<{
		label: string
		value: string
		placeholder: string
		onInput: (value: string) => Message
		isDisabled: boolean
		className?: string
	}>,
): Html =>
	h.div(
		[h.Class(twMerge("min-w-0", options.className))],
		[
			input(h, {
				placeholder: options.placeholder,
				isDisabled: options.isDisabled,
				className: "font-mono",
				attributes: [h.AriaLabel(options.label), h.Value(options.value), h.OnInput(options.onInput)],
			}),
		],
	)

const choiceOrText = <K extends string>(
	h: H,
	options: Readonly<{
		label: string
		segments: ReadonlyArray<Segment<K>>
		selected: K
		onSelect: (key: K) => Message
		isDisabled: boolean
	}>,
): Html =>
	options.isDisabled
		? h.span(
				[h.Class("pt-1.5 text-fg text-sm")],
				[
					options.segments.find((segment) => segment.key === options.selected)?.label ??
						options.selected,
				],
			)
		: segmented(h, {
				ariaLabel: options.label,
				segments: options.segments,
				selected: options.selected,
				onSelect: options.onSelect,
				className: "flex-wrap self-start",
			})

const filterRow = (h: H, filter: FilterForm, index: number, isDisabled: boolean): Html => {
	const changed = (change: Partial<FilterForm>) =>
		Message.ChangedFilter({ index, filter: { ...filter, ...change } })
	return h.div(
		[
			h.Key(`filter-${index}`),
			h.Class("grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2"),
		],
		[
			textBox(h, {
				label: `Filter ${index + 1} column`,
				value: filter.field,
				placeholder: "Attributes.signal",
				onInput: (field) => changed({ field }),
				isDisabled,
				className: "w-full",
			}),
			choiceOrText(h, {
				label: `Filter ${index + 1} comparison`,
				segments: OP_SEGMENTS,
				selected: filter.op,
				onSelect: (op) => changed({ op }),
				isDisabled,
			}),
			textBox(h, {
				label: `Filter ${index + 1} value`,
				value: filter.value,
				placeholder: filter.op === "in" ? "logs, traces" : "logs",
				onInput: (value) => changed({ value }),
				isDisabled,
				className: "w-full",
			}),
			...(isDisabled
				? []
				: [
						button(
							h,
							{
								intent: "plain",
								size: "sq-xs",
								onPress: Message.PressedRemoveFilter({ index }),
								attributes: [h.AriaLabel(`Remove filter ${index + 1}`)],
							},
							[IconClose(h, icon)],
						),
					]),
		],
	)
}

const sqlBlock = (h: H, sql: string): Html =>
	h.pre(
		[
			h.AriaLabel("Generated SQL"),
			h.Class(
				"overflow-x-auto rounded-lg border border-border bg-secondary/40 px-3 py-2.5 font-mono text-fg-2 text-xs/5",
			),
		],
		[sql],
	)

const CONTRACT_HELP =
	"One statement run per UTC day: AND in $__orgFilter and $__timeFilter(<time column>), select account (the customer's Clerk organization id) and value, group by account. No ORDER BY, LIMIT or SETTINGS."

const builderView = (h: H, context: SourceContext): ReadonlyArray<Html> => {
	const { builder } = context.form
	const isDisabled = !context.isAdmin
	return [
		h.div(
			[h.Class("flex flex-col divide-y divide-border rounded-lg border border-border")],
			[
				builderRow(h, "From", [
					choiceOrText(h, {
						label: "Table",
						segments: TABLE_SEGMENTS,
						selected: builder.table,
						onSelect: (table) => Message.ClickedTable({ table }),
						isDisabled,
					}),
				]),
				builderRow(h, "Where", [
					...builder.filters.map((filter, index) => filterRow(h, filter, index, isDisabled)),
					...(builder.filters.length === 0
						? [h.span([h.Class("pt-1.5 text-muted-fg text-sm")], ["Every row"])]
						: []),
					...(isDisabled || builder.filters.length >= 10
						? []
						: [
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										className: "self-start",
										onPress: Message.PressedAddFilter(),
									},
									[IconPlus(h, icon), "Add filter"],
								),
							]),
				]),
				builderRow(h, "Value per day", [
					choiceOrText(h, {
						label: "Value per day",
						segments: VALUE_SEGMENTS,
						selected: builder.value,
						onSelect: (value) => Message.ClickedValue({ value }),
						isDisabled,
					}),
					...(builder.value === "uniq"
						? [
								textBox(h, {
									label: "Column to count distinct values of",
									value: builder.valueField,
									placeholder: "TraceId",
									onInput: (value) =>
										Message.ChangedBuilderText({ field: "valueField", value }),
									isDisabled,
									className: "w-full sm:w-64",
								}),
							]
						: []),
				]),
				builderRow(h, "Customer", [
					textBox(h, {
						label: "Customer column",
						value: builder.customerField,
						placeholder: "Attributes.org_id",
						onInput: (value) => Message.ChangedBuilderText({ field: "customerField", value }),
						isDisabled,
						className: "w-full sm:w-64",
					}),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						["The column holding the customer's Clerk organization id."],
					),
				]),
			],
		),
		...errorText(h, context.errors.builder),
		h.div(
			[h.Class("flex items-center justify-between gap-2")],
			[
				Field.label(h, { elementType: "span" }, ["Runs as"]),
				...(isDisabled
					? []
					: [
							button(h, { intent: "plain", size: "xs", onPress: Message.PressedEditSql() }, [
								"Edit SQL",
							]),
						]),
			],
		),
		sqlBlock(h, sqlOf(context.form)),
	]
}

const sqlView = (h: H, context: SourceContext): ReadonlyArray<Html> => [
	textField(
		h,
		{
			id: "metric-sql",
			value: context.form.sql,
			onInput: (value) => Message.ChangedSql({ value }),
			isInvalid: context.errors.sql !== undefined,
			isDisabled: !context.isAdmin,
		},
		(parts) => [
			h.div(
				[h.Class("flex items-center justify-between gap-2")],
				[
					parts.label(["SQL"]),
					...(context.isAdmin
						? [
								button(
									h,
									{ intent: "plain", size: "xs", onPress: Message.PressedUseBuilder() },
									["Use the builder"],
								),
							]
						: []),
				],
			),
			parts.textarea({ className: "min-h-56 font-mono text-xs/5" }),
			parts.description([CONTRACT_HELP]),
			parts.fieldError([context.errors.sql ?? ""]),
		],
	),
]

const eventsView = (h: H, context: SourceContext): ReadonlyArray<Html> => {
	const isDisabled = !context.isAdmin
	return [
		h.p(
			[h.Class("text-muted-fg text-sm")],
			["How often these Maple product events fired per customer and day."],
		),
		h.ul(
			[h.AriaLabel("Event names"), h.Class("flex flex-col gap-2")],
			context.form.events.map((event, index) =>
				h.li(
					[h.Key(`event-${index}`), h.Class("flex items-center gap-2")],
					[
						textBox(h, {
							label: `Event ${index + 1}`,
							value: event,
							placeholder: "dashboard_created",
							onInput: (value) => Message.ChangedEvent({ index, value }),
							isDisabled,
							className: "flex-1",
						}),
						...(isDisabled || context.form.events.length === 1
							? []
							: [
									button(
										h,
										{
											intent: "plain",
											size: "sq-xs",
											onPress: Message.PressedRemoveEvent({ index }),
											attributes: [h.AriaLabel(`Remove event ${index + 1}`)],
										},
										[IconClose(h, icon)],
									),
								]),
					],
				),
			),
		),
		...errorText(h, context.errors.events),
		...(isDisabled || context.form.events.length >= 20
			? []
			: [
					button(
						h,
						{
							intent: "plain",
							size: "xs",
							className: "self-start",
							onPress: Message.PressedAddEvent(),
						},
						[IconPlus(h, icon), "Add event"],
					),
				]),
	]
}

const chip = (h: H, text: string, className?: string): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"inline-flex h-6 items-center rounded-md border border-border px-1.5 text-fg-2 text-xs",
					className,
				),
			),
		],
		[text],
	)

const formulaView = (h: H, context: SourceContext): ReadonlyArray<Html> => {
	const check = checkFormula(context.form.expression, context.metrics, context.form.key)
	const operands = context.metrics.filter(
		(metric) => metric.source?._tag !== "formula" && metric.key !== context.form.key,
	)
	return [
		textInput(h, {
			id: "metric-formula",
			label: "Formula",
			value: context.form.expression,
			onInput: (value) => Message.ChangedExpression({ value }),
			isDisabled: !context.isAdmin,
			placeholder: "{traces_ingested_bytes} / {spans_ingested}",
			isMono: true,
			help: "Metric keys in braces, numbers, + − × ÷ and parentheses. Over a window each metric is combined first, then the formula applies.",
			error: context.errors.expression,
		}),
		...(check.known.length + check.unknown.length === 0
			? []
			: [
					h.div(
						[h.Class("flex flex-wrap items-center gap-1.5")],
						[
							h.span([h.Class("text-muted-fg text-xs")], ["Uses"]),
							...check.known.map((metric) => chip(h, metric.name)),
							...check.unknown.map((key) =>
								chip(
									h,
									`{${key}} unknown`,
									"border-danger/40 bg-danger-subtle text-danger-subtle-fg",
								),
							),
						],
					),
				]),
		...(context.isAdmin && operands.length > 0
			? [
					h.div(
						[h.Class("flex flex-col gap-1.5")],
						[
							h.span([h.Class("text-muted-fg text-xs")], ["Insert a metric"]),
							h.div(
								[h.Class("flex flex-wrap gap-1.5")],
								operands.map((metric) =>
									button(
										h,
										{
											intent: "outline",
											size: "xs",
											onPress: Message.PressedInsertMetric({ key: metric.key }),
											attributes: [h.Key(metric.key), h.Title(`{${metric.key}}`)],
										},
										[IconPlus(h, icon), metric.name],
									),
								),
							),
						],
					),
				]
			: []),
	]
}

/** Who writes a metric Hazel does not define. */
const writtenBy = (metric: MetricRow | undefined): string =>
	metric === undefined
		? ""
		: metric.provider !== null
			? `Written by the ${SOURCE_LABEL[metric.provider]} sync. Only its name, description, group, unit and format change here.`
			: "Computed by Hazel from its own data. Only its name, description, group, unit and format change here."

const kindTabs = (h: H, context: SourceContext): Html =>
	tabStrip(
		h,
		{ tabListClassName: "w-full" },
		KINDS.map((kind) => {
			const isEditable = context.editability === "full" && context.isAdmin
			return tabView(h, {
				id: `metric-source-${kind}`,
				label: SOURCE_KIND_LABEL[kind],
				isSelected: context.editability === "full" && context.form.kind === kind,
				attributes: isEditable
					? [h.OnClick(Message.ClickedSourceKind({ kind }))]
					: [h.AriaDisabled(true), h.DataAttribute("disabled", "true")],
			})
		}),
	)

export const sourceCard = (h: H, context: SourceContext): Html =>
	card(h, { title: "Source", description: "One value per customer per day." }, [
		kindTabs(h, context),
		...(context.editability === "basics"
			? [
					h.p(
						[
							h.Class(
								"rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-muted-fg text-sm",
							),
						],
						[writtenBy(context.metric)],
					),
				]
			: context.form.kind === "maple_query"
				? context.form.isSqlMode
					? sqlView(h, context)
					: builderView(h, context)
				: context.form.kind === "product_event"
					? eventsView(h, context)
					: formulaView(h, context)),
	])
