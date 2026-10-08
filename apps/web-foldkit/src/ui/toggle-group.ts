import { Array, Option, Schema } from "effect"
import type { Update } from "foldkit"
import type { Attribute, Html } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { defineView } from "foldkit/submodel"
import { twMerge } from "tailwind-merge"
import { toggleGroupItemStyles, toggleGroupStyles } from "~/components/ui/toggle-group.styles"
import * as Collection from "./aria/collection"

/**
 * Port of `components/ui/toggle-group.tsx` (React Aria ToggleButtonGroup). Like legacy, the
 * `orientation` prop only styles the group: RA always gets the default horizontal orientation.
 */

// MODEL

export const SelectionMode = Schema.Literals(["single", "multiple"])
export type SelectionMode = typeof SelectionMode.Type

export const Model = Schema.Struct({
	label: Schema.String,
	selectionMode: SelectionMode,
	selectedKeys: Schema.Array(Schema.String),
	interaction: Collection.Interaction,
})
export type Model = typeof Model.Type

export const init = (config: {
	readonly label: string
	readonly selectionMode?: SelectionMode
	readonly selectedKeys?: ReadonlyArray<string>
}): Model => ({
	label: config.label,
	selectionMode: config.selectionMode ?? "single",
	selectedKeys: config.selectedKeys ?? [],
	interaction: Collection.initInteraction(),
})

// MESSAGE

export const Message = defineMessageUnion({
	HoveredItem: { key: Schema.String },
	UnhoveredItem: { key: Schema.String },
	PressedPointer: {},
	ReleasedKey: {},
	ClickedItem: { key: Schema.String },
	FocusedItem: { key: Schema.String },
	BlurredItem: { key: Schema.String },
	PressedNavigationKey: {},
})
export type Message = typeof Message.Type

// UPDATE

const withInteraction = (
	model: Model,
	next: (interaction: Collection.Interaction) => Collection.Interaction,
) => modifyFields(model, { interaction: next })

const toggleKey = (model: Model, key: string): ReadonlyArray<string> => {
	const isSelected = model.selectedKeys.includes(key)
	if (model.selectionMode === "single") {
		return isSelected ? [] : [key]
	} else {
		return isSelected
			? Array.filter(model.selectedKeys, (selected) => selected !== key)
			: [...model.selectedKeys, key]
	}
}

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		HoveredItem: ({ key }) => ({ model: withInteraction(model, (it) => Collection.hoverItem(it, key)) }),
		UnhoveredItem: ({ key }) => ({
			model: withInteraction(model, (it) => Collection.unhoverItem(it, key)),
		}),
		PressedPointer: () => ({
			model: withInteraction(model, (it) => Collection.useModality(it, "Pointer")),
		}),
		ReleasedKey: () => ({
			model: withInteraction(model, (it) => Collection.useModality(it, "Keyboard")),
		}),
		ClickedItem: ({ key }) => ({
			model: modifyFields(model, { selectedKeys: () => toggleKey(model, key) }),
		}),
		FocusedItem: ({ key }) => ({ model: withInteraction(model, (it) => Collection.focusItem(it, key)) }),
		BlurredItem: ({ key }) => ({ model: withInteraction(model, (it) => Collection.blurItem(it, key)) }),
		PressedNavigationKey: () => ({
			model: withInteraction(model, (it) => Collection.useModality(it, "Keyboard")),
		}),
	})

// VIEW

export type ToggleSize = "xs" | "sm" | "md" | "lg" | "sq-xs" | "sq-sm" | "sq-md" | "sq-lg"

export interface ToggleGroupItem {
	readonly key: string
	readonly content: ReadonlyArray<Html | string>
	readonly isDisabled?: boolean
	readonly ariaLabel?: string
	readonly className?: string
}

export type ViewInputs = Readonly<{
	items: ReadonlyArray<ToggleGroupItem>
	size?: ToggleSize
	orientation?: Collection.Orientation
	isCircle?: boolean
	className?: string
}>

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const { selectionMode, interaction } = model
	const size = viewInputs.size ?? "md"
	const orientation = viewInputs.orientation ?? "horizontal"
	const keys = Array.map(viewInputs.items, (item) => item.key)
	const isDisabledKey = (key: string) =>
		Array.some(viewInputs.items, (item) => item.key === key && item.isDisabled === true)
	// NOTE: focus moves synchronously in keydown, as in RA, so a following key reaches the new item.
	const navigate = (fromKey: string) => (keyboardKey: string) =>
		Option.flatMap(Collection.directionOfKey("horizontal", keyboardKey), (direction) =>
			Option.map(Collection.moveKey(keys, fromKey, direction, isDisabledKey, false), (key) => ({
				focusSelector: Collection.labelledChildSelector(
					model.label,
					Option.getOrElse(
						Array.findFirstIndex(keys, (candidate) => candidate === key),
						() => 0,
					),
				),
				message: Message.PressedNavigationKey(),
			})),
		)

	const itemView = (item: ToggleGroupItem): Html => {
		const isDisabled = item.isDisabled === true
		const isSelected = model.selectedKeys.includes(item.key)
		const state = Collection.itemState(interaction, item.key, isDisabled)
		const handlers: ReadonlyArray<Attribute<Message>> = isDisabled
			? [h.Disabled(true)]
			: [
					h.Tabindex(0),
					h.OnMouseEnter(Message.HoveredItem({ key: item.key })),
					h.OnMouseLeave(Message.UnhoveredItem({ key: item.key })),
					h.OnPointerDown(() => Option.some(Message.PressedPointer())),
					h.OnKeyUp(() => Message.ReleasedKey()),
					h.OnKeyDownFocus(navigate(item.key)),
					h.OnClick(Message.ClickedItem({ key: item.key })),
					h.OnFocus(Message.FocusedItem({ key: item.key })),
					h.OnBlur(Message.BlurredItem({ key: item.key })),
				]
		return h.keyed("button")(
			item.key,
			[
				h.Class(
					twMerge(
						toggleGroupItemStyles({
							...state,
							isSelected,
							isDisabled,
							size,
							orientation,
							selectionMode,
							className: item.className,
						}),
					),
				),
				h.Type("button"),
				...(selectionMode === "single"
					? [h.Role("radio"), h.AriaChecked(isSelected)]
					: [h.AriaPressed(isSelected ? "true" : "false")]),
				...(item.ariaLabel === undefined ? [] : [h.AriaLabel(item.ariaLabel)]),
				h.Attribute("data-rac", ""),
				h.Attribute("data-react-aria-pressable", "true"),
				h.Attribute("data-slot", "toggle-group-item"),
				...Collection.stateAttributes(h, { ...state, isSelected, isDisabled }),
				...handlers,
			],
			[...item.content],
		)
	}

	return h.div(
		[
			h.Class(
				twMerge(
					twMerge(toggleGroupStyles({ orientation, selectionMode, isCircle: viewInputs.isCircle })),
					viewInputs.className,
				),
			),
			h.Role(selectionMode === "single" ? "radiogroup" : "toolbar"),
			h.AriaLabel(model.label),
			h.AriaOrientation("horizontal"),
			h.Attribute("data-orientation", "horizontal"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "control"),
		],
		Array.map(viewInputs.items, itemView),
	)
})
