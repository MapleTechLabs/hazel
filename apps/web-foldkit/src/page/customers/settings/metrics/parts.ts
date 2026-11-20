import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { type Segment, segmented } from "../../../../customers/ui/filter-bar"
import { SOURCE_LABEL } from "../../../../customers/ui/identity"
import type { MetricSourceKind } from "../../../../route"
import * as Field from "../../../../ui/field"
import { heading } from "../../../../ui/heading"
import { textField } from "../../../../ui/text-field"
import type { Message } from "./message"
import type { MetricRow } from "./model"

/** View pieces the catalog and the editor share. */

type H = HtmlBuilder<Message>

export const SOURCE_KIND_LABEL = {
	maple_query: "Maple query",
	product_event: "Product event",
	formula: "Formula",
} as const satisfies Record<MetricSourceKind, string>

export const FORMAT_SEGMENTS: ReadonlyArray<Segment<Customers.MetricFormat>> = [
	{ key: "number", label: "Number" },
	{ key: "bytes", label: "Bytes" },
	{ key: "percent", label: "Percent" },
	{ key: "money", label: "Money" },
	{ key: "duration_ms", label: "Duration" },
]

/** Where a metric's values come from, in a word or two. */
export const sourceLabelOf = (metric: MetricRow): string =>
	metric.source !== null
		? SOURCE_KIND_LABEL[metric.source._tag]
		: metric.builtIn
			? metric.provider === null
				? "Built-in"
				: `Built-in · ${SOURCE_LABEL[metric.provider]}`
			: metric.provider === null
				? "—"
				: SOURCE_LABEL[metric.provider]

/** How a value reads: the unit for plain numbers, else the format. */
export const formatLabelOf = (metric: Pick<MetricRow, "format" | "unit">): string =>
	metric.format === "number"
		? (metric.unit ?? "Number")
		: (FORMAT_SEGMENTS.find((segment) => segment.key === metric.format)?.label ?? metric.format)

export const card = (
	h: H,
	options: Readonly<{ title: string; description?: string; aside?: Html; className?: string }>,
	children: ReadonlyArray<Html>,
): Html =>
	h.section(
		[
			h.Class(
				twMerge(
					"flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5",
					options.className,
				),
			),
		],
		[
			h.header(
				[h.Class("flex flex-wrap items-start justify-between gap-3")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-col gap-0.5")],
						[
							heading(h, { variant: "section" }, [options.title]),
							...(options.description === undefined
								? []
								: [h.p([h.Class("text-muted-fg text-xs")], [options.description])]),
						],
					),
					...(options.aside === undefined ? [] : [options.aside]),
				],
			),
			...children,
		],
	)

/** A labelled text input with its help line and error. */
export const textInput = (
	h: H,
	options: Readonly<{
		id: string
		label: string
		value: string
		onInput: (value: string) => Message
		isDisabled: boolean
		error?: string
		help?: string
		placeholder?: string
		isMono?: boolean
		className?: string
	}>,
): Html =>
	textField(
		h,
		{
			id: options.id,
			value: options.value,
			onInput: options.onInput,
			isInvalid: options.error !== undefined,
			isDisabled: options.isDisabled,
			className: options.className,
		},
		(parts) => [
			parts.label([options.label]),
			parts.input({
				placeholder: options.placeholder,
				className: options.isMono === true ? "font-mono" : undefined,
			}),
			...(options.help === undefined ? [] : [parts.description([options.help])]),
			parts.fieldError([options.error ?? ""]),
		],
	)

/** A segmented choice with its label; members see the chosen label as text. */
export const choice = <K extends string>(
	h: H,
	options: Readonly<{
		label: string
		segments: ReadonlyArray<Segment<K>>
		selected: K
		onSelect: (key: K) => Message
		isDisabled: boolean
		help?: string
	}>,
): Html =>
	h.div(
		[h.Class("flex min-w-0 flex-col gap-1.5")],
		[
			Field.label(h, { elementType: "span" }, [options.label]),
			options.isDisabled
				? h.span(
						[h.Class("text-fg text-sm")],
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
					}),
			...(options.help === undefined ? [] : [h.p([h.Class("text-muted-fg text-xs")], [options.help])]),
		],
	)

/** `spans_ingested` in mono. */
export const keyText = (h: H, key: string, className?: string): Html =>
	h.code([h.Class(twMerge("truncate font-mono text-muted-fg text-xs", className))], [key])
