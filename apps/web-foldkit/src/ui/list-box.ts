import { Array, Duration, Effect, Option, Schema, Stream } from "effect"
import { Command, Subscription, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { scrollIntoView } from "./aria/scroll"

/**
 * Port of `components/ui/list-box.tsx` (React Aria ListBox, standalone): selection, roving focus,
 * typeahead, hover and press. Items render as ListBoxItem or DropdownItem (`dropdown.tsx`).
 * The view lives in `list-box-view.ts`.
 */

// MODEL

export const Intent = Schema.Literals(["danger", "warning"])
export type Intent = typeof Intent.Type

export const Item = Schema.Struct({
	key: Schema.String,
	textValue: Schema.String,
	isDisabled: Schema.Boolean,
	/** `Dropdown` renders DropdownItem (check indicator, intents); `ListBox` renders ListBoxItem. */
	flavor: Schema.Literals(["ListBox", "Dropdown"]),
	intent: Schema.NullOr(Intent),
	hasDescription: Schema.Boolean,
})
export type Item = typeof Item.Type

export const Entry = Schema.Union([
	Schema.TaggedStruct("Item", { item: Item }),
	Schema.TaggedStruct("Section", {
		title: Schema.NullOr(Schema.String),
		/** `ListBoxSection` adds its own classes on top of DropdownSection's. */
		isListBoxSection: Schema.Boolean,
		items: Schema.Array(Item),
	}),
	Schema.TaggedStruct("Separator", {}),
])
export type Entry = typeof Entry.Type

export const SelectionMode = Schema.Literals(["none", "single", "multiple"])
export type SelectionMode = typeof SelectionMode.Type

export const Modality = Schema.Literals(["Unknown", "Keyboard", "Pointer"])

export const Model = Schema.Struct({
	id: Schema.String,
	entries: Schema.Array(Entry),
	selectionMode: SelectionMode,
	selectedKeys: Schema.Array(Schema.String),
	/** The selection manager's focused key; it outlives focus leaving the list. */
	focusedKey: Schema.Option(Schema.String),
	isFocusWithin: Schema.Boolean,
	hoveredKey: Schema.Option(Schema.String),
	pressedKey: Schema.Option(Schema.String),
	modality: Modality,
	search: Schema.String,
})
export type Model = typeof Model.Type

export const item = (
	key: string,
	textValue: string,
	options: Partial<Omit<Item, "key" | "textValue">> = {},
): Item => ({
	key,
	textValue,
	isDisabled: options.isDisabled ?? false,
	flavor: options.flavor ?? "ListBox",
	intent: options.intent ?? null,
	hasDescription: options.hasDescription ?? false,
})

export const entry = (value: Item): Entry => ({ _tag: "Item", item: value })
export const section = (
	title: string | null,
	items: ReadonlyArray<Item>,
	options: { readonly isListBoxSection?: boolean } = {},
): Entry => ({ _tag: "Section", title, isListBoxSection: options.isListBoxSection ?? true, items })
export const separator: Entry = { _tag: "Separator" }

export const init = (config: {
	readonly id: string
	readonly entries: ReadonlyArray<Entry>
	readonly selectionMode?: SelectionMode
	readonly selectedKeys?: ReadonlyArray<string>
}): Model => ({
	id: config.id,
	entries: config.entries,
	selectionMode: config.selectionMode ?? "none",
	selectedKeys: config.selectedKeys ?? [],
	focusedKey: Option.none(),
	isFocusWithin: false,
	hoveredKey: Option.none(),
	pressedKey: Option.none(),
	modality: "Unknown",
	search: "",
})

// IDS

export const listId = (id: string) => `${id}-listbox`
export const optionId = (id: string, key: string) => `${listId(id)}-option-${key}`
export const labelId = (id: string, key: string) => `${optionId(id, key)}-label`
export const descriptionId = (id: string, key: string) => `${optionId(id, key)}-description`

// COLLECTION

export const items = (model: Model): ReadonlyArray<Item> =>
	Array.flatMap(model.entries, (current) =>
		current._tag === "Item" ? [current.item] : current._tag === "Section" ? current.items : [],
	)

const enabledKeys = (model: Model) =>
	Array.map(
		Array.filter(items(model), (candidate) => !candidate.isDisabled),
		(candidate) => candidate.key,
	)

const findItem = (model: Model, key: string) =>
	Array.findFirst(items(model), (candidate) => candidate.key === key)

/** ListKeyboardDelegate without wrapping, skipping disabled items. */
const stepKey = (model: Model, direction: 1 | -1): Option.Option<string> => {
	const keys = enabledKeys(model)
	return Option.match(
		Option.flatMap(model.focusedKey, (key) =>
			Array.findFirstIndex(keys, (candidate) => candidate === key),
		),
		{
			onNone: () => (direction === 1 ? Array.head(keys) : Array.last(keys)),
			onSome: (index) =>
				Option.orElse(Array.get(keys, index + direction), () => Array.get(keys, index)),
		},
	)
}

/** getKeyForSearch: from the focused item to the end, then from the start. */
const searchKey = (model: Model, search: string): Option.Option<string> => {
	const all = items(model)
	const start = Option.getOrElse(
		Option.flatMap(model.focusedKey, (key) =>
			Array.findFirstIndex(all, (candidate) => candidate.key === key),
		),
		() => 0,
	)
	const ordered = [...all.slice(start), ...all.slice(0, start)]
	return Option.map(
		Array.findFirst(
			ordered,
			(candidate) =>
				!candidate.isDisabled &&
				candidate.textValue.slice(0, search.length).toLowerCase() === search.toLowerCase(),
		),
		(found) => found.key,
	)
}

// MESSAGE

export const Message = defineMessageUnion({
	FocusedList: { isFromAfter: Schema.Boolean },
	FocusedItem: { key: Schema.String },
	LeftList: {},
	HoveredItem: { key: Schema.String },
	UnhoveredItem: { key: Schema.String },
	PressedItem: { key: Schema.String, button: Schema.Number },
	ReleasedPointer: {},
	PressedKey: { key: Schema.String, isModified: Schema.Boolean },
	ReleasedKey: { key: Schema.String },
	CompletedFocusItem: {},
	CompletedWaitForTypeaheadReset: { search: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	ChangedSelection: { keys: Schema.Array(Schema.String) },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const FocusListBoxItem = Command.define("FocusListBoxItem", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusItem],
	execute: ({ elementId }) =>
		Dom.focus(`#${CSS.escape(elementId)}`, { preventScroll: true }).pipe(
			Effect.ignore,
			// useSelectableCollection scrolls the focused option into the list's scroll port.
			Effect.andThen(
				Effect.sync(() => {
					const element = document.getElementById(elementId)
					const list = element?.closest("[role=listbox]")
					if (element && list instanceof HTMLElement) scrollIntoView(list, element)
				}),
			),
			Effect.as(Message.CompletedFocusItem()),
		),
})

export const WaitForListBoxTypeaheadReset = Command.define("WaitForListBoxTypeaheadReset", {
	args: { search: Schema.String },
	messages: [Message.CompletedWaitForTypeaheadReset],
	execute: ({ search }) =>
		Effect.sleep(Duration.millis(1000)).pipe(
			Effect.as(Message.CompletedWaitForTypeaheadReset({ search })),
		),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const moveFocus = (model: Model, key: Option.Option<string>): UpdateReturn =>
	Option.match(key, {
		onNone: () => ({ model }),
		onSome: (found) => ({
			model: modifyFields(model, { focusedKey: () => Option.some(found) }),
			commands: [FocusListBoxItem({ elementId: optionId(model.id, found) })],
		}),
	})

/** toggleSelection with the default `toggle` behavior; empty selection is allowed. */
const toggle = (model: Model, key: string): UpdateReturn => {
	if (model.selectionMode === "none" || Option.exists(findItem(model, key), (found) => found.isDisabled))
		return { model }
	const isSelected = model.selectedKeys.includes(key)
	const selectedKeys =
		model.selectionMode === "single"
			? isSelected
				? []
				: [key]
			: isSelected
				? model.selectedKeys.filter((selected) => selected !== key)
				: [...model.selectedKeys, key]
	return {
		model: modifyFields(model, { selectedKeys: () => selectedKeys }),
		outMessage: OutMessage.ChangedSelection({ keys: selectedKeys }),
	}
}

const firstSelected = (model: Model, fromEnd: boolean) => {
	const selected = Array.filter(items(model), (candidate) => model.selectedKeys.includes(candidate.key))
	const keys = enabledKeys(model)
	return fromEnd
		? Option.orElse(
				Option.map(Array.last(selected), (found) => found.key),
				() => Array.last(keys),
			)
		: Option.orElse(
				Option.map(Array.head(selected), (found) => found.key),
				() => Array.head(keys),
			)
}

const isPressKey = (key: string) => key === "Enter" || key === " "

export const update = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		FocusedList: ({ isFromAfter }) => {
			const focused = modifyFields(model, { isFocusWithin: () => true })
			return Option.isSome(model.focusedKey)
				? moveFocus(focused, model.focusedKey)
				: moveFocus(focused, firstSelected(model, isFromAfter))
		},
		FocusedItem: ({ key }) => ({
			model: modifyFields(model, { isFocusWithin: () => true, focusedKey: () => Option.some(key) }),
		}),
		LeftList: () => ({ model: modifyFields(model, { isFocusWithin: () => false }) }),
		HoveredItem: ({ key }) => ({ model: modifyFields(model, { hoveredKey: () => Option.some(key) }) }),
		UnhoveredItem: ({ key }) => ({
			model: modifyFields(model, { hoveredKey: Option.filter((hovered) => hovered !== key) }),
		}),
		PressedItem: ({ key, button }) => {
			if (button !== 0 || Option.exists(findItem(model, key), (found) => found.isDisabled))
				return { model }
			const pressed = modifyFields(model, {
				modality: () => "Pointer",
				pressedKey: () => Option.some(key),
				focusedKey: () => Option.some(key),
				isFocusWithin: () => true,
			})
			const selected = toggle(pressed, key)
			return { ...selected, commands: [FocusListBoxItem({ elementId: optionId(model.id, key) })] }
		},
		ReleasedPointer: () => ({ model: modifyFields(model, { pressedKey: () => Option.none() }) }),
		PressedKey: ({ key, isModified }) => {
			const keyed = modifyFields(model, { modality: () => "Keyboard" })
			if (key === "ArrowDown") return moveFocus(keyed, stepKey(keyed, 1))
			if (key === "ArrowUp") return moveFocus(keyed, stepKey(keyed, -1))
			if (key === "Home") return moveFocus(keyed, Array.head(enabledKeys(keyed)))
			if (key === "End") return moveFocus(keyed, Array.last(enabledKeys(keyed)))
			// Space types into an active typeahead search instead of selecting.
			if (key === "Enter" || (key === " " && keyed.search === "")) {
				return Option.match(keyed.focusedKey, {
					onNone: () => ({ model: keyed }),
					onSome: (focused) =>
						toggle(modifyFields(keyed, { pressedKey: () => Option.some(focused) }), focused),
				})
			}
			if (key.length !== 1 || isModified) return { model: keyed }
			const search = keyed.search + key
			const searched = moveFocus(
				modifyFields(keyed, { search: () => search }),
				searchKey(keyed, search),
			)
			return {
				...searched,
				commands: [...(searched.commands ?? []), WaitForListBoxTypeaheadReset({ search })],
			}
		},
		ReleasedKey: ({ key }) =>
			isPressKey(key) ? { model: modifyFields(model, { pressedKey: () => Option.none() }) } : { model },
		CompletedFocusItem: () => ({ model }),
		CompletedWaitForTypeaheadReset: ({ search }) =>
			search === model.search ? { model: modifyFields(model, { search: () => "" }) } : { model },
	})

// SUBSCRIPTION

/** usePress ends a pointer press on pointerup anywhere; always subscribed, so presses never restart it. */
export const subscriptions = Subscription.make<Model, Message>()(() => ({
	pointerRelease: Subscription.persistentEntry(
		Stream.suspend(() =>
			Dom.streamFromEvent({
				target: document,
				type: "pointerup",
				mapEvent: () => Message.ReleasedPointer(),
				options: { capture: true },
			}),
		),
	),
}))
