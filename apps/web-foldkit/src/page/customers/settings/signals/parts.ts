import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { SEVERITY_LABEL, severityGlyph } from "../../../../customers/ui/badges"
import { inputElement } from "../../../../ui/input"
import { TEMPLATE_ICON } from "./describe"
import type { Message } from "./message"

/** View pieces the list, the picker and the editor share. */

type H = HtmlBuilder<Message>

export const card = (
	h: H,
	options: Readonly<{ title?: string; aside?: Html | null; className?: string }>,
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
			...(options.title === undefined
				? []
				: [
						h.header(
							[h.Class("flex flex-wrap items-center justify-between gap-2")],
							[
								h.h2([h.Class("font-semibold text-base/6 text-fg")], [options.title]),
								...(options.aside == null ? [] : [options.aside]),
							],
						),
					]),
			...children,
		],
	)

/** The template's glyph on a tile. */
export const templateTile = (h: H, template: Customers.SignalTemplate, className?: string): Html =>
	h.span(
		[
			h.AriaHidden(true),
			h.Class(
				twMerge(
					"inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-fg-2",
					className,
				),
			),
		],
		[TEMPLATE_ICON[template](h, { className: "size-4" })],
	)

export const errorIdOf = (id: string) => `${id}-error`

/** A number typed inline in a sentence ("No contact activity for [14] days"). */
export const numberInput = (
	h: H,
	options: Readonly<{
		id: string
		label: string
		value: string
		error: string | undefined
		isDisabled: boolean
		onInput: (value: string) => Message
		className?: string
	}>,
): Html =>
	inputElement(h, {
		className: twMerge("inline-block w-16 text-center tabular-nums", options.className),
		isInvalid: options.error !== undefined,
		isDisabled: options.isDisabled,
		attributes: [
			h.Id(options.id),
			h.AriaLabel(options.label),
			h.InputMode("decimal"),
			h.Value(options.value),
			h.OnInput(options.onInput),
			...(options.error === undefined ? [] : [h.AriaDescribedBy(errorIdOf(options.id))]),
		],
	})

export const fieldError = (h: H, id: string, error: string | undefined): ReadonlyArray<Html> =>
	error === undefined ? [] : [h.p([h.Id(errorIdOf(id)), h.Class("text-danger-subtle-fg text-xs")], [error])]

/** `▂ Low  ▂▄ Medium  ▂▄▆ High` as a radio group. */
export const severityPicker = (
	h: H,
	options: Readonly<{
		selected: Customers.SignalSeverity
		isDisabled: boolean
		onSelect: (severity: Customers.SignalSeverity) => Message
	}>,
): Html =>
	h.div(
		[
			h.Role("radiogroup"),
			h.AriaLabel("Severity"),
			h.Class("inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5"),
		],
		(["low", "medium", "high"] as const).map((severity) => {
			const isSelected = severity === options.selected
			return h.button(
				[
					h.Type("button"),
					h.Role("radio"),
					h.AriaChecked(isSelected),
					...(options.isDisabled ? [h.Disabled(true)] : [h.OnClick(options.onSelect(severity))]),
					h.Class(
						twMerge(
							"inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 font-medium text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default",
							isSelected
								? "bg-secondary text-fg shadow-control"
								: "text-fg-3 hover:bg-secondary hover:text-fg",
						),
					),
				],
				[severityGlyph(h, severity, { labelled: false }), SEVERITY_LABEL[severity]],
			)
		}),
	)

/** A pressable chip that toggles (stage and plan choices, metered metrics). */
export const toggleChip = (
	h: H,
	options: Readonly<{ label: string; isPressed: boolean; isDisabled: boolean; onPress: Message }>,
): Html =>
	h.button(
		[
			h.Type("button"),
			h.AriaPressed(options.isPressed ? "true" : "false"),
			...(options.isDisabled ? [h.Disabled(true)] : [h.OnClick(options.onPress)]),
			h.Class(
				twMerge(
					"inline-flex h-7 cursor-pointer items-center rounded-md border border-border px-2 font-medium text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default",
					options.isPressed
						? "border-primary/50 bg-primary-subtle/50 text-fg"
						: "text-muted-fg hover:bg-secondary hover:text-fg",
				),
			),
		],
		[options.label],
	)
