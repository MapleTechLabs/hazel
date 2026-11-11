import { Schema } from "effect"
import { ThemeCustomization } from "../../../theme"
import * as Interaction from "../../../ui/aria/interaction"
import * as Select from "../../../ui/select"

/** The mode and customization are `Shared.theme` (root-owned); the page keeps only its own state. */
export { ThemeMode } from "../../../theme"
export const Customization = ThemeCustomization
export type Customization = ThemeCustomization

export const Model = Schema.Struct({
	remixOptions: Schema.Array(Customization),
	isGenerating: Schema.Boolean,
	grayPalette: Select.Model,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
