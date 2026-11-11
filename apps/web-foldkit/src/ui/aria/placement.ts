import type { Placement as AnchorPlacement } from "@foldkit/ui/anchor"
import { Schema } from "effect"

/** The overlay placements (React Aria's names) as a Schema, so Mount args and Models carry them. */
const placements = [
	"bottom",
	"bottom left",
	"bottom right",
	"bottom start",
	"bottom end",
	"top",
	"top left",
	"top right",
	"top start",
	"top end",
	"left",
	"left top",
	"left bottom",
	"start",
	"start top",
	"start bottom",
	"right",
	"right top",
	"right bottom",
	"end",
	"end top",
	"end bottom",
] as const

export const Placement = Schema.Literals(placements)
export type Placement = typeof Placement.Type

/**
 * The Floating UI placement `@foldkit/ui`'s Anchor takes for a React Aria placement. The cross
 * axis maps to an alignment (`top left` → `top-start`, `left bottom` → `left-end`), and the logical
 * sides read left-to-right (`start` → `left`, `end` → `right`).
 */
const ANCHOR_PLACEMENTS: Readonly<Record<Placement, AnchorPlacement>> = {
	bottom: "bottom",
	"bottom left": "bottom-start",
	"bottom right": "bottom-end",
	"bottom start": "bottom-start",
	"bottom end": "bottom-end",
	top: "top",
	"top left": "top-start",
	"top right": "top-end",
	"top start": "top-start",
	"top end": "top-end",
	left: "left",
	"left top": "left-start",
	"left bottom": "left-end",
	start: "left",
	"start top": "left-start",
	"start bottom": "left-end",
	right: "right",
	"right top": "right-start",
	"right bottom": "right-end",
	end: "right",
	"end top": "right-start",
	"end bottom": "right-end",
}

export const toAnchorPlacement = (placement: Placement): AnchorPlacement => ANCHOR_PLACEMENTS[placement]
