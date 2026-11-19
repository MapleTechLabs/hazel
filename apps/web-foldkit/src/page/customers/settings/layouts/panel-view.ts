import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { BUILT_IN_LABEL } from "../../../../customers/overview/built-ins"
import { type MetricDef, metricGroups } from "../../../../customers/overview/rows"
import { BLOCKS } from "../../../../customers/overview/starters"
import { STYLE_LABEL } from "../../../../customers/overview/widgets"
import { segmented } from "../../../../customers/ui/filter-bar"
import { IconArrowDown, IconArrowUp } from "../../../../customers/ui/icons"
import {
	IconChartBar,
	IconCheck,
	IconChevronDown,
	IconClose,
	IconDashboard,
	IconHashtag,
	IconPlus,
	IconTrash,
} from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { ariaButton, button } from "../../../../ui/button"
import { checkbox } from "../../../../ui/checkbox"
import { heading } from "../../../../ui/heading"
import { input } from "../../../../ui/input"
import * as Popover from "../../../../ui/popover"
import { switchControl } from "../../../../ui/switch"
import { Message } from "./message"
import { type Editor, type Model } from "./model"

/**
 * The editor's right panel: the widget library while nothing is selected, else the selected
 * widget's settings, with the metric picker.
 */

type H = HtmlBuilder<Message>
type Widget = Customers.OverviewWidget

const icon = { attributes: { "data-slot": "icon" } }

/** A pressable choice chip: on, tinted; off, quiet. */
export const chipClass = (isOn: boolean): string =>
	isOn ? "border-primary/50 bg-primary-subtle/50 text-fg" : "text-muted-fg"

export const TYPE_LABEL = {
	stat: "Stat",
	chart: "Chart",
	metric_table: "Metric table",
	built_in: "Built-in",
} as const satisfies Record<Widget["_tag"], string>

export const SPAN_LABEL = { 1: "1/4", 2: "1/2", 3: "3/4", 4: "Full width" } as const

const SPANS = [1, 2, 3, 4] as const

/** A width segment's key back to its span. */
export const spanOf = (key: string): Customers.WidgetSpan => SPANS.find((span) => String(span) === key) ?? 4

const eyebrow = (h: H, text: string): Html =>
	heading(h, { variant: "label", className: "px-5 pt-5 pb-2" }, [text])

const field = (h: H, label: string, children: ReadonlyArray<Html>, hint?: string): Html =>
	h.div(
		[h.Class("flex flex-col gap-1.5")],
		[
			h.span([h.Class("font-medium text-fg text-sm")], [label]),
			...children,
			...(hint === undefined ? [] : [h.p([h.Class("text-muted-fg text-xs")], [hint])]),
		],
	)

const edited = (widget: Widget) => Message.EditedWidget({ widget })

const textInput = (
	h: H,
	options: Readonly<{
		label: string
		value: string
		maxLength: number
		placeholder?: string
		onInput: (value: string) => Message
	}>,
): Html =>
	input(h, {
		placeholder: options.placeholder,
		attributes: [
			h.AriaLabel(options.label),
			h.Value(options.value),
			h.Attribute("maxlength", String(options.maxLength)),
			h.OnInput(options.onInput),
		],
	})

/** A number committed on change (blur or Enter); text that is not a number keeps the old value. */
export const numberInput = (
	h: H,
	options: Readonly<{
		label: string
		value: number
		onCommit: (value: number) => Message
		className?: string
	}>,
): Html =>
	input(h, {
		attributes: [
			h.AriaLabel(options.label),
			h.InputMode("decimal"),
			h.Value(String(options.value)),
			h.OnChange((text) => {
				const value = Number(text.trim())
				return options.onCommit(text.trim() === "" || !Number.isFinite(value) ? options.value : value)
			}),
			...(options.className === undefined ? [] : [h.Class(options.className)]),
		],
	})

const spanPicker = (h: H, widget: Widget): Html =>
	segmented(h, {
		ariaLabel: "Width",
		segments: ([1, 2, 3, 4] as const).map((span) => ({ key: String(span), label: SPAN_LABEL[span] })),
		selected: String(widget.span),
		onSelect: (span) => edited({ ...widget, span: spanOf(span) }),
		className: "w-full *:flex-1 *:justify-center",
	})

const WINDOWS = [7, 30, 90] as const

const windowPicker = (h: H, widget: Customers.StatWidget | Customers.MetricTableWidget): Html =>
	segmented(h, {
		ariaLabel: "Window",
		segments: [
			...WINDOWS.map((days) => ({ key: String(days), label: `${days}d` })),
			...(WINDOWS.some((days) => days === widget.windowDays)
				? []
				: [{ key: String(widget.windowDays), label: `${widget.windowDays}d` }]),
		],
		selected: String(widget.windowDays),
		onSelect: (days) => edited({ ...widget, windowDays: Number(days) }),
		className: "w-full *:flex-1 *:justify-center",
	})

const nameOf = (model: Model, key: string) => model.metrics?.find((metric) => metric.key === key)?.name ?? key

/** What a widget is called: its title, its metric, or its section. */
export const widgetTitle = (model: Model, widget: Widget): string =>
	widget._tag === "stat"
		? nameOf(model, widget.metricKey)
		: widget._tag === "built_in"
			? BUILT_IN_LABEL[widget.kind]
			: widget.title === ""
				? "Untitled"
				: widget.title

// THE METRIC PICKER

/** Metrics by group (none last), filtered by the search. */
const pickerGroups = (
	model: Model,
	search: string,
): ReadonlyArray<readonly [string, ReadonlyArray<MetricDef>]> => {
	const query = search.trim().toLowerCase()
	const shown = (model.metrics ?? []).filter(
		(metric) => query === "" || metric.name.toLowerCase().includes(query) || metric.key.includes(query),
	)
	const groups = new Map<string, Array<MetricDef>>()
	for (const metric of shown) {
		const group = metric.group ?? (metric.builtIn ? "Built in" : "Other")
		groups.set(group, [...(groups.get(group) ?? []), metric])
	}
	return [...groups.entries()]
}

export const metricPicker = (
	h: H,
	model: Model,
	editor: Editor,
	options: Readonly<{
		orgSlug: string
		selected: ReadonlyArray<string>
		trigger: (attributes: Parameters<Popover.ViewInputs["toTrigger"]>[0]) => Html
	}>,
): Html =>
	h.submodel({
		slotId: model.pickerPopover.id,
		model: model.pickerPopover,
		view: Popover.view,
		viewInputs: {
			placement: "bottom end",
			toTrigger: options.trigger,
			toContent: () => {
				const groups = pickerGroups(model, editor.pickerSearch)
				return [
					h.div(
						[h.Class("flex w-80 flex-col")],
						[
							h.div(
								[h.Class("border-border border-b p-2")],
								[
									input(h, {
										placeholder: "Search metrics",
										attributes: [
											h.AriaLabel("Search metrics"),
											h.Value(editor.pickerSearch),
											h.OnInput((value) => Message.ChangedPickerSearch({ value })),
										],
									}),
								],
							),
							h.div(
								[h.Class("flex max-h-80 flex-col gap-0.5 overflow-y-auto p-1")],
								groups.length === 0
									? [
											h.p(
												[h.Class("px-2 py-4 text-center text-muted-fg text-sm")],
												["No metric matches."],
											),
										]
									: groups.flatMap(([group, metrics]) => [
											h.span(
												[
													h.Key(`group-${group}`),
													h.Class(
														"px-2 pt-2 pb-1 font-medium text-muted-fg text-xs",
													),
												],
												[group],
											),
											...metrics.map((metric) => {
												const isSelected = options.selected.includes(metric.key)
												return ariaButton(
													h,
													{
														onPress: Message.PickedMetric({
															metricKey: metric.key,
														}),
														className:
															"flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-hidden hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
														attributes: [
															h.Key(metric.key),
															h.AriaPressed(isSelected ? "true" : "false"),
														],
													},
													[
														h.span(
															[h.Class("flex min-w-0 flex-1 flex-col")],
															[
																h.span(
																	[h.Class("truncate text-fg text-sm")],
																	[metric.name],
																),
																h.code(
																	[
																		h.Class(
																			"truncate text-muted-fg text-xs",
																		),
																	],
																	[metric.key],
																),
															],
														),
														...(isSelected
															? [
																	IconCheck(h, {
																		className:
																			"size-4 shrink-0 text-primary",
																	}),
																]
															: []),
													],
												)
											}),
										]),
							),
							h.a(
								[
									h.Href(
										hrefOf(
											AppRoute.CustomersSettingsMetricNew({
												orgSlug: options.orgSlug,
												key: Option.none(),
												source: Option.some("maple_query"),
											}),
										),
									),
									h.Class(
										"flex items-center gap-1.5 border-border border-t px-3 py-2.5 font-medium text-primary text-sm hover:underline",
									),
								],
								[IconPlus(h, { className: "size-3.5" }), "New metric from a Maple query"],
							),
						],
					),
				]
			},
		},
		toParentMessage: (message: Popover.Message) => Message.GotPickerPopoverMessage({ message }),
	})

// SETTINGS PER WIDGET

const statSettings = (
	h: H,
	model: Model,
	editor: Editor,
	orgSlug: string,
	widget: Customers.StatWidget,
): ReadonlyArray<Html> => [
	field(h, "Metric", [
		metricPicker(h, model, editor, {
			orgSlug,
			selected: [widget.metricKey],
			trigger: (attributes) =>
				button(
					h,
					{ intent: "outline", size: "sm", attributes, className: "w-full justify-between" },
					[
						h.span([h.Class("truncate")], [nameOf(model, widget.metricKey)]),
						IconChevronDown(h, { className: "size-3" }),
					],
				),
		}),
	]),
	field(
		h,
		"Label",
		[
			textInput(h, {
				label: "Label",
				value: widget.label ?? "",
				maxLength: 120,
				placeholder: "{metric} · {window}",
				onInput: (value) => edited({ ...widget, label: value.trim() === "" ? null : value }),
			}),
		],
		"{window} reads 30d, {metric} the metric's name.",
	),
	field(h, "Window", [windowPicker(h, widget)]),
	field(h, "Compare", [
		segmented(h, {
			ariaLabel: "Compare",
			segments: [
				{ key: "previous", label: "With the window before" },
				{ key: "none", label: "No" },
			],
			selected: widget.compare,
			onSelect: (compare) => edited({ ...widget, compare }),
			className: "w-full *:flex-1 *:justify-center",
		}),
	]),
	field(h, "Good when it goes", [
		segmented(h, {
			ariaLabel: "Good direction",
			segments: [
				{ key: "up", label: "Up" },
				{ key: "down", label: "Down" },
				{ key: "neutral", label: "Either way" },
			],
			selected: widget.goodDirection,
			onSelect: (goodDirection) => edited({ ...widget, goodDirection }),
			className: "w-full *:flex-1 *:justify-center",
		}),
	]),
	field(h, "Width", [spanPicker(h, widget)]),
	switchControl(
		h,
		{
			id: `layout-hide-${widget.id}`,
			isSelected: widget.hideWhenEmpty,
			onChange: (hideWhenEmpty) => edited({ ...widget, hideWhenEmpty }),
		},
		"Hide for a customer with no data",
	),
]

const chartSettings = (
	h: H,
	model: Model,
	editor: Editor,
	orgSlug: string,
	widget: Customers.ChartWidget,
): ReadonlyArray<Html> => {
	const keys = widget.metricKeys
	const reordered = (index: number, step: -1 | 1) => {
		const next = [...keys]
		const target = index + step
		;[next[index], next[target]] = [next[target] ?? "", next[index] ?? ""]
		return edited({ ...widget, metricKeys: next })
	}
	return [
		field(h, "Title", [
			textInput(h, {
				label: "Title",
				value: widget.title,
				maxLength: 120,
				onInput: (title) => edited({ ...widget, title }),
			}),
		]),
		field(h, "Metrics", [
			h.div(
				[h.Class("flex flex-col divide-y divide-border rounded-lg border border-border")],
				[
					...keys.map((key, index) =>
						h.div(
							[h.Key(key), h.Class("flex items-center gap-1 py-1.5 pr-1 pl-3")],
							[
								h.span(
									[h.Class("flex min-w-0 flex-1 flex-col")],
									[
										h.span([h.Class("truncate text-fg text-sm")], [nameOf(model, key)]),
										h.code([h.Class("truncate text-muted-fg text-xs")], [key]),
									],
								),
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										isDisabled: index === 0,
										onPress: index === 0 ? undefined : reordered(index, -1),
										attributes: [h.AriaLabel(`Move ${nameOf(model, key)} up`)],
										className: "px-1",
									},
									[IconArrowUp(h, { className: "size-3.5" })],
								),
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										isDisabled: index === keys.length - 1,
										onPress: index === keys.length - 1 ? undefined : reordered(index, 1),
										attributes: [h.AriaLabel(`Move ${nameOf(model, key)} down`)],
										className: "px-1",
									},
									[IconArrowDown(h, { className: "size-3.5" })],
								),
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										// A chart keeps at least one metric (the message would not be valid without).
										isDisabled: keys.length === 1,
										onPress:
											keys.length === 1
												? undefined
												: edited({
														...widget,
														metricKeys: keys.filter((each) => each !== key),
													}),
										attributes: [h.AriaLabel(`Remove ${nameOf(model, key)}`)],
										className: "px-1",
									},
									[IconClose(h, { className: "size-3.5" })],
								),
							],
						),
					),
					...(keys.length >= 6
						? []
						: [
								metricPicker(h, model, editor, {
									orgSlug,
									selected: keys,
									trigger: (attributes) =>
										button(
											h,
											{
												intent: "plain",
												size: "sm",
												attributes,
												className: "justify-start rounded-t-none text-primary",
											},
											[IconPlus(h, icon), "Add metric"],
										),
								}),
							]),
				],
			),
		]),
		field(h, "Style", [
			segmented(h, {
				ariaLabel: "Style",
				segments: (["bars", "stacked", "line"] as const).map((style) => ({
					key: style,
					label: STYLE_LABEL[style],
				})),
				selected: widget.style,
				onSelect: (style) => edited({ ...widget, style }),
				className: "w-full *:flex-1 *:justify-center",
			}),
		]),
		field(
			h,
			"Opens at",
			[
				segmented(h, {
					ariaLabel: "Opening range",
					segments: (["7d", "30d", "90d"] as const).map((range) => ({ key: range, label: range })),
					selected: widget.range,
					onSelect: (range) => edited({ ...widget, range }),
					className: "w-full *:flex-1 *:justify-center",
				}),
			],
			"Viewers can change the range.",
		),
		field(h, "Width", [spanPicker(h, widget)]),
	]
}

const tableSettings = (
	h: H,
	model: Model,
	editor: Editor,
	orgSlug: string,
	widget: Customers.MetricTableWidget,
): ReadonlyArray<Html> => {
	const groups = metricGroups(model.metrics)
	const { rows } = widget
	const groupMetrics =
		rows._tag === "group" ? (model.metrics ?? []).filter((metric) => metric.group === rows.group) : []
	const firstKey = model.metrics?.[0]?.key ?? "active_users"
	return [
		field(h, "Title", [
			textInput(h, {
				label: "Title",
				value: widget.title,
				maxLength: 120,
				onInput: (title) => edited({ ...widget, title }),
			}),
		]),
		field(
			h,
			"Rows",
			[
				segmented(h, {
					ariaLabel: "Rows",
					segments: [
						{ key: "group", label: "A metric group" },
						{ key: "metrics", label: "Pick metrics" },
					],
					selected: rows._tag,
					// Switching keeps what the table showed: a group's rows (less the left out) become the picks.
					onSelect: (kind) => {
						const picked = groupMetrics
							.map((metric) => metric.key)
							.filter((key) => !widget.exclude.includes(key))
							.slice(0, 30)
						return edited({
							...widget,
							exclude: [],
							rows:
								kind === "group"
									? { _tag: "group", group: groups[0] ?? "Feature usage" }
									: {
											_tag: "metrics",
											metricKeys: picked.length === 0 ? [firstKey] : picked,
										},
						})
					},
					className: "w-full *:flex-1 *:justify-center",
				}),
				rows._tag === "group"
					? h.div(
							[h.Class("flex flex-wrap gap-1.5")],
							(groups.includes(rows.group) ? groups : [rows.group, ...groups]).map((group) =>
								button(
									h,
									{
										intent: "outline",
										className: chipClass(group === rows.group),
										size: "xs",
										onPress: edited({
											...widget,
											rows: { _tag: "group", group },
											exclude: [],
										}),
										attributes: [h.AriaPressed(group === rows.group ? "true" : "false")],
									},
									[group],
								),
							),
						)
					: metricPicker(h, model, editor, {
							orgSlug,
							selected: rows.metricKeys,
							trigger: (attributes) =>
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										attributes,
										className: "w-full justify-between",
									},
									[
										`${rows.metricKeys.length} ${rows.metricKeys.length === 1 ? "metric" : "metrics"}`,
										IconChevronDown(h, { className: "size-3" }),
									],
								),
						}),
			],
			rows._tag === "group" ? "Metrics added to the group later show up here on their own." : undefined,
		),
		field(h, "Window", [windowPicker(h, widget)]),
		field(
			h,
			"Counts as used at",
			[
				numberInput(h, {
					label: "Counts as used at",
					value: widget.usedAtLeast,
					onCommit: (usedAtLeast) => edited({ ...widget, usedAtLeast }),
				}),
			],
			"A metric with at least this much in the window counts as used.",
		),
		field(h, "Metrics not used", [
			segmented(h, {
				ariaLabel: "Metrics not used",
				segments: [
					{ key: "show", label: "Show last" },
					{ key: "hide", label: "Hide" },
				],
				selected: widget.unused,
				onSelect: (unused) => edited({ ...widget, unused }),
				className: "w-full *:flex-1 *:justify-center",
			}),
		]),
		field(h, "Order", [
			segmented(h, {
				ariaLabel: "Order",
				segments: [
					{ key: "value", label: "Most used" },
					{ key: "name", label: "Name" },
					{ key: "last_used", label: "Last used" },
				],
				selected: widget.order,
				onSelect: (order) => edited({ ...widget, order }),
				className: "w-full *:flex-1 *:justify-center",
			}),
		]),
		field(h, "Columns", [
			checkbox(
				h,
				{
					id: `layout-trend-${widget.id}`,
					isSelected: widget.columns.trend,
					onChange: (trend) => edited({ ...widget, columns: { ...widget.columns, trend } }),
				},
				"Change vs the window before",
			),
			checkbox(
				h,
				{
					id: `layout-last-used-${widget.id}`,
					isSelected: widget.columns.lastUsed,
					onChange: (lastUsed) => edited({ ...widget, columns: { ...widget.columns, lastUsed } }),
				},
				"Last used",
			),
		]),
		...(rows._tag === "group" && groupMetrics.length > 0
			? [
					field(
						h,
						"Leave out",
						[
							h.div(
								[h.Class("flex flex-wrap gap-1.5")],
								groupMetrics.map((metric) => {
									const isLeftOut = widget.exclude.includes(metric.key)
									return button(
										h,
										{
											intent: "outline",
											className: isLeftOut ? "text-muted-fg line-through" : undefined,
											size: "xs",
											onPress: edited({
												...widget,
												exclude: isLeftOut
													? widget.exclude.filter((key) => key !== metric.key)
													: [...widget.exclude, metric.key],
											}),
											attributes: [h.AriaPressed(isLeftOut ? "true" : "false")],
										},
										[metric.name],
									)
								}),
							),
						],
						"Pressed metrics of the group stay out of this table.",
					),
				]
			: []),
		field(h, "Width", [spanPicker(h, widget)]),
	]
}

const builtInSettings = (h: H, widget: Customers.BuiltInWidget): ReadonlyArray<Html> => [
	field(h, "Section", [
		h.div(
			[h.Class("flex flex-wrap gap-1.5")],
			Customers.BuiltInWidgetKind.literals.map((kind) =>
				button(
					h,
					{
						intent: "outline",
						className: chipClass(kind === widget.kind),
						size: "xs",
						onPress: edited({ ...widget, kind }),
						attributes: [h.AriaPressed(kind === widget.kind ? "true" : "false")],
					},
					[BUILT_IN_LABEL[kind]],
				),
			),
		),
	]),
	field(h, "Width", [spanPicker(h, widget)]),
]

const settingsPanel = (
	h: H,
	model: Model,
	editor: Editor,
	orgSlug: string,
	widget: Widget,
): ReadonlyArray<Html> => [
	h.div(
		[h.Class("flex items-start justify-between gap-2 border-border border-b px-5 py-4")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					heading(h, { variant: "label", level: 2 }, [`${TYPE_LABEL[widget._tag]} widget`]),
					h.span([h.Class("truncate font-semibold text-fg text-sm")], [widgetTitle(model, widget)]),
				],
			),
			button(
				h,
				{
					intent: "plain",
					size: "xs",
					onPress: Message.ClearedSelection(),
					attributes: [h.AriaLabel("Close settings")],
					className: "px-1.5",
				},
				[IconClose(h, icon)],
			),
		],
	),
	h.div(
		[h.Class("flex flex-1 flex-col gap-5 px-5 py-5")],
		widget._tag === "stat"
			? statSettings(h, model, editor, orgSlug, widget)
			: widget._tag === "chart"
				? chartSettings(h, model, editor, orgSlug, widget)
				: widget._tag === "metric_table"
					? tableSettings(h, model, editor, orgSlug, widget)
					: builtInSettings(h, widget),
	),
	h.div(
		[h.Class("border-border border-t px-5 py-3")],
		[
			button(
				h,
				{
					intent: "plain",
					size: "sm",
					onPress: Message.PressedRemoveWidget(),
					className: "text-danger-subtle-fg",
				},
				[IconTrash(h, icon), "Remove widget"],
			),
		],
	),
]

// THE LIBRARY

const libraryRow = (
	h: H,
	options: Readonly<{ glyph?: Html; title: string; description?: string; onPress: Message }>,
): Html =>
	h.div(
		[h.Class("flex items-center gap-3 rounded-lg border border-border px-3 py-2.5")],
		[
			...(options.glyph === undefined
				? []
				: [
						h.span(
							[
								h.AriaHidden(true),
								h.Class(
									"inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-fg-2",
								),
							],
							[options.glyph],
						),
					]),
			h.span(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span([h.Class("font-medium text-fg text-sm")], [options.title]),
					...(options.description === undefined
						? []
						: [h.span([h.Class("text-muted-fg text-xs")], [options.description])]),
				],
			),
			button(
				h,
				{
					intent: "plain",
					size: "xs",
					onPress: options.onPress,
					attributes: [h.AriaLabel(`Add ${options.title}`)],
					className: "text-primary",
				},
				["Add"],
			),
		],
	)

const library = (h: H): ReadonlyArray<Html> => [
	h.div(
		[h.Class("border-border border-b px-5 py-4")],
		[heading(h, { variant: "subsection", level: 2 }, ["Add widgets"])],
	),
	eyebrow(h, "Widget types"),
	h.div(
		[h.Class("flex flex-col gap-2 px-5")],
		[
			libraryRow(h, {
				glyph: IconHashtag(h, { className: "size-4" }),
				title: "Stat",
				description: "One metric as a number, with its change",
				onPress: Message.PressedAddWidget({ kind: "stat" }),
			}),
			libraryRow(h, {
				glyph: IconChartBar(h, { className: "size-4" }),
				title: "Chart",
				description: "Metrics over time: bars, stacked or a line",
				onPress: Message.PressedAddWidget({ kind: "chart" }),
			}),
			libraryRow(h, {
				glyph: IconDashboard(h, { className: "size-4" }),
				title: "Metric table",
				description: "Several metrics, one row each, last used",
				onPress: Message.PressedAddWidget({ kind: "metric_table" }),
			}),
		],
	),
	eyebrow(h, "Blocks"),
	h.div(
		[h.Class("flex flex-col gap-2 px-5")],
		BLOCKS.map((block) =>
			libraryRow(h, {
				title: block.name,
				description: block.description,
				onPress: Message.PressedAddBlock({ key: block.key }),
			}),
		),
	),
	eyebrow(h, "Built-in"),
	h.div(
		[h.Class("flex flex-col gap-2 px-5 pb-5")],
		Customers.BuiltInWidgetKind.literals.map((kind) =>
			libraryRow(h, { title: BUILT_IN_LABEL[kind], onPress: Message.PressedAddBuiltIn({ kind }) }),
		),
	),
]

export const panel = (
	h: H,
	model: Model,
	editor: Editor,
	orgSlug: string,
	widget: Widget | undefined,
): Html =>
	h.aside(
		[
			h.AriaLabel(widget === undefined ? "Add widgets" : "Widget settings"),
			h.Class(
				twMerge(
					"flex shrink-0 flex-col border-border bg-bg max-lg:w-full max-lg:border-t lg:w-80 lg:overflow-y-auto lg:border-l",
				),
			),
		],
		widget === undefined ? library(h) : settingsPanel(h, model, editor, orgSlug, widget),
	)
