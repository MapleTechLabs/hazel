import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	commandMenuFormBackClassName,
	commandMenuFormBackIconClassName,
	commandMenuFormBodyBase,
	commandMenuFormContainerBase,
	commandMenuFormErrorClassName,
	commandMenuFormEscapeClassName,
	commandMenuFormFieldBase,
	commandMenuFormFooterBase,
	commandMenuFormHeaderBase,
	commandMenuFormLabelClassName,
	commandMenuFormSubtitleClassName,
	commandMenuFormTitleClassName,
	commandMenuFormTitlesClassName,
	commandMenuInputBase,
	commandMenuInputIconClassName,
	commandMenuInputWrapperClassName,
	commandMenuToggleBase,
	commandMenuToggleOptionClassName,
} from "~/components/ui/command-menu-form.styles"

/**
 * Port of `components/ui/command-menu-form.tsx`: the form-page parts a CommandMenu renders through
 * `toFormPage`. All are views; the parent owns the values and passes Messages in.
 */

type Children = ReadonlyArray<Html | string>
type Attributes<Message> = ReadonlyArray<Attribute<Message> | ChildAttribute>

export const commandMenuFormContainer = <M>(
	h: HtmlBuilder<M>,
	children: Children,
	className?: string,
): Html => h.div([h.Class(twMerge(commandMenuFormContainerBase, className))], children)

/** `CommandMenuFormHeader`; `closeAttributes` come from CommandMenu's `toFormPage`. */
export const commandMenuFormHeader = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		subtitle?: string
		backAttributes?: Attributes<M>
		closeAttributes: Attributes<M>
		className?: string
	}>,
): Html =>
	h.div(
		[h.Class(twMerge(commandMenuFormHeaderBase, options.className))],
		[
			...(options.backAttributes
				? [
						h.button(
							[
								...options.backAttributes,
								h.Class(commandMenuFormBackClassName),
								h.Attribute("data-react-aria-pressable", "true"),
								h.Attribute("tabindex", "0"),
								h.Attribute("type", "button"),
							],
							[
								h.svg(
									[
										h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
										h.Attribute("viewBox", "0 0 16 16"),
										h.Attribute("fill", "currentColor"),
										h.Class(commandMenuFormBackIconClassName),
									],
									[
										h.path([
											h.Attribute("fill-rule", "evenodd"),
											h.Attribute(
												"d",
												"M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z",
											),
											h.Attribute("clip-rule", "evenodd"),
										]),
									],
								),
							],
						),
					]
				: []),
			h.div(
				[h.Class(commandMenuFormTitlesClassName)],
				[
					h.h2([h.Class(commandMenuFormTitleClassName)], [options.title]),
					...(options.subtitle
						? [h.p([h.Class(commandMenuFormSubtitleClassName)], [options.subtitle])]
						: []),
				],
			),
			h.button(
				[
					...options.closeAttributes,
					h.Class(commandMenuFormEscapeClassName),
					h.Attribute("data-react-aria-pressable", "true"),
					h.Attribute("tabindex", "0"),
					h.Attribute("type", "button"),
				],
				["Esc"],
			),
		],
	)

export const commandMenuFormBody = <M>(h: HtmlBuilder<M>, children: Children, className?: string): Html =>
	h.div([h.Class(twMerge(commandMenuFormBodyBase, className))], children)

export const commandMenuFormFooter = <M>(h: HtmlBuilder<M>, children: Children, className?: string): Html =>
	h.div([h.Class(twMerge(...commandMenuFormFooterBase, className))], children)

export const commandMenuFormField = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ label?: string; error?: string; className?: string }>,
	children: Children,
): Html =>
	h.div(
		[h.Class(twMerge(commandMenuFormFieldBase, options.className))],
		[
			...(options.label ? [h.label([h.Class(commandMenuFormLabelClassName)], [options.label])] : []),
			...children,
			...(options.error
				? [h.p([h.Class(commandMenuFormErrorClassName), h.Role("alert")], [options.error])]
				: []),
		],
	)

/** `CommandMenuInput`; pass the value, input handler and aria attributes in `attributes`. */
export const commandMenuInput = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ icon?: Html; className?: string; attributes: Attributes<M> }>,
): Html =>
	h.div(
		[h.Class(commandMenuInputWrapperClassName)],
		[
			...(options.icon ? [h.div([h.Class(commandMenuInputIconClassName)], [options.icon])] : []),
			h.input([
				...options.attributes,
				h.Class(
					twMerge(twMerge(...commandMenuInputBase(options.icon !== undefined)), options.className),
				),
			]),
		],
	)

const visuallyHidden =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;"

/** `CommandMenuToggle`: a horizontal RadioGroup of labelled options. */
export const commandMenuToggle = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		name: string
		value: string
		options: ReadonlyArray<Readonly<{ value: string; label: string; icon?: Html }>>
		onChange: (value: string) => M
		className?: string
	}>,
): Html =>
	h.div(
		[
			h.Attribute("aria-orientation", "horizontal"),
			h.Class(twMerge(commandMenuToggleBase, options.className)),
			h.Attribute("data-orientation", "horizontal"),
			h.Role("radiogroup"),
		],
		options.options.map((option) => {
			const isSelected = option.value === options.value
			return h.label(
				[
					h.Class(commandMenuToggleOptionClassName(isSelected)),
					h.Attribute("data-react-aria-pressable", "true"),
					...(isSelected ? [h.Attribute("data-selected", "true")] : []),
				],
				[
					h.span(
						[h.Attribute("style", visuallyHidden)],
						[
							h.input([
								...(isSelected ? [h.Attribute("checked", "")] : []),
								h.Attribute("name", options.name),
								h.Attribute("tabindex", isSelected ? "0" : "-1"),
								h.Attribute("type", "radio"),
								h.Attribute("value", option.value),
								h.OnChange(() => options.onChange(option.value)),
							]),
						],
					),
					...(option.icon ? [option.icon] : []),
					option.label,
				],
			)
		}),
	)
