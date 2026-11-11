import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import { switchIndicatorStyles, switchStyles, switchThumbStyles } from "~/components/ui/switch.styles"
import * as Collection from "./aria/collection"
import { visuallyHiddenStyle } from "./checkbox"
import * as Field from "./field"

/**
 * A switch: a `<label>` around a visually hidden `role="switch"` checkbox, toggled by its label like
 * a Checkbox. Hover and the keyboard focus ring are native CSS (`group-hover`, `group-has-focus-visible`).
 */
export interface SwitchOptions<Message> {
	/** Element id of the input. */
	readonly id: string
	readonly isSelected: boolean
	readonly isDisabled?: boolean
	readonly onChange?: (isSelected: boolean) => Message
	readonly className?: string
}

export const switchControl = <Message>(
	h: HtmlBuilder<Message>,
	options: SwitchOptions<Message>,
	children: string | Array<Html>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const toggle = options.onChange?.(!options.isSelected)
	const values = { isSelected: options.isSelected, isDisabled }
	const content =
		typeof children === "string" ? [Field.label(h, { elementType: "span" }, [children])] : children

	return h.label(
		[
			h.Class(twMerge(twMerge(switchStyles), options.className)),
			h.DataAttribute("react-aria-pressable", "true"),
			h.DataAttribute("slot", "control"),
			h.Attribute("style", "-webkit-tap-highlight-color: transparent;"),
			...(options.isSelected ? [h.DataAttribute("selected", "true")] : []),
			...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
			...(toggle === undefined || isDisabled
				? []
				: [
						h.OnClick(toggle, {
							defaultAction: "Prevent",
							focusSelector: Collection.idAttributeSelector(options.id),
						}),
					]),
		],
		[
			h.span(
				[h.Attribute("style", visuallyHiddenStyle)],
				[
					h.input([
						h.Id(options.id),
						h.Type("checkbox"),
						h.Role("switch"),
						...(isDisabled ? [h.Disabled(true)] : [h.Tabindex(0)]),
						h.Checked(options.isSelected),
						...(toggle === undefined ? [] : [h.OnChange(() => toggle)]),
					]),
				],
			),
			h.span(
				[h.DataAttribute("slot", "indicator"), h.Class(twMerge(...switchIndicatorStyles(values)))],
				[h.span([h.AriaHidden(true), h.Class(twJoin(...switchThumbStyles(values)))])],
			),
			...content,
		],
	)
}
