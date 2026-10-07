import { Array, Effect, Option, Schema } from "effect"
import type { Update } from "foldkit"
import * as Command from "foldkit/command"
import * as Dom from "foldkit/dom"
import type { Attribute, Html } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { defineView } from "foldkit/submodel"
import { twMerge } from "tailwind-merge"
import { tabsStyles } from "~/components/ui/tabs.styles"
import * as Collection from "./aria/collection"

/** Port of `components/ui/tabs.tsx` (React Aria Tabs, automatic activation). */

// MODEL

export const PanelFocus = Schema.Literals(["Unfocused", "Focused"])
export type PanelFocus = typeof PanelFocus.Type

export const Model = Schema.Struct({
	id: Schema.String,
	orientation: Collection.Orientation,
	selectedKey: Schema.String,
	interaction: Collection.Interaction,
	panelFocus: PanelFocus,
})
export type Model = typeof Model.Type

export const init = (config: {
	readonly id: string
	readonly selectedKey: string
	readonly orientation?: Collection.Orientation
}): Model => ({
	id: config.id,
	orientation: config.orientation ?? "horizontal",
	selectedKey: config.selectedKey,
	interaction: Collection.initInteraction(),
	panelFocus: "Unfocused",
})

// MESSAGE

export const Message = defineMessageUnion({
	HoveredTab: { key: Schema.String },
	UnhoveredTab: { key: Schema.String },
	PressedTab: { key: Schema.String },
	FocusedTab: { key: Schema.String },
	BlurredTab: { key: Schema.String },
	PressedNavigationKey: {
		direction: Collection.Direction,
		keys: Schema.Array(Schema.String),
		disabledKeys: Schema.Array(Schema.String),
	},
	ReleasedKey: {},
	FocusedPanel: {},
	BlurredPanel: {},
	CompletedFocusTab: {},
})
export type Message = typeof Message.Type

// COMMAND

const tabId = (model: Model, key: string) => `${model.id}-tab-${key}`
const panelId = (model: Model, key: string) => `${model.id}-tabpanel-${key}`

const FocusTab = Command.define("FocusTab", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusTab],
	execute: ({ elementId }) =>
		Dom.focus(Collection.idSelector(elementId)).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedFocusTab()),
		),
})

// UPDATE

const withInteraction = (
	model: Model,
	next: (interaction: Collection.Interaction) => Collection.Interaction,
) => modifyFields(model, { interaction: next })

const withPanelFocus = (model: Model, panelFocus: PanelFocus) =>
	modifyFields(model, { panelFocus: () => panelFocus })

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		HoveredTab: ({ key }) => ({ model: withInteraction(model, (it) => Collection.hoverItem(it, key)) }),
		UnhoveredTab: ({ key }) => ({
			model: withInteraction(model, (it) => Collection.unhoverItem(it, key)),
		}),
		PressedTab: ({ key }) => ({
			model: modifyFields(
				withInteraction(model, (it) => Collection.useModality(it, "Pointer")),
				{
					selectedKey: () => key,
				},
			),
		}),
		FocusedTab: ({ key }) => ({ model: withInteraction(model, (it) => Collection.focusItem(it, key)) }),
		BlurredTab: ({ key }) => ({ model: withInteraction(model, (it) => Collection.blurItem(it, key)) }),
		PressedNavigationKey: ({ direction, keys, disabledKeys }) =>
			Option.match(
				Collection.moveKey(
					keys,
					model.selectedKey,
					direction,
					(key) => disabledKeys.includes(key),
					true,
				),
				{
					onNone: () => ({ model }),
					onSome: (key) => ({
						model: modifyFields(
							withInteraction(model, (it) => Collection.useModality(it, "Keyboard")),
							{ selectedKey: () => key },
						),
						commands: [FocusTab({ elementId: tabId(model, key) })],
					}),
				},
			),
		ReleasedKey: () => ({
			model: withInteraction(model, (it) => Collection.useModality(it, "Keyboard")),
		}),
		FocusedPanel: () => ({ model: withPanelFocus(model, "Focused") }),
		BlurredPanel: () => ({ model: withPanelFocus(model, "Unfocused") }),
		CompletedFocusTab: () => ({ model }),
	})

// VIEW

export interface TabItem {
	readonly key: string
	readonly content: ReadonlyArray<Html | string>
	readonly isDisabled?: boolean
	readonly className?: string
}

export interface TabPanelItem {
	readonly key: string
	readonly content: ReadonlyArray<Html | string>
	readonly className?: string
}

export type ViewInputs = Readonly<{
	/** TabList `aria-label`; omitted when undefined, like a TabList without one. */
	listLabel?: string
	tabs: ReadonlyArray<TabItem>
	panels: ReadonlyArray<TabPanelItem>
	className?: string
	listClassName?: string
}>

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const { orientation, interaction } = model
	const keys = Array.map(viewInputs.tabs, (tab) => tab.key)
	const isPanelFocused = model.panelFocus === "Focused"
	const isRootFocused = Collection.isWithinFocused(interaction) || isPanelFocused
	const isFocusVisible = interaction.modality !== "Pointer"

	const disabledKeys = Array.map(
		Array.filter(viewInputs.tabs, (tab) => tab.isDisabled === true),
		(tab) => tab.key,
	)
	const navigate = (keyboardKey: string) =>
		Option.map(Collection.directionOfKey(orientation, keyboardKey), (direction) =>
			Message.PressedNavigationKey({ direction, keys, disabledKeys }),
		)

	const tabView = (tab: TabItem): Html => {
		const isSelected = tab.key === model.selectedKey
		const isTabDisabled = tab.isDisabled === true
		const state = Collection.itemState(interaction, tab.key, isTabDisabled)
		const interactive: ReadonlyArray<Attribute<Message>> = isTabDisabled
			? [h.AriaDisabled(true)]
			: [
					h.Tabindex(isSelected ? 0 : -1),
					h.Attribute("data-react-aria-pressable", "true"),
					h.OnMouseEnter(Message.HoveredTab({ key: tab.key })),
					h.OnMouseLeave(Message.UnhoveredTab({ key: tab.key })),
					h.OnPointerDown(() => Option.some(Message.PressedTab({ key: tab.key }))),
					h.OnFocus(Message.FocusedTab({ key: tab.key })),
					h.OnBlur(Message.BlurredTab({ key: tab.key })),
					h.OnKeyDownPreventDefault(navigate),
					h.OnKeyUp(() => Message.ReleasedKey()),
				]
		return h.keyed("div")(
			tab.key,
			[
				h.Class(twMerge(twMerge(...tabsStyles.tab(orientation, false)), tab.className)),
				h.Id(tabId(model, tab.key)),
				h.Role("tab"),
				h.AriaSelected(isSelected),
				...(isSelected ? [h.AriaControls(panelId(model, tab.key))] : []),
				h.Attribute("data-collection", model.id),
				h.Attribute("data-key", tab.key),
				h.Attribute("data-rac", ""),
				h.Attribute("data-slot", "tab"),
				...Collection.stateAttributes(h, { ...state, isSelected, isDisabled: isTabDisabled }),
				...interactive,
			],
			[
				...tab.content,
				...(isSelected
					? [
							h.div([
								h.Class(twMerge(tabsStyles.selectionIndicator(orientation))),
								h.Attribute("data-rac", ""),
								h.Attribute("data-slot", "selected-indicator"),
							]),
						]
					: []),
			],
		)
	}

	const panelView = (panel: TabPanelItem): Html =>
		h.keyed("div")(
			panel.key,
			[
				h.Class(twMerge(twMerge(tabsStyles.tabPanel), panel.className)),
				h.Id(panelId(model, panel.key)),
				h.Role("tabpanel"),
				h.AriaLabelledBy(tabId(model, panel.key)),
				h.Tabindex(0),
				h.Attribute("data-rac", ""),
				h.Attribute("data-slot", "tab-panel"),
				...Collection.stateAttributes(h, {
					isFocused: isPanelFocused,
					isFocusVisible: isPanelFocused && isFocusVisible,
				}),
				h.OnFocus(Message.FocusedPanel()),
				h.OnBlur(Message.BlurredPanel()),
				h.OnKeyUp(() => Message.ReleasedKey()),
			],
			[...panel.content],
		)

	return h.div(
		[
			h.Class(twMerge(twMerge(...tabsStyles.tabs(orientation)), viewInputs.className)),
			h.Attribute("data-orientation", orientation),
			h.Attribute("data-rac", ""),
			...Collection.stateAttributes(h, {
				isFocused: isRootFocused,
				isFocusVisible: isRootFocused && isFocusVisible,
			}),
		],
		[
			h.div(
				[
					h.Class(twMerge([...tabsStyles.tabList(orientation), viewInputs.listClassName])),
					h.Id(model.id),
					h.Role("tablist"),
					...(viewInputs.listLabel === undefined ? [] : [h.AriaLabel(viewInputs.listLabel)]),
					h.AriaOrientation(orientation),
					h.Attribute("data-collection", model.id),
					h.Attribute("data-orientation", orientation),
					h.Attribute("data-rac", ""),
					h.Attribute("data-slot", "tab-list"),
				],
				Array.map(viewInputs.tabs, tabView),
			),
			...Array.map(
				Array.filter(viewInputs.panels, (panel) => panel.key === model.selectedKey),
				panelView,
			),
		],
	)
})
