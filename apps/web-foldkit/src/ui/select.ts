import { Array, Duration, Effect, Match, Option, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"

/**
 * Port of `components/ui/select.tsx` (React Aria Select + ListBox in a Popover) with string items,
 * as the legacy SelectItem renders them. The view lives in `select-view.ts`.
 */

// MODEL

export const Item = Schema.Struct({ key: Schema.String, label: Schema.String, isDisabled: Schema.Boolean })
export type Item = typeof Item.Type

export const Modality = Schema.Literals(["Keyboard", "Pointer"])
export type Modality = typeof Modality.Type

export const Popup = Schema.Union([
	Schema.TaggedStruct("Closed", {}),
	Schema.TaggedStruct("Open", {
		focusedKey: Schema.Option(Schema.String),
		hoveredKey: Schema.Option(Schema.String),
		modality: Modality,
		search: Schema.String,
	}),
])
type Open = Extract<typeof Popup.Type, { _tag: "Open" }>

export const Model = Schema.Struct({
	id: Schema.String,
	items: Schema.Array(Item),
	selectedKey: Schema.Option(Schema.String),
	isDisabled: Schema.Boolean,
	isTriggerFocused: Schema.Boolean,
	popup: Popup,
})
export type Model = typeof Model.Type

export const item = (key: string, label: string, isDisabled = false): Item => ({ key, label, isDisabled })

export const init = (config: {
	readonly id: string
	readonly items: ReadonlyArray<Item>
	readonly selectedKey?: string
	readonly isDisabled?: boolean
}): Model => ({
	id: config.id,
	items: config.items,
	selectedKey: Option.fromNullishOr(config.selectedKey),
	isDisabled: config.isDisabled ?? false,
	isTriggerFocused: false,
	popup: { _tag: "Closed" },
})

// MESSAGE

export const Message = defineMessageUnion({
	PressedTrigger: { pointerType: Schema.String },
	PressedTriggerKey: { key: Schema.String },
	FocusedTrigger: {},
	BlurredTrigger: {},
	PressedListKey: { key: Schema.String, isModified: Schema.Boolean },
	HoveredOption: { key: Schema.String },
	UnhoveredOption: { key: Schema.String },
	ClickedOption: { key: Schema.String },
	PressedOutside: {},
	ClickedDismiss: {},
	CompletedFocusElement: {},
	CompletedWaitForTypeaheadReset: { search: Schema.String },
	CompletedPortalSelect: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	ChangedSelection: { key: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// IDS

export const triggerId = (id: string) => `${id}-trigger`
export const labelId = (id: string) => `${id}-label`
export const valueId = (id: string) => `${id}-value`
export const listboxId = (id: string) => `${id}-listbox`
export const optionId = (id: string, key: string) => `${listboxId(id)}-option-${key}`
export const optionLabelId = (id: string, key: string) => `${id}-option-label-${key}`

// COLLECTION

const enabledKeys = (model: Model): ReadonlyArray<string> =>
	Array.map(
		Array.filter(model.items, (candidate) => !candidate.isDisabled),
		(candidate) => candidate.key,
	)

/** ListKeyboardDelegate without wrapping (ListBox's `shouldFocusWrap` is false). */
const stepKey = (model: Model, from: Option.Option<string>, direction: 1 | -1): Option.Option<string> => {
	const keys = enabledKeys(model)
	return Option.match(
		Option.flatMap(from, (key) => Array.findFirstIndex(keys, (candidate) => candidate === key)),
		{
			onNone: () => (direction === 1 ? Array.head(keys) : Array.last(keys)),
			onSome: (index) =>
				Option.orElse(Array.get(keys, index + direction), () => Array.get(keys, index)),
		},
	)
}

const searchKey = (model: Model, search: string, from: Option.Option<string>): Option.Option<string> => {
	const matches = (candidate: Item) =>
		!candidate.isDisabled &&
		candidate.label.slice(0, search.length).toLowerCase() === search.toLowerCase()
	const start = Option.getOrElse(
		Option.flatMap(from, (key) =>
			Array.findFirstIndex(model.items, (candidate) => candidate.key === key),
		),
		() => 0,
	)
	return Option.map(
		Option.orElse(Array.findFirst(Array.drop(model.items, start), matches), () =>
			Array.findFirst(model.items, matches),
		),
		(found) => found.key,
	)
}

// COMMAND

export const FocusElement = Command.define("FocusSelectElement", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusElement],
	execute: ({ elementId }) =>
		Dom.focus(`#${CSS.escape(elementId)}`, { preventScroll: true }).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedFocusElement()),
		),
})

const TYPEAHEAD_RESET = Duration.millis(1000)

export const WaitForTypeaheadReset = Command.define("WaitForSelectTypeaheadReset", {
	args: { search: Schema.String },
	messages: [Message.CompletedWaitForTypeaheadReset],
	execute: ({ search }) =>
		Effect.sleep(TYPEAHEAD_RESET).pipe(Effect.as(Message.CompletedWaitForTypeaheadReset({ search }))),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const withOpen = (model: Model, open: Open, isFocusMoved: boolean): UpdateReturn => {
	const nextModel = modifyFields(model, { popup: () => open })
	const commands = Option.match(open.focusedKey, {
		onNone: () => [],
		onSome: (key) => [FocusElement({ elementId: optionId(model.id, key) })],
	})
	return isFocusMoved ? { model: nextModel, commands } : { model: nextModel }
}

/** The portal Mount moves the initial focus, since the trigger's tree is inert until it runs. */
const opened = (model: Model, strategy: "None" | "First" | "Last", modality: Modality): UpdateReturn => {
	if (model.isDisabled) return { model }
	const strategyKey =
		strategy === "None"
			? Option.none<string>()
			: stepKey(model, Option.none(), strategy === "First" ? 1 : -1)
	const focusedKey = Option.orElse(model.selectedKey, () => strategyKey)
	return withOpen(
		model,
		{ _tag: "Open", focusedKey, hoveredKey: Option.none(), modality, search: "" },
		false,
	)
}

const closed = (model: Model): Model => modifyFields(model, { popup: () => ({ _tag: "Closed" as const }) })

const selected = (model: Model, key: string): UpdateReturn => ({
	model: modifyFields(closed(model), { selectedKey: () => Option.some(key) }),
	outMessage: OutMessage.ChangedSelection({ key }),
})

const pressedTriggerKey = (model: Model, key: string): UpdateReturn =>
	Match.value(key).pipe(
		Match.when(
			(pressed) => pressed === "Enter" || pressed === " " || pressed === "ArrowDown",
			() => opened(model, "First", "Keyboard"),
		),
		Match.when("ArrowUp", () => opened(model, "Last", "Keyboard")),
		Match.when(
			(pressed) => pressed === "ArrowLeft" || pressed === "ArrowRight",
			(pressed) =>
				Option.match(stepKey(model, model.selectedKey, pressed === "ArrowRight" ? 1 : -1), {
					onNone: () => ({ model }),
					onSome: (next) => ({
						model: modifyFields(model, { selectedKey: () => Option.some(next) }),
						outMessage: OutMessage.ChangedSelection({ key: next }),
					}),
				}),
		),
		Match.orElse(() => ({ model })),
	)

const pressedListKey = (model: Model, open: Open, key: string, isModified: boolean): UpdateReturn => {
	const keyboard: Open = { ...open, modality: "Keyboard" }
	const focused = (next: Option.Option<string>) => withOpen(model, { ...keyboard, focusedKey: next }, true)
	return Match.value(key).pipe(
		Match.when("ArrowDown", () => focused(stepKey(model, open.focusedKey, 1))),
		Match.when("ArrowUp", () => focused(stepKey(model, open.focusedKey, -1))),
		Match.when("Home", () => focused(stepKey(model, Option.none(), 1))),
		Match.when("End", () => focused(stepKey(model, Option.none(), -1))),
		Match.when("Escape", () => ({ model: closed(model) })),
		Match.when(
			(pressed) => pressed === "Enter" || (pressed === " " && open.search === ""),
			() =>
				Option.match(open.focusedKey, {
					onNone: () => ({ model }),
					onSome: (focusedKey) => selected(model, focusedKey),
				}),
		),
		Match.orElse(() => {
			if (key.length !== 1 || isModified) return { model }
			const search = `${open.search}${key}`
			const searched = withOpen(
				model,
				{
					...keyboard,
					search,
					focusedKey: Option.orElse(
						searchKey(model, search, open.focusedKey),
						() => open.focusedKey,
					),
				},
				true,
			)
			return {
				model: searched.model,
				commands: [...(searched.commands ?? []), WaitForTypeaheadReset({ search })],
			}
		}),
	)
}

export const update = (model: Model, message: Message): UpdateReturn => {
	const ifOpen = (onOpen: (open: Open) => UpdateReturn): UpdateReturn =>
		model.popup._tag === "Open" ? onOpen(model.popup) : { model }

	return Message.match<UpdateReturn>(message, {
		PressedTrigger: ({ pointerType }) =>
			model.popup._tag === "Closed" && pointerType !== "touch"
				? opened(model, "None", "Pointer")
				: { model },
		PressedTriggerKey: ({ key }) =>
			model.popup._tag === "Closed" ? pressedTriggerKey(model, key) : { model },
		FocusedTrigger: () => ({ model: modifyFields(model, { isTriggerFocused: () => true }) }),
		BlurredTrigger: () => ({ model: modifyFields(model, { isTriggerFocused: () => false }) }),
		PressedListKey: ({ key, isModified }) =>
			ifOpen((open) => pressedListKey(model, open, key, isModified)),
		HoveredOption: ({ key }) =>
			ifOpen((open) => {
				const isEnabled = Array.some(
					model.items,
					(candidate) => candidate.key === key && !candidate.isDisabled,
				)
				const pointer: Open = { ...open, modality: "Pointer", hoveredKey: Option.some(key) }
				return isEnabled
					? withOpen(model, { ...pointer, focusedKey: Option.some(key) }, true)
					: withOpen(model, pointer, false)
			}),
		UnhoveredOption: ({ key }) =>
			ifOpen((open) =>
				withOpen(
					model,
					{ ...open, hoveredKey: Option.filter(open.hoveredKey, (hovered) => hovered !== key) },
					false,
				),
			),
		ClickedOption: ({ key }) =>
			ifOpen(() =>
				Array.some(model.items, (candidate) => candidate.key === key && !candidate.isDisabled)
					? selected(model, key)
					: { model },
			),
		PressedOutside: () => ({ model: closed(model) }),
		ClickedDismiss: () => ({ model: closed(model) }),
		CompletedFocusElement: () => ({ model }),
		CompletedWaitForTypeaheadReset: ({ search }) =>
			ifOpen((open) =>
				open.search === search ? withOpen(model, { ...open, search: "" }, false) : { model },
			),
		CompletedPortalSelect: () => ({ model }),
	})
}
