import { Array, Match, Option, Predicate, Schema, pipe } from "effect"
import type { Attribute, HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"

/**
 * React Aria collection behavior for Foldkit ports: interaction state per keyed item (hover,
 * focus, focus-visible), the `data-*` attributes React Aria renders for it, and roving-focus
 * keyboard navigation for lists, tabs, toolbars and grids.
 */

// MODALITY

/** React Aria's global input modality. `Unknown` (no input yet) counts as keyboard, as in RA. */
export const Modality = Schema.Literals(["Unknown", "Keyboard", "Pointer"])
export type Modality = typeof Modality.Type

export const Orientation = Schema.Literals(["horizontal", "vertical"])
export type Orientation = typeof Orientation.Type

// INTERACTION

export const Interaction = Schema.Struct({
	maybeHoveredKey: Schema.Option(Schema.String),
	maybeFocusedKey: Schema.Option(Schema.String),
	modality: Modality,
})
export type Interaction = typeof Interaction.Type

export const initInteraction = (): Interaction => ({
	maybeHoveredKey: Option.none(),
	maybeFocusedKey: Option.none(),
	modality: "Unknown",
})

export const hoverItem = (interaction: Interaction, key: string): Interaction =>
	modifyFields(interaction, { maybeHoveredKey: () => Option.some(key) })

export const unhoverItem = (interaction: Interaction, key: string): Interaction =>
	modifyFields(interaction, {
		maybeHoveredKey: Option.filter((hoveredKey) => hoveredKey !== key),
	})

export const focusItem = (interaction: Interaction, key: string): Interaction =>
	modifyFields(interaction, { maybeFocusedKey: () => Option.some(key) })

export const blurItem = (interaction: Interaction, key: string): Interaction =>
	modifyFields(interaction, {
		maybeFocusedKey: Option.filter((focusedKey) => focusedKey !== key),
	})

export const useModality = (interaction: Interaction, modality: Modality): Interaction =>
	modifyFields(interaction, { modality: () => modality })

export interface ItemState {
	readonly isHovered: boolean
	readonly isFocused: boolean
	readonly isFocusVisible: boolean
}

/** RA render-prop state for one item. Disabled items are never hovered. */
export const itemState = (interaction: Interaction, key: string, isDisabled = false): ItemState => {
	const isFocused = Option.contains(interaction.maybeFocusedKey, key)
	return {
		isHovered: !isDisabled && Option.contains(interaction.maybeHoveredKey, key),
		isFocused,
		isFocusVisible: isFocused && interaction.modality !== "Pointer",
	}
}

export const isWithinFocused = (interaction: Interaction) => Option.isSome(interaction.maybeFocusedKey)

export const isWithinFocusVisible = (interaction: Interaction) =>
	isWithinFocused(interaction) && interaction.modality !== "Pointer"

// ATTRIBUTES

const flag = <Message>(h: HtmlBuilder<Message>, name: string, isOn: boolean | undefined) =>
	isOn ? [h.DataAttribute(name, "true")] : []

/** The boolean `data-*` state attributes React Aria renders (`data-hovered="true"`, ...). */
export const stateAttributes = <Message>(
	h: HtmlBuilder<Message>,
	state: Partial<ItemState> & Readonly<{ isSelected?: boolean; isDisabled?: boolean; isPressed?: boolean }>,
): ReadonlyArray<Attribute<Message>> => [
	...flag(h, "hovered", state.isHovered),
	...flag(h, "focused", state.isFocused),
	...flag(h, "focus-visible", state.isFocusVisible),
	...flag(h, "pressed", state.isPressed),
	...flag(h, "selected", state.isSelected),
	...flag(h, "disabled", state.isDisabled),
]

// KEYBOARD NAVIGATION

export const Direction = Schema.Literals(["Next", "Previous", "First", "Last"])
export type Direction = typeof Direction.Type

/** Arrow keys follow the orientation; Home and End jump to the ends. */
export const directionOfKey = (orientation: Orientation, key: string): Option.Option<Direction> =>
	Match.value(key).pipe(
		Match.withReturnType<Option.Option<Direction>>(),
		Match.when(orientation === "horizontal" ? "ArrowRight" : "ArrowDown", () => Option.some("Next")),
		Match.when(orientation === "horizontal" ? "ArrowLeft" : "ArrowUp", () => Option.some("Previous")),
		Match.when("Home", () => Option.some("First")),
		Match.when("End", () => Option.some("Last")),
		Match.orElse(() => Option.none()),
	)

/**
 * The next enabled key from `fromKey` in `direction`. `isWrapping` mirrors the delegate:
 * RA tabs wrap around, toolbars and toggle groups stop at the ends.
 */
export const moveKey = (
	keys: ReadonlyArray<string>,
	fromKey: string,
	direction: Direction,
	isDisabled: (key: string) => boolean,
	isWrapping: boolean,
): Option.Option<string> => {
	const enabled = (candidates: ReadonlyArray<string>) =>
		Array.findFirst(candidates, Predicate.not(isDisabled))
	const index = Option.getOrElse(
		Array.findFirstIndex(keys, (key) => key === fromKey),
		() => 0,
	)
	const after = Array.drop(keys, index + 1)
	const before = Array.take(keys, index)

	return Match.value(direction).pipe(
		Match.when("First", () => enabled(keys)),
		Match.when("Last", () => enabled(Array.reverse(keys))),
		Match.when("Next", () =>
			pipe(
				enabled(after),
				Option.orElse(() => (isWrapping ? enabled(before) : Option.none())),
			),
		),
		Match.when("Previous", () =>
			pipe(
				enabled(Array.reverse(before)),
				Option.orElse(() => (isWrapping ? enabled(Array.reverse(after)) : Option.none())),
			),
		),
		Match.exhaustive,
	)
}

/** CSS id selector for a generated element id (ids here are built from safe keys). */
export const idSelector = (id: string) => `#${CSS.escape(id)}`
