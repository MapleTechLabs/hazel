import { Effect, Option, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import { checkboxStyles } from "~/components/ui/checkbox.styles"
import {
	choiceBoxCheckboxStyles,
	choiceBoxDescriptionStyles,
	choiceBoxItemStyles,
	choiceBoxLabelStyles,
	choiceBoxStyles,
} from "~/components/ui/choice-box.styles"
import * as Interaction from "./aria/interaction"
import { checkbox } from "./checkbox"

/**
 * Port of `components/ui/choice-box.tsx` (React Aria GridList). The grid is tabbable until an item
 * has been focused; then the focused item holds the roving tabindex. Arrow keys move focus, Space,
 * Enter and clicks toggle selection (single mode can deselect, like selectionBehavior "toggle").
 */

// MODEL

export const SelectionMode = Schema.Literals(["single", "multiple"])
export type SelectionMode = typeof SelectionMode.Type

export const Model = Schema.Struct({
	id: Schema.String,
	selectionMode: SelectionMode,
	selectedKeys: Schema.Array(Schema.String),
	focusedKey: Schema.NullOr(Schema.String),
})
export type Model = typeof Model.Type

export const init = (options: {
	readonly id: string
	readonly selectionMode?: SelectionMode
	readonly selectedKeys?: ReadonlyArray<string>
}): Model => ({
	id: options.id,
	selectionMode: options.selectionMode ?? "single",
	selectedKeys: options.selectedKeys ?? [],
	focusedKey: null,
})

// MESSAGE

/** Enabled item keys in order plus the column count, so keyboard navigation stays pure. */
const Navigation = { keys: Schema.Array(Schema.String), columns: Schema.Number }

export const Message = defineMessageUnion({
	ClickedItem: { key: Schema.String },
	ToggledSelectionCheckbox: { key: Schema.String },
	PressedGridKey: { key: Schema.String, ...Navigation },
	FocusedGrid: { keys: Schema.Array(Schema.String) },
	CompletedFocusItem: {},
})
export type Message = typeof Message.Type

// COMMAND

export const itemId = (model: Model, key: string) => `${model.id}-${key}`

const FocusItem = Command.define("FocusItem", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusItem],
	execute: ({ elementId }) =>
		Dom.focus(`#${CSS.escape(elementId)}`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusItem())),
})

// UPDATE

const toggle = (model: Model, key: string): Model =>
	modifyFields(model, {
		selectedKeys: (selected) =>
			selected.includes(key)
				? selected.filter((selectedKey) => selectedKey !== key)
				: model.selectionMode === "single"
					? [key]
					: [...selected, key],
	})

const focusKey = (model: Model, key: string): Update.Return<Model, Message> => ({
	model: modifyFields(model, { focusedKey: () => key }),
	commands: [FocusItem({ elementId: itemId(model, key) })],
})

/** ListKeyboardDelegate: next/previous, a row down/up in a grid, first/last. */
const keyFor = (key: string, current: number, keys: ReadonlyArray<string>, columns: number) => {
	const step = columns > 1 ? columns : 1
	const target =
		key === "ArrowDown"
			? current + step
			: key === "ArrowUp"
				? current - step
				: key === "ArrowRight"
					? current + 1
					: key === "ArrowLeft"
						? current - 1
						: key === "Home"
							? 0
							: keys.length - 1
	return Option.fromNullishOr(keys[target])
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		ClickedItem: ({ key }) => ({ model: modifyFields(toggle(model, key), { focusedKey: () => key }) }),
		ToggledSelectionCheckbox: ({ key }) => ({ model: toggle(model, key) }),
		PressedGridKey: ({ key, keys, columns }) => {
			const focused = model.focusedKey
			if (key === " " || key === "Enter")
				return { model: focused === null ? model : toggle(model, focused) }
			const current = focused === null ? -1 : keys.indexOf(focused)
			return Option.match(keyFor(key, current, keys, columns), {
				onNone: () => ({ model }),
				onSome: (next) => focusKey(model, next),
			})
		},
		// useSelectableCollection: focusing the grid moves focus to the selected (or first) item.
		FocusedGrid: ({ keys }) => {
			const target = model.focusedKey ?? keys.find((key) => model.selectedKeys.includes(key)) ?? keys[0]
			return target === undefined ? { model } : focusKey(model, target)
		},
		CompletedFocusItem: () => ({ model }),
	})

// VIEW

export interface ChoiceBoxItemParts {
	readonly label: (children: Array<Html | string>, options?: { readonly className?: string }) => Html
	readonly description: (children: Array<Html | string>, options?: { readonly className?: string }) => Html
}

export interface ChoiceBoxItem {
	readonly key: string
	readonly textValue?: string
	readonly label?: string
	readonly description?: string
	readonly isDisabled?: boolean
	readonly className?: string
	/** Custom children (icon, label, description); `label`/`description` are used otherwise. */
	readonly content?: (parts: ChoiceBoxItemParts) => Array<Html>
}

export interface ChoiceBoxOptions<ParentMessage> {
	readonly model: Model
	readonly toParentMessage: (message: Message) => ParentMessage
	readonly ariaLabel: string
	readonly columns?: 1 | 2 | 3 | 4 | 5 | 6
	readonly gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6
	readonly isReadOnly?: boolean
	readonly className?: string
	readonly interaction?: Interaction.Wiring<ParentMessage>
}

const navigationKeys = /^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Home|End| |Enter)$/

/** Returns React Aria's FocusScope sentinels around the grid; spread them into the parent. */
export const choiceBox = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: ChoiceBoxOptions<ParentMessage>,
	items: ReadonlyArray<ChoiceBoxItem>,
): Array<Html> => {
	const model = options.model
	const send = options.toParentMessage
	const columns = options.columns ?? 1
	const gap = options.gap ?? 0
	const isReadOnly = options.isReadOnly ?? false
	const interaction = options.interaction
	const enabledKeys = items.filter((item) => !item.isDisabled).map((item) => item.key)

	const row = (item: ChoiceBoxItem) => {
		const id = itemId(model, item.key)
		const descriptionId = `${id}-description`
		const isDisabled = item.isDisabled ?? false
		const isSelected = model.selectedKeys.includes(item.key)
		const state = interaction ? Interaction.stateOf(interaction.model, id) : Interaction.idleState
		const parts: ChoiceBoxItemParts = {
			label: (children, part = {}) =>
				h.span(
					[
						h.DataAttribute("slot", "label"),
						h.Class(twMerge(...choiceBoxLabelStyles, part.className)),
					],
					children,
				),
			description: (children, part = {}) =>
				h.span(
					[
						h.Attribute("slot", "description"),
						h.Id(descriptionId),
						h.Class(twMerge(...choiceBoxDescriptionStyles, part.className)),
					],
					children,
				),
		}
		const content = item.content
			? item.content(parts)
			: [
					...(item.label ? [parts.label([item.label])] : []),
					...(item.description ? [parts.description([item.description])] : []),
				]
		const selectionCheckbox =
			model.selectionMode === "multiple"
				? [
						checkbox(
							h,
							{
								id: `${id}-selection`,
								isSelected,
								slot: "selection",
								ariaLabel: "Select",
								labelledBy: `${id}-selection ${id}`,
								className: twMerge(twMerge(checkboxStyles), choiceBoxCheckboxStyles),
								onChange: () => send(Message.ToggledSelectionCheckbox({ key: item.key })),
								stopsClickPropagation: true,
								interaction,
							},
							[],
						),
					]
				: []
		return h.div(
			[
				h.Class(
					choiceBoxItemStyles({
						isHovered: state.isHovered,
						isFocused: !isReadOnly && state.isFocused,
						isActive: (!isReadOnly && isSelected) || state.isFocusVisible,
						isDisabled,
						isOneColumn: columns === 1,
						isLink: false,
						className: item.className,
					}),
				),
				h.Id(id),
				h.Role("row"),
				h.DataAttribute("rac", ""),
				h.DataAttribute("collection", model.id),
				h.DataAttribute("key", item.key),
				h.DataAttribute("selection-mode", model.selectionMode),
				h.DataAttribute("slot", "choice-box-item"),
				...(item.textValue === undefined
					? []
					: [h.AriaLabel(item.textValue), h.AriaLabelledBy(`${id} ${descriptionId}`)]),
				...(isDisabled
					? [h.AriaDisabled(true), h.DataAttribute("disabled", "true")]
					: [
							h.AriaSelected(isSelected),
							h.DataAttribute("react-aria-pressable", "true"),
							h.Tabindex(model.focusedKey === item.key ? 0 : -1),
							...(isSelected ? [h.DataAttribute("selected", "true")] : []),
							...(interaction
								? [
										...Interaction.handlers(h, interaction, id),
										...Interaction.stateAttributes(h, state),
									]
								: []),
							...(isReadOnly ? [] : [h.OnClick(send(Message.ClickedItem({ key: item.key })))]),
						]),
			],
			[
				h.div(
					[
						h.Attribute("aria-colindex", "1"),
						h.Role("gridcell"),
						h.Attribute("style", "display: contents;"),
					],
					[...content, ...selectionCheckbox],
				),
			],
		)
	}

	const focusScope = (edge: "start" | "end") =>
		h.span([h.DataAttribute(`focus-scope-${edge}`, "true"), h.Hidden(true)], [])

	return [
		focusScope("start"),
		h.div(
			[
				h.Class(twMerge(twMerge(choiceBoxStyles({ columns, gap })), options.className)),
				h.Id(`${model.id}`),
				h.Role("grid"),
				h.AriaLabel(options.ariaLabel),
				...(model.selectionMode === "multiple" ? [h.AriaMultiSelectable(true)] : []),
				h.DataAttribute("rac", ""),
				h.DataAttribute("collection", model.id),
				h.DataAttribute("layout", columns === 1 ? "stack" : "grid"),
				h.DataAttribute("slot", "control"),
				h.Tabindex(model.focusedKey === null ? 0 : -1),
				h.OnFocus(send(Message.FocusedGrid({ keys: enabledKeys }))),
				h.OnKeyDownPreventDefault((key) =>
					navigationKeys.test(key)
						? Option.some(send(Message.PressedGridKey({ key, keys: enabledKeys, columns })))
						: Option.none(),
				),
			],
			items.map(row),
		),
		focusScope("end"),
	]
}
