import { Array, Match, Option, Schema } from "effect"
import type { Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"

/**
 * Port of `components/ui/command-menu.tsx` (ModalOverlay + Modal + Dialog + Autocomplete with a
 * SearchField and a Menu). Focus stays in the search input; the menu uses virtual focus. The
 * menu opens and closes from the parent (`open`, `close`), as the command palette controls it.
 * The view lives in `command-menu-view.ts`.
 */

// MODEL

export const Item = Schema.Struct({
	key: Schema.String,
	textValue: Schema.String,
	hasDescription: Schema.Boolean,
})
export type Item = typeof Item.Type

export const Section = Schema.Struct({ label: Schema.Option(Schema.String), items: Schema.Array(Item) })
export type Section = typeof Section.Type

export const Modality = Schema.Literals(["Keyboard", "Pointer"])

export const Model = Schema.Struct({
	id: Schema.String,
	sections: Schema.Array(Section),
	isOpen: Schema.Boolean,
	inputValue: Schema.String,
	focusedKey: Schema.Option(Schema.String),
	hoveredKey: Schema.Option(Schema.String),
	modality: Modality,
})
export type Model = typeof Model.Type

export const item = (key: string, textValue: string, hasDescription = false): Item => ({
	key,
	textValue,
	hasDescription,
})

export const section = (label: string | undefined, items: ReadonlyArray<Item>): Section => ({
	label: Option.fromNullishOr(label),
	items,
})

export const init = (config: { readonly id: string; readonly sections: ReadonlyArray<Section> }): Model => ({
	id: config.id,
	sections: config.sections,
	isOpen: false,
	inputValue: "",
	focusedKey: Option.none(),
	hoveredKey: Option.none(),
	modality: "Pointer",
})

// MESSAGE

export const Message = defineMessageUnion({
	ChangedSearch: { value: Schema.String },
	PressedSearchKey: { key: Schema.String },
	HoveredItem: { key: Schema.String },
	UnhoveredItem: { key: Schema.String },
	ClickedItem: { key: Schema.String },
	ClickedEscapeButton: {},
	PressedOutside: {},
	ClickedDismiss: {},
	CompletedPortalCommandMenu: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	SelectedItem: { key: Schema.String },
	Closed: {},
})
export type OutMessage = typeof OutMessage.Type

// IDS

export const searchId = (id: string) => `${id}-search`
export const dialogId = (id: string) => `${id}-dialog`
export const listId = (id: string) => `${id}-list`
export const itemId = (id: string, key: string) => `${id}-item-${key}`

// COLLECTION

const normalized = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()

/** The Autocomplete filter: useFilter({ sensitivity: "base" }).contains on each item's textValue. */
export const visibleSections = (model: Model): ReadonlyArray<Section> =>
	Array.filter(
		Array.map(model.sections, (entry) => ({
			...entry,
			items: Array.filter(entry.items, (candidate) =>
				normalized(candidate.textValue).includes(normalized(model.inputValue)),
			),
		})),
		(entry) => Array.isReadonlyArrayNonEmpty(entry.items),
	)

const visibleKeys = (model: Model): ReadonlyArray<string> =>
	Array.flatMap(visibleSections(model), (entry) => Array.map(entry.items, (candidate) => candidate.key))

/** Menu keyboard navigation wraps (`shouldFocusWrap`). */
const stepKey = (keys: ReadonlyArray<string>, from: Option.Option<string>, direction: 1 | -1) => {
	const first = direction === 1 ? Array.head(keys) : Array.last(keys)
	return Option.match(
		Option.flatMap(from, (key) => Array.findFirstIndex(keys, (candidate) => candidate === key)),
		{
			onNone: () => first,
			onSome: (index) => Option.orElse(Array.get(keys, index + direction), () => first),
		},
	)
}

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const reset = (model: Model): Model =>
	modifyFields(model, {
		inputValue: () => "",
		focusedKey: () => Option.none(),
		hoveredKey: () => Option.none(),
	})

/** A user dismissal: closed, and the parent hears `Closed`. */
const dismissed = (model: Model): UpdateReturn => ({
	model: modifyFields(reset(model), { isOpen: () => false }),
	outMessage: OutMessage.Closed(),
})

/** Opens the command menu from the parent (controlled `isOpen`). */
export const open = (model: Model): Update.Return<Model, Message> => ({ model: opened(model) })

/** Closes the command menu from the parent. */
export const close = (model: Model): Update.Return<Model, Message> => ({ model: closed(model) })

/** The reset, open Model, for parents that do not fold Commands (prefer it to `open(m).model`). */
export const opened = (model: Model): Model => modifyFields(reset(model), { isOpen: () => true })
/** The reset, closed Model (prefer it to `close(m).model`, which drops Commands). */
export const closed = (model: Model): Model => modifyFields(reset(model), { isOpen: () => false })

const activated = (model: Model, key: string): UpdateReturn => ({
	model: modifyFields(reset(model), { isOpen: () => false }),
	outMessage: OutMessage.SelectedItem({ key }),
})

const pressedSearchKey = (model: Model, key: string): UpdateReturn => {
	const moved = (direction: 1 | -1) => ({
		model: modifyFields(model, {
			focusedKey: () => stepKey(visibleKeys(model), model.focusedKey, direction),
			modality: () => "Keyboard" as const,
		}),
	})
	return Match.value(key).pipe(
		Match.when("ArrowDown", () => moved(1)),
		Match.when("ArrowUp", () => moved(-1)),
		Match.when("Enter", () =>
			Option.match(model.focusedKey, {
				onNone: () => ({ model }),
				onSome: (focusedKey) => activated(model, focusedKey),
			}),
		),
		Match.when("Escape", () => (model.inputValue === "" ? dismissed(model) : { model: reset(model) })),
		Match.orElse(() => ({ model })),
	)
}

export const update = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		ChangedSearch: ({ value }) => {
			const typed = modifyFields(model, { inputValue: () => value })
			return {
				model: modifyFields(typed, {
					focusedKey: () => (value === "" ? Option.none() : Array.head(visibleKeys(typed))),
					modality: () => "Pointer" as const,
				}),
			}
		},
		PressedSearchKey: ({ key }) => pressedSearchKey(model, key),
		HoveredItem: ({ key }) => ({
			model: modifyFields(model, {
				focusedKey: () => Option.some(key),
				hoveredKey: () => Option.some(key),
				modality: () => "Pointer" as const,
			}),
		}),
		UnhoveredItem: ({ key }) => ({
			model: modifyFields(model, {
				hoveredKey: (hovered) => Option.filter(hovered, (current) => current !== key),
			}),
		}),
		ClickedItem: ({ key }) => activated(model, key),
		ClickedEscapeButton: () => dismissed(model),
		PressedOutside: () => dismissed(model),
		ClickedDismiss: () => dismissed(model),
		CompletedPortalCommandMenu: () => ({ model }),
	})
