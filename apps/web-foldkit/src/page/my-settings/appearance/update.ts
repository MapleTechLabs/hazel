import type { Theme } from "@hazel/domain/models"
import { Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { GRAY_PALETTE_LABELS, getBuiltInPreset } from "~/lib/theme/presets"
import * as Interaction from "../../../ui/aria/interaction"
import * as Select from "../../../ui/select"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../shared"
import { GenerateRemixOptions } from "./command"
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

/** The gray palette Select follows `Shared.theme`, whoever changed it. */
const withGrayPalette = (model: Model, shared: Shared): Model =>
	modifyFields(model, {
		grayPalette: (select) =>
			Option.contains(select.selectedKey, shared.theme.customization.grayPalette)
				? select
				: { ...select, selectedKey: Option.some(shared.theme.customization.grayPalette) },
	})

/** `setTheme` / `setCustomization`: the root applies and persists it, then informs the page. */
const apply = (model: Model, mode: ThemeMode, customization: Customization): Return => ({
	model,
	outMessage: PageOutMessage.RequestedTheme({ preference: { mode, customization } }),
})

/** Folds the gray palette Select; a changed selection applies the palette like `setGrayPalette`. */
const foldGrayPalette = (model: Model, message: Select.Message, shared: Shared): Return => {
	const result = Select.update(model.grayPalette, message)
	const next = modifyFields(model, { grayPalette: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], toGrayPaletteMessage)
	const key = result.outMessage?.key
	if (key === undefined || !isGrayPalette(key)) return { model: next, commands }
	const { mode, customization } = shared.theme
	return { ...apply(next, mode, { ...customization, grayPalette: key }), commands }
}

export const init = (_route: unknown, shared: Shared): Return => ({
	model: {
		remixOptions: [],
		isGenerating: false,
		grayPalette: grayPaletteSelect(shared.theme.customization.grayPalette),
		interaction: Interaction.init(),
	},
})

export const sharedChanged = (model: Model, shared: Shared): Return => ({ model: withGrayPalette(model, shared) })

export const update = (model: Model, message: Message, shared: Shared): Return => {
	const { mode, customization } = shared.theme
	return Message.match<Return>(message, {
		SelectedPreset: ({ presetId }) => {
			const preset = getBuiltInPreset(presetId)
			if (preset === undefined) return { model }
			const { primary, grayPalette, radius } = preset.customization
			return apply(model, mode, { primary, grayPalette, radius })
		},
		// A pending React Aria button ends its hover (useHover with isDisabled).
		ClickedGenerate: () => {
			const unhovered = interaction.fold(
				model,
				Interaction.Message.LeftTarget({ target: GENERATE_TARGET }),
			)
			return {
				model: modifyFields(unhovered.model, { isGenerating: () => true }),
				commands: [...(unhovered.commands ?? []), GenerateRemixOptions()],
			}
		},
		GeneratedRemixOptions: ({ options }) => ({
			model: modifyFields(model, { remixOptions: () => options, isGenerating: () => false }),
		}),
		SelectedRemixTheme: ({ customization: remixed }) => apply(model, mode, remixed),
		SelectedBrandColor: ({ hex }) => apply(model, mode, { ...customization, primary: hex }),
		SelectedRadius: ({ radius }) => apply(model, mode, { ...customization, radius }),
		SelectedThemeMode: ({ mode: picked }) => apply(model, picked, customization),
		GotGrayPaletteMessage: ({ message: child }) => foldGrayPalette(model, child, shared),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
}
