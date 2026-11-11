import type { Theme } from "@hazel/domain/models"

/** `GrayPaletteSelector`'s option order. */
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

/** A Select key back to its palette (keys come from `GRAY_PALETTES`). */
export const toGrayPalette = (key: string): Theme.GrayPalette =>
	GRAY_PALETTES.find((palette) => palette === key) ?? "gray-neutral"

export const RADIUS_PRESETS: ReadonlyArray<Theme.RadiusPreset> = ["tight", "normal", "round", "full"]

/**
 * `parseColor(hex).getColorName("en-US")` for the fixed `COLOR_SWATCHES` (React Aria's color naming,
 * evaluated once; `presets.test.ts` keeps it in sync with the swatch list).
 */
export const SWATCH_COLOR_NAMES: Readonly<Record<string, string>> = {
	"#535862": "dark grayish blue",
	"#099250": "green",
	"#1570EF": "vibrant cyan blue",
	"#444CE7": "dark vibrant blue",
	"#6938EF": "dark vibrant purple",
	"#BA24D5": "vibrant magenta",
	"#DD2590": "vibrant pink",
	"#E04F16": "vibrant red orange",
}

/** `ThemePresetCard`'s preview radius. */
export const presetPreviewRadius: Readonly<Record<Theme.RadiusPreset, string>> = {
	tight: "2px",
	normal: "4px",
	round: "6px",
	full: "8px",
}

/** `RadiusSelector`'s preview radius. */
export const radiusSelectorPreview: Readonly<Record<Theme.RadiusPreset, string>> = {
	tight: "4px",
	normal: "8px",
	round: "12px",
	full: "16px",
}

/** `RemixOptionCard`'s dot radius. */
export const remixDotRadius: Readonly<Record<Theme.RadiusPreset, string>> = {
	tight: "2px",
	normal: "4px",
	round: "6px",
	full: "999px",
}

/** `RemixOptionCard.getGrayLabel` */
export const remixGrayLabel = (gray: Theme.GrayPalette) =>
	gray
		.replace("gray-", "")
		.replace(/^./, (c) => c.toUpperCase())
		.replace("gray", "Default")
