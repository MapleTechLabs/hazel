import { Schema } from "effect"

/**
 * Available gray palette options
 */
export const GrayPalette = Schema.Literals([
	"gray",
	"gray-blue",
	"gray-cool",
	"gray-modern",
	"gray-neutral",
	"gray-iron",
	"gray-true",
	"gray-warm",
])
export type GrayPalette = Schema.Schema.Type<typeof GrayPalette>

/**
 * Border radius preset options
 */
export const RadiusPreset = Schema.Literals(["tight", "normal", "round", "full"])
export type RadiusPreset = Schema.Schema.Type<typeof RadiusPreset>

/**
 * Hex color string branded type (e.g., "#6938EF")
 */
export const HexColor = Schema.String.check(
	Schema.isPattern(/^#[0-9A-Fa-f]{6}$/, { message: "Must be a valid hex color (#RRGGBB)" }),
).pipe(Schema.brand("HexColor"))
export type HexColor = Schema.Schema.Type<typeof HexColor>

/**
 * Color token with light and dark mode values
 */
export const ColorToken = Schema.Struct({
	light: HexColor,
	dark: HexColor,
})
export type ColorToken = Schema.Schema.Type<typeof ColorToken>

/**
 * Semantic color group (e.g., success, danger, warning)
 * Contains base color, foreground, subtle variant, and subtle foreground
 */
export const SemanticColorGroup = Schema.Struct({
	base: ColorToken,
	fg: ColorToken,
	subtle: ColorToken,
	subtleFg: ColorToken,
})
export type SemanticColorGroup = Schema.Schema.Type<typeof SemanticColorGroup>

/**
 * Full theme customization configuration
 */
export const ThemeCustomization = Schema.Struct({
	/** Brand/primary color hex */
	primary: HexColor,
	/** Gray palette selection */
	grayPalette: GrayPalette,
	/** Border radius preset */
	radius: RadiusPreset,
	/** Optional success color override */
	success: Schema.optional(SemanticColorGroup),
	/** Optional danger color override */
	danger: Schema.optional(SemanticColorGroup),
	/** Optional warning color override */
	warning: Schema.optional(SemanticColorGroup),
})
export type ThemeCustomization = Schema.Schema.Type<typeof ThemeCustomization>

/**
 * Theme preset (built-in or user-created)
 */
export const ThemePreset = Schema.Struct({
	/** Unique identifier */
	id: Schema.String,
	/** Display name */
	name: Schema.String,
	/** Optional description */
	description: Schema.optional(Schema.String),
	/** Whether this is a built-in preset */
	isBuiltIn: Schema.Boolean,
	/** Theme customization settings */
	customization: ThemeCustomization,
})
export type ThemePreset = Schema.Schema.Type<typeof ThemePreset>

/**
 * Display mode preference
 */
export const DisplayMode = Schema.Literals(["light", "dark", "system"])
export type DisplayMode = Schema.Schema.Type<typeof DisplayMode>

/**
 * User theme settings stored in the database.
 * Using mutable() to ensure compatibility with TanStack DB collections.
 */
export const UserThemeSettings = Schema.Struct({
	/** Active preset ID ("default", "ocean", etc.) or custom preset ID */
	activePresetId: Schema.NullOr(Schema.String),
	/** Custom theme when not using a preset */
	customTheme: Schema.NullOr(ThemeCustomization),
	/** User's saved custom presets */
	savedPresets: Schema.optional(Schema.mutable(Schema.Array(ThemePreset))),
	/** Display mode preference */
	mode: DisplayMode,
})
export type UserThemeSettings = Schema.Schema.Type<typeof UserThemeSettings>
