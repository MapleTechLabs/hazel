import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { SEVERITY_LABEL, severityGlyph } from "../../../../customers/ui/badges"
import { ariaButton } from "../../../../ui/button"
import { fieldError as kitFieldError } from "../../../../ui/field"
import { iconTile } from "../../../../ui/icon-tile"
import { inputElement } from "../../../../ui/input"
import { segmentClass, segmentedTrackClass } from "../../../../ui/segmented-control"
import { TEMPLATE_ICON } from "./describe"
import type { Message } from "./message"

/** View pieces the list, the picker and the editor share. */

type H = HtmlBuilder<Message>

/** The template's glyph on a tile. */
export const templateTile = (h: H, template: Customers.SignalTemplate, className?: string): Html =>
	iconTile(
		h,
		{ size: "sm", className: twMerge("border-0 text-fg-2", className) },
		TEMPLATE_ICON[template](h),
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
	error === undefined ? [] : [kitFieldError(h, { id: errorIdOf(id), className: "text-xs" }, [error])]

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
		[h.Role("radiogroup"), h.AriaLabel("Severity"), h.Class(segmentedTrackClass)],
		(["low", "medium", "high"] as const).map((severity) => {
			const isSelected = severity === options.selected
			return ariaButton(
				h,
				{
					isDisabled: options.isDisabled,
					onPress: options.onSelect(severity),
					attributes: [h.Role("radio"), h.AriaChecked(isSelected)],
					className: segmentClass(isSelected),
				},
				[severityGlyph(h, severity, { labelled: false }), SEVERITY_LABEL[severity]],
			)
		}),
	)
