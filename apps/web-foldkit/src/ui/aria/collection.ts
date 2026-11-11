import { Match, Option, Schema } from "effect"

/**
 * React Aria collection behavior for Foldkit ports: arrow-key directions for roving-focus keyboard
 * navigation in lists, tabs, toolbars and grids, and id selectors for their items.
 */

export const Orientation = Schema.Literals(["horizontal", "vertical"])
export type Orientation = typeof Orientation.Type

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
 * Attribute selector for an id that may hold CSS-significant characters (a `#hex` value). Pure, so
 * views can build it without `CSS.escape`.
 */
export const idAttributeSelector = (id: string) => `[id="${id.replace(/["\\]/g, "\\$&")}"]`
