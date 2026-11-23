import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { Message } from "./message"
import type { HealthDraft } from "./model"
import { inputElement } from "../../../../ui/input"

/** What every part of the health settings view reads: the saved and draft settings and who may edit. */
export interface Context {
	readonly saved: Customers.HealthSettings
	readonly draft: HealthDraft
	/** `invalidFieldsOf(draft)`. */
	readonly invalid: ReadonlySet<string>
	readonly total: number
	readonly isDirty: boolean
	readonly canEdit: boolean
	/** `Model.typing`. */
	readonly typing: Readonly<{ field: string; text: string }> | null
}

export type H = HtmlBuilder<Message>

/** An input's text: an emptied field holds `null`. */
export const textOf = (value: number | null): string => (value === null ? "" : String(value))
/**
 * Plain decimals only (`12`, `-0.5`, `1.`): `1e2`, `0x10` or `Infinity` read as invalid (`null`), not
 * as a number, and so do digits too many to be a finite one.
 */
const DECIMAL = /^\s*-?(\d+\.?\d*|\.\d+)\s*$/
export const parseNumber = (text: string): number | null => {
	if (!DECIMAL.test(text)) return null
	const value = Number(text)
	return Number.isFinite(value) ? value : null
}

/** The field's text: what was typed in it while that still reads as `value` (`-`, `1.`), else the value. */
export const numberText = (typing: Context["typing"], field: string, value: number | null): string =>
	typing !== null && typing.field === field && Object.is(parseNumber(typing.text), value)
		? typing.text
		: textOf(value)

/** A compact number field for a step's threshold or score; `field` is its `invalidFieldsOf` key. */
export const numberInput = (
	h: H,
	context: Context,
	options: Readonly<{
		field: string
		value: number | null
		ariaLabel: string
		onInput: (text: string) => Message
		className?: string
	}>,
): Html => {
	const isInvalid = context.invalid.has(options.field)
	return inputElement(h, {
		isInvalid,
		isDisabled: !context.canEdit,
		className: twMerge(
			"inline-block h-7 w-12 rounded-md px-1.5 py-0 text-right text-xs tabular-nums sm:px-1.5 sm:py-0 sm:text-xs",
			options.className,
		),
		attributes: [
			h.Type("text"),
			h.InputMode("decimal"),
			h.Value(numberText(context.typing, options.field, options.value)),
			h.AriaLabel(options.ariaLabel),
			h.OnInput(options.onInput),
		],
	})
}

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
			h.span([h.Class("flex min-w-0 items-center gap-1.5")], [...condition]),
			h.span([h.Class("flex shrink-0 items-center gap-1 text-muted-fg")], [...points]),
		],
	)

/** A rules section's heading: its input on the left, how it is measured on the right. */
export const ruleHeading = (h: H, name: string, formula: string): Html =>
	h.div(
		[h.Class("flex items-baseline justify-between gap-3")],
		[
			h.span([h.Class("font-medium text-secondary-fg text-xs")], [name]),
			h.span([h.Class("text-right text-2xs text-muted-fg")], [formula]),
		],
	)
