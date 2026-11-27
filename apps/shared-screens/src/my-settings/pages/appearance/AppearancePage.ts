// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/my-settings` (Appearance; today's `page/my-settings/appearance`): theme presets, a
 * remix of random themes, the brand colour, gray palette and radius, and the display mode. The
 * theme is the app's (the `theme` prop); every pick goes to the app as `SetTheme`, which applies
 * it everywhere at once and stores it.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Theme } from "@hazel/domain/models"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { SetTheme, ThemePreference } from "../../../app/requests"
import { BUILT_IN_PRESETS, GRAY_PALETTE_LABELS, getBuiltInPreset } from "../../../lib/theme/presets"
import { generateRemixOptions } from "../../../lib/theme/remix"
import { SettingsPage, SettingsRow } from "../../components"
import {
	BrandColorChoice,
	DisplayModeChoice,
	RADIUS_PRESETS,
	radiusItems,
	ThemeCustomization,
	ThemeMode,
	ThemePreview,
} from "../../ThemePreview"

/** `GrayPaletteSelector`'s order. */
export const GRAY_PALETTES: ReadonlyArray<Theme.GrayPalette> = [
	"gray",
	"gray-blue",
	"gray-cool",
	"gray-modern",
	"gray-neutral",
	"gray-iron",
	"gray-true",
	"gray-warm",
]

export const AppearanceMessage = UiSchema.TaggedEnum({
	SelectedPreset: { presetId: Schema.String },
	PressedGenerate: {},
	GeneratedRemixOptions: { options: Schema.Array(ThemeCustomization) },
	/** A remix card's "Apply theme", by its place in the list. */
	SelectedRemix: { index: Schema.Finite },
	SelectedBrandColor: { hex: Theme.HexColor },
	SelectedGrayPalette: { value: Schema.String },
	SelectedRadius: { value: Schema.String },
	SelectedThemeMode: { mode: ThemeMode },
})
export type AppearanceMessage = typeof AppearanceMessage.Type

/**
 * `ThemeRemixSection.handleGenerate`: four random themes (Math.random), shown after today's 150ms.
 * Drawn before the delay, so the draws do not depend on the scheduling around it.
 */
export class GenerateRemix extends Command.Service<GenerateRemix>()("hazel/my-settings/GenerateRemix", {
	args: {},
	success: AppearanceMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.succeed(() =>
			Effect.sync(() =>
				AppearanceMessage.GeneratedRemixOptions({
					options: generateRemixOptions(4).map(({ primary, grayPalette, radius }) => ({
						primary,
						grayPalette,
						radius,
					})),
				}),
			).pipe(Effect.tap(() => Effect.sleep("150 millis"))),
		),
	)
}

const isGrayPalette = (value: string): value is Theme.GrayPalette =>
	GRAY_PALETTES.some((palette) => palette === value)
const isRadius = (value: string): value is Theme.RadiusPreset =>
	RADIUS_PRESETS.some((radius) => radius === value)

/** The preset whose three values are the theme's, if any. */
export const activePresetOf = (customization: ThemeCustomization) =>
	BUILT_IN_PRESETS.find(
		(preset) =>
			preset.customization.primary === customization.primary &&
			preset.customization.grayPalette === customization.grayPalette &&
			preset.customization.radius === customization.radius,
	)

/** `RemixOptionCard.getGrayLabel` */
const remixGrayLabel = (gray: Theme.GrayPalette) =>
	gray
		.replace("gray-", "")
		.replace(/^./, (c) => c.toUpperCase())
		.replace("gray", "Default")

const PRESET_ITEMS = BUILT_IN_PRESETS.map((preset) => ({
	value: preset.id,
	label: preset.name,
	customization: {
		primary: preset.customization.primary,
		grayPalette: preset.customization.grayPalette,
		radius: preset.customization.radius,
	},
}))

export const AppearancePageNoDeps = Hazel.component({
	name: "AppearancePage",
	props: Schema.Struct({ theme: ThemePreference }),
	model: Schema.Struct({
		remixOptions: Schema.Array(ThemeCustomization),
		isGenerating: Schema.Boolean,
	}),
	message: AppearanceMessage,
	// After Back, a generation in flight is not running any more.
	restore: (model) => ({ ...model, isGenerating: false }),
}).make({
	init: () => ({ remixOptions: [], isGenerating: false }),
	update: {
		SelectedPreset: ($, { presetId }) => {
			const preset = getBuiltInPreset(presetId)
			if (preset === undefined) return $.model
			const { primary, grayPalette, radius } = preset.customization
			return $.run(
				SetTheme.make({
					preference: { mode: $.props.theme.mode, customization: { primary, grayPalette, radius } },
				}),
			)
		},
		PressedGenerate: ($) =>
			$.model.isGenerating ? $.model : $.evolve({ isGenerating: true }).run(GenerateRemix.make({})),
		GeneratedRemixOptions: ($, { options }) => $.evolve({ remixOptions: options, isGenerating: false }),
		SelectedRemix: ($, { index }) => {
			const remixed = $.model.remixOptions[index]
			return remixed === undefined
				? $.model
				: $.run(SetTheme.make({ preference: { mode: $.props.theme.mode, customization: remixed } }))
		},
		SelectedBrandColor: ($, { hex }) =>
			$.run(
				SetTheme.make({
					preference: {
						...$.props.theme,
						customization: { ...$.props.theme.customization, primary: hex },
					},
				}),
			),
		SelectedGrayPalette: ($, { value }) =>
			!isGrayPalette(value) || value === $.props.theme.customization.grayPalette
				? $.model
				: $.run(
						SetTheme.make({
							preference: {
								...$.props.theme,
								customization: { ...$.props.theme.customization, grayPalette: value },
							},
						}),
					),
		SelectedRadius: ($, { value }) =>
			!isRadius(value)
				? $.model
				: $.run(
						SetTheme.make({
							preference: {
								...$.props.theme,
								customization: { ...$.props.theme.customization, radius: value },
							},
						}),
					),
		SelectedThemeMode: ($, { mode }) => $.run(SetTheme.make({ preference: { ...$.props.theme, mode } })),
	},
	view: (h, model) => {
		const { customization, mode } = h.props.theme
		return SettingsPage(
			h,
			{
				id: "my-settings-appearance",
				title: "Appearance",
				subtitle: "Change how your dashboard looks and feels.",
			},
			SettingsRow(
				h,
				{ title: "Theme presets", description: "Choose a pre-designed theme or customize your own." },
				ThemePreview(h, {
					kind: "presets",
					label: "Theme preset",
					items: PRESET_ITEMS,
					selected: activePresetOf(customization)?.id ?? null,
					onSelect: (presetId) => AppearanceMessage.SelectedPreset({ presetId }),
				}),
			),
			h.divider,
			SettingsRow(
				h,
				{ title: "Remix", description: "Generate random theme combinations." },
				h.stack.children(
					h.stack
						.axis("horizontal")
						.children(
							h.button
								.label("Generate")
								.icon("refresh")
								.variant("outline")
								.size("small")
								.loading(model.isGenerating)
								.on("press", AppearanceMessage.PressedGenerate()),
						),
					model.remixOptions.length > 0
						? ThemePreview(h, {
								kind: "remix",
								label: "Generated themes",
								items: model.remixOptions.map((option, index) => ({
									value: String(index),
									label: `${option.primary.toUpperCase()} ${remixGrayLabel(option.grayPalette)}`,
									customization: option,
								})),
								selected: null,
								onSelect: (value) =>
									AppearanceMessage.SelectedRemix({ index: Number(value) }),
							})
						: h.text
								.role("label")
								.tone("muted")
								.children("Click generate to create random theme combinations."),
				),
			),
			h.divider,
			SettingsRow(
				h,
				{ title: "Brand color", description: "Select or customize your brand color." },
				BrandColorChoice(h, {
					primary: customization.primary,
					onSelect: (hex) => AppearanceMessage.SelectedBrandColor({ hex }),
				}),
			),
			SettingsRow(
				h,
				{ title: "Gray palette", description: "Choose the undertone for gray colors." },
				// HAZEL-GAP(p4-select-palette-preview): today's trigger and options lead with four
				// shade dots of the palette, and the field shows no caption of its own.
				h.select
					.label("Gray palette")
					.width("regular")
					.options(
						GRAY_PALETTES.map((palette) => ({
							value: palette,
							label: GRAY_PALETTE_LABELS[palette],
						})),
					)
					.value(customization.grayPalette)
					.on("change", ({ value }) => AppearanceMessage.SelectedGrayPalette({ value })),
			),
			SettingsRow(
				h,
				{ title: "Border radius", description: "Adjust the roundness of UI elements." },
				ThemePreview(h, {
					kind: "radius",
					label: "Border radius",
					items: radiusItems(customization),
					selected: customization.radius,
					onSelect: (value) => AppearanceMessage.SelectedRadius({ value }),
				}),
			),
			h.divider,
			SettingsRow(
				h,
				{ title: "Display mode", description: "Switch between light and dark modes." },
				DisplayModeChoice(h, {
					mode,
					onSelect: (picked) => AppearanceMessage.SelectedThemeMode({ mode: picked }),
				}),
			),
		)
	},
})

export const AppearancePage = AppearancePageNoDeps.pipe(Component.provide(GenerateRemix.layer))
