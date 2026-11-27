// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The appearance pickers (today's `my-settings/appearance/cards.ts` and the onboarding theme step):
 * `ThemePreview` draws theme cards in their own colours and radius, a web-only extension because
 * those colours are the user's data (iOS draws the fallback, a plain choice of the labels). The
 * brand colour and display mode pickers are `choiceGroup`s. PA4 reuses all three.
 */
import { Theme } from "@hazel/domain/models"
import { extension, type H } from "@hazel/ui/vocabulary/Hazel"
import { Schema } from "effect"
import { COLOR_SWATCHES, RADIUS_LABELS } from "../lib/theme/presets"

export const ThemeCustomization = Schema.Struct({
	primary: Theme.HexColor,
	grayPalette: Theme.GrayPalette,
	radius: Theme.RadiusPreset,
})
export type ThemeCustomization = typeof ThemeCustomization.Type

export const ThemeMode = Schema.Literals(["system", "light", "dark"])
export type ThemeMode = typeof ThemeMode.Type

/** `presets`: a preset's mockup card; `radius`: a corner sample; `remix`: a generated theme to apply. */
export const ThemePreviewKind = Schema.Literals(["presets", "radius", "remix"])
export type ThemePreviewKind = typeof ThemePreviewKind.Type

export const ThemePreviewItem = Schema.Struct({
	value: Schema.String,
	label: Schema.String,
	customization: ThemeCustomization,
})
export type ThemePreviewItem = typeof ThemePreviewItem.Type

export const ThemePreviewExtension = extension({
	name: "ThemePreview",
	props: Schema.Struct({
		kind: ThemePreviewKind,
		/** The group's accessible name. */
		label: Schema.String,
		items: Schema.Array(ThemePreviewItem),
		/** The picked item (`presets`, `radius`); none matches a custom theme. */
		selected: Schema.NullOr(Schema.String),
	}),
	events: { select: Schema.Struct({ value: Schema.String }) },
	platforms: ["web"],
})

export interface ThemePreviewOptions<Msg> {
	readonly kind: ThemePreviewKind
	readonly label: string
	readonly items: ReadonlyArray<ThemePreviewItem>
	readonly selected: string | null
	readonly onSelect: (value: string) => Msg
}

/** Theme cards; elsewhere than the web, a plain choice of their labels. */
export const ThemePreview = <Msg>(h: H<Msg>, options: ThemePreviewOptions<Msg>) =>
	h
		.extension(ThemePreviewExtension, {
			kind: options.kind,
			label: options.label,
			items: options.items,
			selected: options.selected,
		})
		.on("select", ({ value }) => options.onSelect(value))
		.fallback(
			h.choiceGroup
				.label(options.label)
				.labelHidden()
				.style("chips")
				.options(options.items.map((item) => ({ value: item.value, label: item.label })))
				.selected(options.selected === null ? [] : [options.selected])
				.on("change", ({ selected }) => options.onSelect(selected[0] ?? "")),
		)

export const RADIUS_PRESETS: ReadonlyArray<Theme.RadiusPreset> = ["tight", "normal", "round", "full"]

/** The radius samples, in the current theme's other colours. */
export const radiusItems = (customization: ThemeCustomization): ReadonlyArray<ThemePreviewItem> =>
	RADIUS_PRESETS.map((radius) => ({
		value: radius,
		label: RADIUS_LABELS[radius],
		customization: { ...customization, radius },
	}))

/**
 * `parseColor(hex).getColorName("en-US")` for `COLOR_SWATCHES` (React Aria's colour names, as
 * today's swatches read them out).
 */
export const SWATCH_COLOR_NAMES: ReadonlyMap<string, string> = new Map([
	["#535862", "dark grayish blue"],
	["#099250", "green"],
	["#1570EF", "vibrant cyan blue"],
	["#444CE7", "dark vibrant blue"],
	["#6938EF", "dark vibrant purple"],
	["#BA24D5", "vibrant magenta"],
	["#DD2590", "vibrant pink"],
	["#E04F16", "vibrant red orange"],
])

export interface BrandColorOptions<Msg> {
	readonly primary: string
	readonly onSelect: (hex: Theme.HexColor) => Msg
}

/** The brand colour swatches; a colour outside them selects none. */
export const BrandColorChoice = <Msg>(h: H<Msg>, options: BrandColorOptions<Msg>) =>
	h.choiceGroup
		.label("Brand color")
		.labelHidden()
		.style("swatches")
		.options(
			COLOR_SWATCHES.map((swatch) => ({
				value: swatch.hex,
				label: SWATCH_COLOR_NAMES.get(swatch.hex) ?? swatch.name,
				swatch: swatch.hex,
			})),
		)
		.selected(
			COLOR_SWATCHES.filter((swatch) => swatch.hex.toUpperCase() === options.primary.toUpperCase()).map(
				(swatch) => swatch.hex,
			),
		)
		.on("change", ({ selected }) => {
			const swatch = COLOR_SWATCHES.find((each) => each.hex === selected[0]) ?? COLOR_SWATCHES[4]
			return options.onSelect(swatch.hex)
		})

/** Static illustrations in the web app's `public/images/appearance`. */
export const THEME_MODES: ReadonlyArray<{
	readonly value: ThemeMode
	readonly label: string
	readonly image: string
}> = [
	{ value: "system", label: "System preference", image: "/images/appearance/system.svg" },
	{ value: "light", label: "Light mode", image: "/images/appearance/light.svg" },
	{ value: "dark", label: "Dark mode", image: "/images/appearance/dark.svg" },
]

const isThemeMode = Schema.is(ThemeMode)

export interface DisplayModeOptions<Msg> {
	readonly mode: ThemeMode
	readonly onSelect: (mode: ThemeMode) => Msg
}

/**
 * Light, dark or the system's, each over its illustration.
 * HAZEL-GAP(p4-choice-image-card): today's card is the bare 200x132 illustration on `bg-secondary`
 * (`rounded-xl`, an outline ring and a filled dot when picked) with the label under it.
 */
export const DisplayModeChoice = <Msg>(h: H<Msg>, options: DisplayModeOptions<Msg>) =>
	h.choiceGroup
		.label("Display preference")
		.labelHidden()
		.style("cards")
		.columns("3")
		.options(THEME_MODES.map((mode) => ({ value: mode.value, label: mode.label, image: mode.image })))
		.selected([options.mode])
		.on("change", ({ selected }) => {
			const mode = selected[0]
			return options.onSelect(mode !== undefined && isThemeMode(mode) ? mode : "system")
		})
