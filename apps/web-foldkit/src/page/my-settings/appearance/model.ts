import { Theme } from "@hazel/domain/models"
import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"
import * as Select from "../../../ui/select"

/** The theme mode the user picked (`themeAtom`). */
export const ThemeMode = Schema.Literals(["system", "light", "dark"])
export type ThemeMode = typeof ThemeMode.Type

/** `themeCustomizationAtom`: brand color, gray palette and radius. */
export const Customization = Schema.Struct({
	primary: Theme.HexColor,
	grayPalette: Theme.GrayPalette,
	radius: Theme.RadiusPreset,
})
export type Customization = typeof Customization.Type

export const Model = Schema.Struct({
	mode: ThemeMode,
	customization: Customization,
	remixOptions: Schema.Array(Customization),
	isGenerating: Schema.Boolean,
	grayPalette: Select.Model,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
