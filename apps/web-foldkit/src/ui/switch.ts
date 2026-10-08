import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import { switchIndicatorStyles, switchStyles, switchThumbStyles } from "~/components/ui/switch.styles"
import * as Collection from "./aria/collection"
import * as Interaction from "./aria/interaction"
import { visuallyHiddenStyle } from "./checkbox"
import * as Field from "./field"

/** Port of `components/ui/switch.tsx` (React Aria Switch, which presses like a Checkbox label). */
export interface SwitchOptions<Message> {
	/** Element id of the input and the interaction target. */
	readonly id: string
	readonly isSelected: boolean
	readonly isDisabled?: boolean
	readonly onChange?: (isSelected: boolean) => Message
	readonly className?: string
	readonly interaction?: Interaction.Wiring<Message>
}

export const switchControl = <Message>(
	h: HtmlBuilder<Message>,
	options: SwitchOptions<Message>,
	children: string | Array<Html>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const interaction = options.interaction
	const state = interaction ? Interaction.stateOf(interaction.model, options.id) : Interaction.idleState
	const toggle = options.onChange?.(!options.isSelected)
	const values = {
		isHovered: state.isHovered,
		isFocusVisible: state.isFocusVisible,
		isSelected: options.isSelected,
		isDisabled,
	}
	// The style prop, then usePress's userSelect while a pointer press is held.
	const isPointerPressing =
		interaction?.model.press?.target === options.id && interaction.model.press.source === "pointer"
	const style = `-webkit-tap-highlight-color: transparent;${isPointerPressing ? " user-select: none;" : ""}`
	const content =
		typeof children === "string" ? [Field.label(h, { elementType: "span" }, [children])] : children

	return h.label(
		[
			h.Class(twMerge(twMerge(switchStyles), options.className)),
			h.DataAttribute("rac", ""),
			h.DataAttribute("react-aria-pressable", "true"),
			h.DataAttribute("slot", "control"),
			h.Attribute("style", style),
			...(options.isSelected ? [h.DataAttribute("selected", "true")] : []),
			...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
			...(interaction
				? [
						...Interaction.handlers(h, interaction, options.id, {
							isHoverDisabled: isDisabled,
							isPressDisabled: isDisabled,
							isFocusDisabled: true,
						}),
						...Interaction.stateAttributes(h, state),
					]
				: []),
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
						h.DataAttribute("react-aria-pressable", "true"),
						h.Attribute("style", ""),
						...(isDisabled ? [h.Disabled(true)] : [h.Tabindex(0)]),
						h.Checked(options.isSelected),
						...(interaction
							? Interaction.handlers(h, interaction, options.id, {
									isHoverDisabled: true,
									isPressDisabled: true,
									isFocusDisabled: isDisabled,
								})
							: []),
						...(toggle === undefined ? [] : [h.OnChange(() => toggle)]),
					]),
				],
			),
			h.span(
				[h.DataAttribute("slot", "indicator"), h.Class(twMerge(...switchIndicatorStyles(values)))],
				[h.span([h.AriaHidden(true), h.Class(twJoin(...switchThumbStyles(values)))], [])],
			),
			...content,
		],
	)
}
