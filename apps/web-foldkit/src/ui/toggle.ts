import { Option, Schema } from "effect"
import type { Update } from "foldkit"
import type { Attribute, Html } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { defineView } from "foldkit/submodel"
import { twMerge } from "tailwind-merge"
import type { VariantProps } from "tailwind-variants"
import { toggleStyles } from "~/components/ui/toggle.styles"
import * as Collection from "./aria/collection"

/**
 * Port of `components/ui/toggle.tsx` (React Aria ToggleButton). Hover, focus and modality are a
 * minimal local copy of RA interaction state, to fold into `aria/interaction.ts` once it exists.
 */

// MODEL

export const Focus = Schema.Literals(["Blurred", "Focused"])
export type Focus = typeof Focus.Type
export const Hover = Schema.Literals(["Unhovered", "Hovered"])
export type Hover = typeof Hover.Type

export const Model = Schema.Struct({
	isSelected: Schema.Boolean,
	hover: Hover,
	focus: Focus,
	modality: Collection.Modality,
})
export type Model = typeof Model.Type

export const init = (config: { readonly isSelected?: boolean } = {}): Model => ({
	isSelected: config.isSelected ?? false,
	hover: "Unhovered",
	focus: "Blurred",
	modality: "Unknown",
})

// MESSAGE

export const Message = defineMessageUnion({
	HoveredToggle: {},
	UnhoveredToggle: {},
	PressedPointer: {},
	ReleasedKey: {},
	ClickedToggle: {},
	FocusedToggle: {},
	BlurredToggle: {},
})
export type Message = typeof Message.Type

// UPDATE

const withHover = (model: Model, hover: Hover) => modifyFields(model, { hover: () => hover })
const withFocus = (model: Model, focus: Focus) => modifyFields(model, { focus: () => focus })
const withModality = (model: Model, modality: Collection.Modality) =>
	modifyFields(model, { modality: () => modality })

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		HoveredToggle: () => ({ model: withHover(model, "Hovered") }),
		UnhoveredToggle: () => ({ model: withHover(model, "Unhovered") }),
		PressedPointer: () => ({ model: withModality(model, "Pointer") }),
		ReleasedKey: () => ({ model: withModality(model, "Keyboard") }),
		ClickedToggle: () => ({ model: modifyFields(model, { isSelected: (isSelected) => !isSelected }) }),
		FocusedToggle: () => ({ model: withFocus(model, "Focused") }),
		BlurredToggle: () => ({ model: withFocus(model, "Blurred") }),
	})

// VIEW

export type ToggleVariants = Omit<VariantProps<typeof toggleStyles>, "isDisabled">

export type ViewInputs = Readonly<
	ToggleVariants & {
		content: ReadonlyArray<Html | string>
		isDisabled?: boolean
		className?: string
		ariaLabel?: string
	}
>

/** RA render props for one toggle, shared with toggle-group items. */
export const renderProps = (model: Model, isDisabled: boolean) => {
	const isFocused = model.focus === "Focused"
	return {
		isSelected: model.isSelected,
		isHovered: !isDisabled && model.hover === "Hovered",
		isFocused,
		isFocusVisible: isFocused && model.modality !== "Pointer",
		isPressed: false,
		isDisabled,
	}
}

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const isDisabled = viewInputs.isDisabled === true
	const state = renderProps(model, isDisabled)
	const handlers: ReadonlyArray<Attribute<Message>> = isDisabled
		? [h.Disabled(true)]
		: [
				h.Tabindex(0),
				h.OnMouseEnter(Message.HoveredToggle()),
				h.OnMouseLeave(Message.UnhoveredToggle()),
				h.OnPointerDown(() => Option.some(Message.PressedPointer())),
				h.OnKeyUp(() => Message.ReleasedKey()),
				h.OnClick(Message.ClickedToggle()),
				h.OnFocus(Message.FocusedToggle()),
				h.OnBlur(Message.BlurredToggle()),
			]
	return h.button(
		[
			h.Class(
				twMerge(
					toggleStyles({
						...state,
						isCircle: viewInputs.isCircle,
						size: viewInputs.size,
						intent: viewInputs.intent,
						className: viewInputs.className,
					}),
				),
			),
			h.Type("button"),
			h.AriaPressed(model.isSelected ? "true" : "false"),
			...(viewInputs.ariaLabel === undefined ? [] : [h.AriaLabel(viewInputs.ariaLabel)]),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			...Collection.stateAttributes(h, state),
			...handlers,
		],
		[...viewInputs.content],
	)
})
