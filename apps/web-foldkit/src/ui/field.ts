import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { descriptionStyles, fieldErrorStyles, labelStyles } from "~/components/ui/field.styles"

/** Port of `components/ui/field.tsx`. Inside a field the ids come from the field (React Aria context). */
export interface PartOptions<Message> {
	readonly className?: string
	readonly attributes?: ReadonlyArray<Attribute<Message>>
}

/** React Aria Label: `<label data-slot="label">`, wired with `for`/`id` inside a field. */
export const label = <Message>(
	h: HtmlBuilder<Message>,
	options: PartOptions<Message> & {
		readonly id?: string
		readonly htmlFor?: string
		readonly elementType?: "label" | "span"
	},
	children: Array<Html | string>,
): Html => {
	const attributes = [
		h.Class(labelStyles({ className: options.className })),
		h.DataAttribute("slot", "label"),
		...(options.id === undefined ? [] : [h.Id(options.id)]),
		...(options.htmlFor === undefined ? [] : [h.For(options.htmlFor)]),
		...(options.attributes ?? []),
	]
	return options.elementType === "span" ? h.span(attributes, children) : h.label(attributes, children)
}

/** React Aria Text with `slot="description"`. */
export const description = <Message>(
	h: HtmlBuilder<Message>,
	options: PartOptions<Message> & { readonly id?: string },
	children: Array<Html | string>,
): Html =>
	h.span(
		[
			h.Class(descriptionStyles({ className: options.className })),
			h.Attribute("slot", "description"),
			...(options.id === undefined ? [] : [h.Id(options.id)]),
			...(options.attributes ?? []),
		],
		children,
	)

/** React Aria FieldError: rendered only while the field is invalid. */
export const fieldError = <Message>(
	h: HtmlBuilder<Message>,
	options: PartOptions<Message> & { readonly id?: string },
	children: Array<Html | string>,
): Html =>
	h.span(
		[
			h.Class(twMerge(twMerge(fieldErrorStyles()), options.className)),
			h.Attribute("slot", "errorMessage"),
			...(options.id === undefined ? [] : [h.Id(options.id)]),
			...(options.attributes ?? []),
		],
		children,
	)
