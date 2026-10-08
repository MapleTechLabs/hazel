import { Schema } from "effect"
import type { Placement as PositionPlacement } from "./position"

/** React Aria's `Placement` as a Schema, so Mount args and Models carry it without a cast. */
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
] as const satisfies ReadonlyArray<PositionPlacement>

export const Placement = Schema.Literals(placements)
export type Placement = typeof Placement.Type
