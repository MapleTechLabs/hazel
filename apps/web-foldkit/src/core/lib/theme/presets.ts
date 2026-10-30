import type { Theme } from "@hazel/domain/models"

/**
 * Default brand color for the application
 */
export const DEFAULT_BRAND_COLOR = "#6938EF" as Theme.HexColor

/**
 * Built-in theme presets
 */
export const BUILT_IN_PRESETS: Theme.ThemePreset[] = [
	{
		id: "default",
		name: "Default",
		description: "The default Hazel theme",
		isBuiltIn: true,
		customization: {
			primary: "#6938EF" as Theme.HexColor,
			grayPalette: "gray-neutral",
			radius: "normal",
		},
	},
	{
		id: "ocean",
		name: "Ocean",
		description: "A calm, professional blue theme",
		isBuiltIn: true,
		customization: {
			primary: "#0EA5E9" as Theme.HexColor,
			grayPalette: "gray-cool",
			radius: "round",
		},
	},
	{
		id: "forest",
		name: "Forest",
		description: "An earthy, natural green theme",
		isBuiltIn: true,
		customization: {
			primary: "#059669" as Theme.HexColor,
			grayPalette: "gray-warm",
			radius: "normal",
		},
	},
	{
		id: "sunset",
		name: "Sunset",
		description: "A warm, energetic orange theme",
		isBuiltIn: true,
		customization: {
			primary: "#EA580C" as Theme.HexColor,
			grayPalette: "gray-warm",
			radius: "round",
		},
	},
	{
		id: "rose",
		name: "Rose",
		description: "A vibrant, modern pink theme",
		isBuiltIn: true,
		customization: {
			primary: "#E11D48" as Theme.HexColor,
			grayPalette: "gray-neutral",
			radius: "full",
		},
	},
]

/**
 * CSS values for each radius preset
 */
export const RADIUS_VALUES: Record<Theme.RadiusPreset, string> = {
	tight: "0.25rem",
	normal: "0.5rem",
	round: "0.75rem",
	full: "1rem",
}

/**
 * Human-readable labels for radius presets
 */
export const RADIUS_LABELS: Record<Theme.RadiusPreset, string> = {
	tight: "Tight",
	normal: "Normal",
	round: "Round",
	full: "Full",
}

/**
 * Human-readable labels for gray palettes
 */
export const GRAY_PALETTE_LABELS: Record<Theme.GrayPalette, string> = {
	gray: "Gray",
	"gray-blue": "Blue Gray",
	"gray-cool": "Cool Gray",
	"gray-modern": "Modern Gray",
	"gray-neutral": "Neutral Gray",
	"gray-iron": "Iron Gray",
	"gray-true": "True Gray",
	"gray-warm": "Warm Gray",
}

/**
 * Quick color swatches for easy brand color selection
 */
export const COLOR_SWATCHES = [
	{ hex: "#535862" as Theme.HexColor, name: "gray" },
	{ hex: "#099250" as Theme.HexColor, name: "green" },
	{ hex: "#1570EF" as Theme.HexColor, name: "blue" },
	{ hex: "#444CE7" as Theme.HexColor, name: "indigo" },
	{ hex: "#6938EF" as Theme.HexColor, name: "purple" },
	{ hex: "#BA24D5" as Theme.HexColor, name: "fuchsia" },
	{ hex: "#DD2590" as Theme.HexColor, name: "pink" },
	{ hex: "#E04F16" as Theme.HexColor, name: "orange" },
] as const

/**
 * Get a built-in preset by ID
 */
export function getBuiltInPreset(id: string): Theme.ThemePreset | undefined {
	return BUILT_IN_PRESETS.find((preset) => preset.id === id)
}

/**
 * Get the default theme customization
 */
export function getDefaultThemeCustomization(): Theme.ThemeCustomization {
	return BUILT_IN_PRESETS[0]!.customization
}
