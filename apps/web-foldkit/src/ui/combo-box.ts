import { Array, Effect, Match, Option, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { announce } from "./aria/announcer"

/**
 * Port of `components/ui/combo-box.tsx` (React Aria ComboBox, menuTrigger "input") with string
 * items. Focus stays in the input; the list uses virtual focus. The view is `combo-box-view.ts`.
 */

// MODEL

export const Item = Schema.Struct({ key: Schema.String, label: Schema.String, isDisabled: Schema.Boolean })
export type Item = typeof Item.Type

export const Modality = Schema.Literals(["Keyboard", "Pointer"])

export const Popup = Schema.Union([
	Schema.TaggedStruct("Closed", {}),
	Schema.TaggedStruct("Open", {
		focusedKey: Schema.Option(Schema.String),
		hoveredKey: Schema.Option(Schema.String),
		modality: Modality,
		/** Opened from the button or the arrow keys: every item, not only the filtered ones. */
		isShowingAll: Schema.Boolean,
	}),
])
type Open = Extract<typeof Popup.Type, { _tag: "Open" }>

export const Model = Schema.Struct({
	id: Schema.String,
	items: Schema.Array(Item),
	selectedKey: Schema.Option(Schema.String),
	inputValue: Schema.String,
	isFocused: Schema.Boolean,
	popup: Popup,
	/** Resolved by the caller at init, so `update` never reads the host platform (VoiceOver extras). */
	isAppleDevice: Schema.Boolean,
})
export type Model = typeof Model.Type

export const item = (key: string, label: string, isDisabled = false): Item => ({ key, label, isDisabled })

const labelOf = (items: ReadonlyArray<Item>, key: Option.Option<string>): string =>
	Option.getOrElse(
		Option.map(
			Option.flatMap(key, (selected) =>
				Array.findFirst(items, (candidate) => candidate.key === selected),
			),
			(found) => found.label,
		),
		() => "",
	)

export const init = (config: {
	readonly id: string
	readonly items: ReadonlyArray<Item>
	readonly selectedKey?: string
	readonly isAppleDevice: boolean
}): Model => {
	const selectedKey = Option.fromNullishOr(config.selectedKey)
	return {
		id: config.id,
		items: config.items,
		selectedKey,
		inputValue: labelOf(config.items, selectedKey),
		isFocused: false,
		popup: { _tag: "Closed" },
		isAppleDevice: config.isAppleDevice,
	}
}

// MESSAGE

export const Message = defineMessageUnion({
	ChangedInput: { value: Schema.String },
	FocusedInput: {},
	BlurredInput: {},
	PressedInputKey: { key: Schema.String },
	PressedButton: {},
	HoveredOption: { key: Schema.String },
	UnhoveredOption: { key: Schema.String },
	ClickedOption: { key: Schema.String },
	CompletedFocusInput: {},
	CompletedPortalComboBox: {},
	CompletedAnnounce: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	ChangedSelection: { key: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// IDS

export const inputId = (id: string) => `${id}-input`
export const labelId = (id: string) => `${id}-label`
export const buttonId = (id: string) => `${id}-button`
export const listboxId = (id: string) => `${id}-listbox`
export const optionId = (id: string, key: string) => `${listboxId(id)}-option-${key}`
export const optionLabelId = (id: string, key: string) => `${id}-option-label-${key}`

// COLLECTION

const normalized = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()

/** useFilter({ sensitivity: "base" }).contains */
const contains = (text: string, search: string) => normalized(text).includes(normalized(search))

export const visibleItems = (model: Model, open: Open): ReadonlyArray<Item> =>
	open.isShowingAll
		? model.items
		: Array.filter(model.items, (candidate) => contains(candidate.label, model.inputValue))

/** ListKeyboardDelegate without wrapping. */
const stepKey = (items: ReadonlyArray<Item>, from: Option.Option<string>, direction: 1 | -1) => {
	const keys = Array.map(
		Array.filter(items, (candidate) => !candidate.isDisabled),
		(candidate) => candidate.key,
	)
	return Option.match(
		Option.flatMap(from, (key) => Array.findFirstIndex(keys, (candidate) => candidate === key)),
		{
			onNone: () => (direction === 1 ? Array.head(keys) : Array.last(keys)),
			onSome: (index) =>
				Option.orElse(Array.get(keys, index + direction), () => Array.get(keys, index)),
		},
	)
}

// COMMAND

export const FocusComboBoxInput = Command.define("FocusComboBoxInput", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusInput],
	execute: ({ elementId }) =>
		Dom.focus(`#${CSS.escape(elementId)}`, { preventScroll: true }).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedFocusInput()),
		),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const withPopup = (model: Model, popup: Model["popup"]): Model => modifyFields(model, { popup: () => popup })

const closedAndReverted = (model: Model): Model =>
	modifyFields(withPopup(model, { _tag: "Closed" }), {
		inputValue: () => labelOf(model.items, model.selectedKey),
	})

const openedAll = (model: Model, strategy: "Selected" | "First" | "Last"): Model => {
	const fallback =
		strategy === "Last" ? stepKey(model.items, Option.none(), -1) : stepKey(model.items, Option.none(), 1)
	const focusedKey =
		strategy === "Selected" ? model.selectedKey : Option.orElse(model.selectedKey, () => fallback)
	return withPopup(model, {
		_tag: "Open",
		focusedKey,
		hoveredKey: Option.none(),
		modality: strategy === "Selected" ? "Pointer" : "Keyboard",
		isShowingAll: true,
	})
}

const selected = (model: Model, key: string): UpdateReturn => ({
	model: modifyFields(withPopup(model, { _tag: "Closed" }), {
		selectedKey: () => Option.some(key),
		inputValue: () => labelOf(model.items, Option.some(key)),
	}),
	outMessage: OutMessage.ChangedSelection({ key }),
})

const pressedInputKey = (model: Model, key: string): UpdateReturn => {
	if (model.popup._tag === "Closed")
		return Match.value(key).pipe(
			Match.when("ArrowDown", () => ({ model: openedAll(model, "First") })),
			Match.when("ArrowUp", () => ({ model: openedAll(model, "Last") })),
			Match.when("Escape", () => ({ model: closedAndReverted(model) })),
			Match.orElse(() => ({ model })),
		)
	const open = model.popup
	const items = visibleItems(model, open)
	const moved = (direction: 1 | -1) => ({
		model: withPopup(model, {
			...open,
			modality: "Keyboard",
			focusedKey: stepKey(items, open.focusedKey, direction),
		}),
	})
	return Match.value(key).pipe(
		Match.when("ArrowDown", () => moved(1)),
		Match.when("ArrowUp", () => moved(-1)),
		Match.when("Escape", () => ({ model: closedAndReverted(model) })),
		Match.when("Enter", () =>
			Option.match(open.focusedKey, {
				onNone: () => ({ model: closedAndReverted(model) }),
				onSome: (focusedKey) => selected(model, focusedKey),
			}),
		),
		Match.orElse(() => ({ model })),
	)
}

export const AnnounceComboBox = Command.define("AnnounceComboBox", {
	args: { message: Schema.String },
	messages: [Message.CompletedAnnounce],
	execute: ({ message }) =>
		Effect.sync(() => announce(message)).pipe(Effect.as(Message.CompletedAnnounce())),
})

const countAnnouncement = (count: number) => `${count} ${count === 1 ? "option" : "options"} available.`

/** useComboBox's live announcements: option count, then (on Apple devices) focus and selection. */
const announcementsFor = (previous: Model, next: Model): ReadonlyArray<string> => {
	if (next.popup._tag !== "Open") {
		const isSelectionNew = Option.exists(
			next.selectedKey,
			(key) => !Option.contains(previous.selectedKey, key),
		)
		return next.isAppleDevice && next.isFocused && isSelectionNew
			? [`${labelOf(next.items, next.selectedKey)}, selected`]
			: []
	}
	const open = next.popup
	const count = visibleItems(next, open).length
	const previousCount =
		previous.popup._tag === "Open" ? visibleItems(previous, previous.popup).length : count
	const didOpen = previous.popup._tag === "Closed" && (Option.isNone(open.focusedKey) || next.isAppleDevice)
	const previousFocus = previous.popup._tag === "Open" ? previous.popup.focusedKey : Option.none<string>()
	const focusAnnouncement = Option.filter(
		open.focusedKey,
		(key) => next.isAppleDevice && !Option.contains(previousFocus, key),
	).pipe(
		Option.map(
			(key) =>
				`${labelOf(next.items, Option.some(key))}${Option.contains(next.selectedKey, key) ? ", selected" : ""}`,
		),
	)
	return [
		...(didOpen || count !== previousCount ? [countAnnouncement(count)] : []),
		...Option.toArray(focusAnnouncement),
	]
}

export const update = (model: Model, message: Message): UpdateReturn => {
	const result = updateComboBox(model, message)
	// NOTE: pressing an option moves the virtual focus to it before the selection lands.
	const pressedFocus =
		message._tag === "ClickedOption" &&
		model.isAppleDevice &&
		model.popup._tag === "Open" &&
		!Option.contains(model.popup.focusedKey, message.key)
			? [
					`${labelOf(model.items, Option.some(message.key))}${Option.contains(model.selectedKey, message.key) ? ", selected" : ""}`,
				]
			: []
	const announcements = Array.map([...pressedFocus, ...announcementsFor(model, result.model)], (text) =>
		AnnounceComboBox({ message: text }),
	)
	return Array.isReadonlyArrayNonEmpty(announcements)
		? { ...result, commands: [...(result.commands ?? []), ...announcements] }
		: result
}

const updateComboBox = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		ChangedInput: ({ value }) => {
			const typed = modifyFields(model, { inputValue: () => value })
			const matches = Array.filter(model.items, (candidate) => contains(candidate.label, value))
			return {
				model: Array.isReadonlyArrayNonEmpty(matches)
					? withPopup(typed, {
							_tag: "Open",
							focusedKey: Option.none(),
							hoveredKey: Option.none(),
							modality: "Keyboard",
							isShowingAll: false,
						})
					: withPopup(typed, { _tag: "Closed" }),
			}
		},
		FocusedInput: () => ({ model: modifyFields(model, { isFocused: () => true }) }),
		BlurredInput: () => ({ model: modifyFields(closedAndReverted(model), { isFocused: () => false }) }),
		PressedInputKey: ({ key }) => pressedInputKey(model, key),
		PressedButton: () => ({
			model: model.popup._tag === "Open" ? closedAndReverted(model) : openedAll(model, "Selected"),
			commands: [FocusComboBoxInput({ elementId: inputId(model.id) })],
		}),
		HoveredOption: ({ key }) =>
			model.popup._tag === "Open"
				? { model: withPopup(model, { ...model.popup, hoveredKey: Option.some(key) }) }
				: { model },
		UnhoveredOption: ({ key }) =>
			model.popup._tag === "Open"
				? {
						model: withPopup(model, {
							...model.popup,
							hoveredKey: Option.filter(model.popup.hoveredKey, (hovered) => hovered !== key),
						}),
					}
				: { model },
		ClickedOption: ({ key }) =>
			Array.some(model.items, (candidate) => candidate.key === key && !candidate.isDisabled)
				? selected(model, key)
				: { model },
		CompletedFocusInput: () => ({ model }),
		CompletedPortalComboBox: () => ({ model }),
		CompletedAnnounce: () => ({ model }),
	})
