import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { Message } from "./message"

/** What every part of the health settings view reads: the saved and draft settings and who may edit. */
export interface Context {
	readonly saved: Customers.HealthSettings
	readonly draft: Customers.HealthSettings
	/** `invalidFieldsOf(draft)`. */
	readonly invalid: ReadonlySet<string>
	readonly total: number
	readonly isDirty: boolean
	readonly canEdit: boolean
}

export type H = HtmlBuilder<Message>

export const card = (h: H, className: string, children: ReadonlyArray<Html>): Html =>
	h.section(
		[
			h.Class(
				twMerge("flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-bg p-4", className),
			),
		],
		[...children],
	)

export const cardTitle = (h: H, title: string, subtitle: string): Html =>
	h.div(
		[h.Class("flex flex-col gap-0.5")],
		[
			h.h2([h.Class("font-medium text-fg text-sm")], [title]),
			h.p([h.Class("text-muted-fg text-xs")], [subtitle]),
		],
	)

/** An input's text: an emptied field holds `NaN`. */
export const textOf = (value: number): string => (Number.isNaN(value) ? "" : String(value))
export const parseNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text))

/** A compact number field for a step's threshold or score. */
export const numberInput = (
	h: H,
	options: Readonly<{
		value: string
		ariaLabel: string
		isInvalid: boolean
		isDisabled: boolean
		onInput: (text: string) => Message
		className?: string
	}>,
): Html =>
	h.input([
		h.Type("text"),
		h.InputMode("decimal"),
		h.Value(options.value),
		h.AriaLabel(options.ariaLabel),
		h.AriaInvalid(options.isInvalid),
		h.Disabled(options.isDisabled),
		h.OnInput(options.onInput),
		h.Class(
			twMerge(
				"h-7 w-12 rounded-md border border-input bg-bg px-1.5 text-right text-fg text-xs tabular-nums outline-hidden focus-visible:border-ring/70 focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60",
				options.isInvalid && "border-danger focus-visible:border-danger focus-visible:ring-danger/20",
				options.className,
			),
		),
	])

/** A scoring rule's row: the condition (text and inputs) left, the points right. */
export const ruleRow = (
	h: H,
	condition: ReadonlyArray<Html | string>,
	points: ReadonlyArray<Html | string>,
) =>
	h.div(
		[
			h.Class(
				"flex min-h-9 items-center justify-between gap-3 rounded-md bg-secondary/50 px-2 py-1 text-secondary-fg text-xs",
			),
		],
		[
			h.span([h.Class("flex min-w-0 flex-wrap items-center gap-1.5")], [...condition]),
			h.span([h.Class("flex shrink-0 items-center gap-1 text-muted-fg")], [...points]),
		],
	)

/** A rules section's heading: its input on the left, how it is measured on the right. */
export const ruleHeading = (h: H, name: string, formula: string): Html =>
	h.div(
		[h.Class("flex items-baseline justify-between gap-3")],
		[
			h.span([h.Class("font-medium text-secondary-fg text-xs")], [name]),
			h.span([h.Class("text-right text-[0.6875rem] text-muted-fg")], [formula]),
		],
	)
