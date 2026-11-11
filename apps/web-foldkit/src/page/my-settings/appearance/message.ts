import { Theme } from "@hazel/domain/models"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as Select from "../../../ui/select"
import { Customization, ThemeMode } from "./model"

export const Message = defineMessageUnion({
	SelectedPreset: { presetId: Schema.String },
	ClickedGenerate: {},
	GeneratedRemixOptions: { options: Schema.Array(Customization) },
	SelectedRemixTheme: { customization: Customization },
	SelectedBrandColor: { hex: Theme.HexColor },
	SelectedRadius: { radius: Theme.RadiusPreset },
	SelectedThemeMode: { mode: ThemeMode },
	GotGrayPaletteMessage: { message: Select.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
