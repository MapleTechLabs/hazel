import type { Theme } from "@hazel/domain/models"
import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { GRAY_PALETTE_LABELS, getBuiltInPreset } from "~/lib/theme/presets"
import * as Interaction from "../../../ui/aria/interaction"
import * as Select from "../../../ui/select"
import type { PageReturn } from "../../contract"
import { embedInteraction } from "../shared"
import { ApplyAppearance, defaultCustomization, GenerateRemixOptions, LoadAppearance } from "./command"
import { Message } from "./message"
import type { Customization, Model, ThemeMode } from "./model"
import { GRAY_PALETTES } from "./presets"

type Return = PageReturn<Model, Message>

export const GENERATE_TARGET = "remix-generate"

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

export const toGrayPaletteMessage = (message: Select.Message) => Message.GotGrayPaletteMessage({ message })

const isGrayPalette = (key: string): key is Theme.GrayPalette =>
	GRAY_PALETTES.some((palette) => palette === key)

const grayPaletteSelect = (selected: Theme.GrayPalette) =>
	Select.init({
		id: "gray-palette",
		items: GRAY_PALETTES.map((palette) => Select.item(palette, GRAY_PALETTE_LABELS[palette])),
		selectedKey: selected,
	})

/** Keeps the gray palette Select on the current palette. */
const withCustomization = (model: Model, customization: Customization): Model =>
	modifyFields(model, {
		customization: () => customization,
		grayPalette: (select) => ({ ...select, selectedKey: Option.some(customization.grayPalette) }),
	})

const apply = (model: Model, mode: ThemeMode, customization: Customization): Return => ({
	model: withCustomization(modifyFields(model, { mode: () => mode }), customization),
	commands: [ApplyAppearance({ mode, customization, shouldPersist: true })],
})

/** Folds the gray palette Select; a changed selection applies the palette like `setGrayPalette`. */
const foldGrayPalette = (model: Model, message: Select.Message): Return => {
	const result = Select.update(model.grayPalette, message)
	const next = modifyFields(model, { grayPalette: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], toGrayPaletteMessage)
	const key = result.outMessage?.key
	if (key === undefined || !isGrayPalette(key)) return { model: next, commands }
	const applied = apply(next, next.mode, { ...next.customization, grayPalette: key })
	return { model: applied.model, commands: [...commands, ...(applied.commands ?? [])] }
}

export const init = (): Return => {
	const customization = defaultCustomization()
	return {
		model: {
			mode: "system",
			customization,
			remixOptions: [],
			isGenerating: false,
			grayPalette: grayPaletteSelect(customization.grayPalette),
			interaction: Interaction.init(),
		},
		commands: [LoadAppearance({})],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		LoadedAppearance: ({ mode, customization }) => ({
			model: withCustomization(modifyFields(model, { mode: () => mode }), customization),
			commands: [ApplyAppearance({ mode, customization, shouldPersist: false })],
		}),
		CompletedApplyAppearance: () => ({ model }),
		SelectedPreset: ({ presetId }) => {
			const preset = getBuiltInPreset(presetId)
			if (preset === undefined) return { model }
			const { primary, grayPalette, radius } = preset.customization
			return apply(model, model.mode, { primary, grayPalette, radius })
		},
		// A pending React Aria button ends its hover (useHover with isDisabled).
		ClickedGenerate: () => {
			const unhovered = interaction.fold(
				model,
				Interaction.Message.LeftTarget({ target: GENERATE_TARGET }),
			)
			return {
				model: modifyFields(unhovered.model, { isGenerating: () => true }),
				commands: [...(unhovered.commands ?? []), GenerateRemixOptions({})],
			}
		},
		GeneratedRemixOptions: ({ options }) => ({
			model: modifyFields(model, { remixOptions: () => options, isGenerating: () => false }),
		}),
		SelectedRemixTheme: ({ customization }) => apply(model, model.mode, customization),
		SelectedBrandColor: ({ hex }) => apply(model, model.mode, { ...model.customization, primary: hex }),
		SelectedRadius: ({ radius }) => apply(model, model.mode, { ...model.customization, radius }),
		SelectedThemeMode: ({ mode }) => apply(model, mode, model.customization),
		GotGrayPaletteMessage: ({ message: child }) => foldGrayPalette(model, child),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
