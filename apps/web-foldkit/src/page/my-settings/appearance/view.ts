import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { BUILT_IN_PRESETS, COLOR_SWATCHES } from "~/lib/theme/presets"
import { ariaRadioGroup } from "../../../ui/aria-radio"
import { button } from "../../../ui/button"
import { view as selectView } from "../../../ui/select-view"
import type { PageViewInputs } from "../../contract"
import { divider, pageHeader, settingsRow } from "../shared"
import { generateIcon, grayPalettePreview, radiusOption, remixOptionCard, themePresetCard } from "./cards"
import { Dark, Light, System } from "./illustrations"
import { Message } from "./message"
import type { Model, ThemeMode } from "./model"
import { RADIUS_PRESETS, SWATCH_COLOR_NAMES, toGrayPalette } from "./presets"
import { GENERATE_TARGET, interaction, toGrayPaletteMessage } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/index.tsx` (Appearance). */

const themeModes: ReadonlyArray<{
	value: ThemeMode
	label: string
	illustration: <M>(h: HtmlBuilder<M>, className: string) => Html
}> = [
	{ value: "system", label: "System preference", illustration: System },
	{ value: "light", label: "Light mode", illustration: Light },
	{ value: "dark", label: "Dark mode", illustration: Dark },
]

const isThemeMode = (value: string): value is ThemeMode =>
	value === "system" || value === "light" || value === "dark"

const toPresetMessage = (presetId: string) => Message.SelectedPreset({ presetId })
const toModeMessage = (value: string) =>
	Message.SelectedThemeMode({ mode: isThemeMode(value) ? value : "system" })
const toRadiusMessage = (value: string) =>
	Message.SelectedRadius({ radius: RADIUS_PRESETS.find((preset) => preset === value) ?? "normal" })
const toBrandColorMessage = (value: string) =>
	Message.SelectedBrandColor({
		hex: COLOR_SWATCHES.find((swatch) => swatch.hex === value)?.hex ?? COLOR_SWATCHES[4].hex,
	})

const renderGrayTrigger = <M>(h: HtmlBuilder<M>, selected: Option.Option<{ readonly key: string }>) =>
	Option.match(selected, {
		onNone: () => [],
		onSome: (item) => [grayPalettePreview(h, toGrayPalette(item.key))],
	})

const renderGrayOption = <M>(h: HtmlBuilder<M>, item: { readonly key: string }) => [
	grayPalettePreview(h, toGrayPalette(item.key)),
]

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const wiring = interaction.wiring(model)
	const { customization } = model
	const activePresetId = BUILT_IN_PRESETS.find(
		(preset) =>
			preset.customization.primary === customization.primary &&
			preset.customization.grayPalette === customization.grayPalette &&
			preset.customization.radius === customization.radius,
	)?.id
	const brandHex = customization.primary.toUpperCase()

	const presets = h.div(
		[h.Class("-mx-4 w-screen overflow-auto p-4 lg:mx-0 lg:w-auto lg:p-0")],
		[
			ariaRadioGroup(
				h,
				{
					id: "theme-preset",
					value: activePresetId ?? "custom",
					onChange: toPresetMessage,
					ariaLabel: "Theme preset",
					className: "flex gap-4",
					interaction: wiring,
				},
				(radio) =>
					BUILT_IN_PRESETS.map((preset) =>
						themePresetCard(h, radio, preset, activePresetId === preset.id),
					),
			),
		],
	)

	const remix = h.div(
		[h.Class("flex flex-col gap-4")],
		[
			h.div(
				[h.Class("flex items-center gap-4")],
				[
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							isPending: model.isGenerating,
							onPress: Message.ClickedGenerate(),
							interaction: { wiring, target: GENERATE_TARGET },
						},
						[generateIcon(h), "Generate"],
					),
				],
			),
			model.remixOptions.length > 0
				? h.div(
						[h.Class("grid grid-cols-2 gap-3 sm:grid-cols-4")],
						model.remixOptions.map((option, index) =>
							remixOptionCard(
								h,
								`${option.primary}-${index}`,
								option,
								Message.SelectedRemixTheme({ customization: option }),
							),
						),
					)
				: h.p(
						[h.Class("text-muted-fg text-sm")],
						["Click generate to create random theme combinations."],
					),
		],
	)

	const brandColor = h.div(
		[h.Class("flex flex-col gap-3 md:flex-row md:items-center")],
		[
			ariaRadioGroup(
				h,
				{
					id: "brand-color",
					value: brandHex,
					onChange: toBrandColorMessage,
					ariaLabel: "Brand color",
					className: "flex flex-col items-start gap-4 md:flex-row md:items-center",
					interaction: wiring,
				},
				(radio) => [
					h.div(
						[h.Class("flex gap-2")],
						COLOR_SWATCHES.map((swatch) => {
							const name = SWATCH_COLOR_NAMES[swatch.hex] ?? swatch.name
							return radio(swatch.hex, { ariaLabel: name }, ({ isSelected, isFocused }) => [
								h.div(
									[
										h.AriaLabel(name),
										h.Attribute("aria-roledescription", "color swatch"),
										h.Class(
											twMerge(
												"size-7 cursor-pointer rounded-full outline-1 outline-black/10 -outline-offset-1",
												(isSelected || isFocused) &&
													"ring-2 ring-ring ring-offset-2 ring-offset-bg",
											),
										),
										h.DataAttribute("rac", ""),
										h.Id(`color-${swatch.hex}`),
										h.Role("img"),
										h.Style({ backgroundColor: swatch.hex, forcedColorAdjust: "none" }),
									],
									[],
								),
							])
						}),
					),
				],
			),
		],
	)

	const grayPalette = h.submodel({
		slotId: "gray-palette",
		model: model.grayPalette,
		view: selectView,
		viewInputs: {
			label: "",
			ariaLabel: "Gray palette",
			className: "w-full",
			triggerClassName: "w-full sm:w-64",
			renderTrigger: renderGrayTrigger,
			renderOption: renderGrayOption,
		},
		toParentMessage: toGrayPaletteMessage,
	})

	const radius = ariaRadioGroup(
		h,
		{
			id: "border-radius",
			value: customization.radius,
			onChange: toRadiusMessage,
			ariaLabel: "Border radius",
			className: "flex flex-wrap gap-2",
			interaction: wiring,
		},
		(radio) =>
			RADIUS_PRESETS.map((preset) => radiusOption(h, radio, preset, customization.radius === preset)),
	)

	const displayMode = h.div(
		[h.Class("-mx-4 -mb-4 w-screen overflow-auto p-4 lg:w-[calc(100%+48px)]")],
		[
			ariaRadioGroup(
				h,
				{
					id: "display-preference",
					value: model.mode,
					onChange: toModeMessage,
					ariaLabel: "Display preference",
					className: "flex gap-5",
					interaction: wiring,
				},
				(radio) =>
					themeModes.map((option) =>
						radio(
							option.value,
							{ className: "flex cursor-pointer flex-col gap-3", ariaLabel: option.label },
							({ isSelected, isFocusVisible }) => [
								h.section(
									[
										h.Class(
											twMerge(
												"relative h-33 w-50 rounded-[10px] bg-secondary",
												isSelected && "outline-2 outline-ring outline-offset-2",
											),
										),
									],
									[
										option.illustration(h, "size-full"),
										...(isSelected
											? [
													h.div(
														[
															h.Class(
																twMerge(
																	"absolute bottom-2 left-2 flex size-5 items-center justify-center rounded-full border-2 border-fg bg-primary",
																	isFocusVisible &&
																		"ring-2 ring-ring ring-offset-2",
																),
															),
														],
														[h.div([h.Class("size-2.5 rounded-full bg-fg")], [])],
													),
												]
											: []),
									],
								),
								h.section(
									[h.Class("w-full")],
									[h.p([h.Class("font-semibold text-fg text-sm")], [option.label])],
								),
							],
						),
					),
			),
		],
	)

	return h.form(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Appearance", "Change how your dashboard looks and feels."),
			h.div(
				[h.Class("flex flex-col gap-5")],
				[
					settingsRow(
						h,
						{
							title: "Theme presets",
							description: "Choose a pre-designed theme or customize your own.",
						},
						presets,
					),
					divider(h),
					settingsRow(
						h,
						{ title: "Remix", description: "Generate random theme combinations." },
						remix,
					),
					divider(h),
					settingsRow(
						h,
						{ title: "Brand color", description: "Select or customize your brand color." },
						brandColor,
					),
					settingsRow(
						h,
						{ title: "Gray palette", description: "Choose the undertone for gray colors." },
						grayPalette,
					),
					settingsRow(
						h,
						{ title: "Border radius", description: "Adjust the roundness of UI elements." },
						radius,
					),
					divider(h),
					settingsRow(
						h,
						{ title: "Display mode", description: "Switch between light and dark modes." },
						displayMode,
					),
				],
			),
		],
	)
})
