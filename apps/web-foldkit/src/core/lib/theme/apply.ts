import type { Theme } from "@hazel/domain/models"
import { generateRgbShades } from "~/lib/helper/generate-shades"
import { COLOR_SWATCHES, RADIUS_VALUES } from "./presets"

/**
 * CSS variable shade keys in order
 */
const SHADE_KEYS = ["25", "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const

/**
 * Semantic tokens that use gray colors, mapped to their shade values.
 *
 * These tokens are overridden at runtime when a non-default gray palette is selected.
 * The shade numbers correspond to the color palette scale (25-950).
 */
const LIGHT_MODE_GRAY_TOKENS = {
	"--fg": "950",
	"--secondary": "100",
	"--secondary-fg": "950",
	"--overlay": "25",
	"--overlay-fg": "950",
	"--muted": "100",
	"--muted-fg": "600",
	"--border": "200",
	"--input": "300",
	"--navbar": "25",
	"--navbar-fg": "950",
	"--sidebar": "25",
	"--sidebar-fg": "950",
	"--sidebar-accent": "100",
	"--sidebar-accent-fg": "950",
	"--sidebar-border": "200",
} as const

const DARK_MODE_GRAY_TOKENS = {
	"--fg": "50",
	"--secondary": "800",
	"--secondary-fg": "50",
	"--overlay": "900",
	"--overlay-fg": "50",
	"--muted": "900",
	"--muted-fg": "400",
	"--border": "800",
	"--input": "800",
	"--navbar": "950",
	"--navbar-fg": "50",
	"--sidebar": "950",
	"--sidebar-fg": "50",
	"--sidebar-accent": "900",
	"--sidebar-accent-fg": "50",
	"--sidebar-border": "900",
} as const

/**
 * Apply brand/primary color to CSS variables
 *
 * If the color matches a predefined swatch, we use CSS variable references
 * for better performance. Otherwise, we generate RGB shades dynamically.
 */
export function applyBrandColor(hexColor: Theme.HexColor): void {
	if (typeof document === "undefined") return

	const root = document.documentElement

	// Check if this is a predefined swatch color
	const existingColorSwatch = COLOR_SWATCHES.find((swatch) => swatch.hex === hexColor)

	if (existingColorSwatch) {
		// Use CSS variable references for predefined colors
		for (const shade of SHADE_KEYS) {
			root.style.setProperty(
				`--color-brand-${shade}`,
				`var(--color-${existingColorSwatch.name}-${shade})`,
			)
		}
		return
	}

	// Generate RGB shades for custom colors
	const shades = generateRgbShades(hexColor)
	if (!shades) return

	for (const [key, { r, g, b }] of Object.entries(shades)) {
		root.style.setProperty(`--color-brand-${key}`, `rgb(${r} ${g} ${b})`)
	}
}

/**
 * Apply gray palette by overriding semantic tokens.
 *
 * The default CSS uses Tailwind's zinc palette. When a different gray palette
 * is selected, we override the semantic tokens (--secondary, --muted, etc.)
 * to use the selected palette's color values.
 *
 * "gray-neutral" is treated as the default - it removes any overrides so the
 * original CSS (using zinc) takes effect.
 */
export function applyGrayPalette(palette: Theme.GrayPalette, isDarkMode: boolean): void {
	if (typeof document === "undefined") return

	const root = document.documentElement

	// "gray-neutral" = default, remove any overrides to use original CSS (zinc-based)
	if (palette === "gray-neutral") {
		resetGrayPalette()
		return
	}

	// Apply the selected palette by overriding semantic tokens
	const tokens = isDarkMode ? DARK_MODE_GRAY_TOKENS : LIGHT_MODE_GRAY_TOKENS

	for (const [token, shade] of Object.entries(tokens)) {
		root.style.setProperty(token, `var(--color-${palette}-${shade})`)
	}
}

/**
 * Reset gray palette overrides (restores original CSS defaults)
 */
export function resetGrayPalette(): void {
	if (typeof document === "undefined") return

	const root = document.documentElement

	// Remove all gray token overrides
	const allTokens = { ...LIGHT_MODE_GRAY_TOKENS, ...DARK_MODE_GRAY_TOKENS }
	for (const token of Object.keys(allTokens)) {
		root.style.removeProperty(token)
	}
}

/**
 * Apply border radius preset to CSS variables
 *
 * The --radius-lg variable is the base radius, and all other radius
 * variables (xs, sm, md, xl, 2xl, etc.) are calculated relative to it.
 */
export function applyRadius(preset: Theme.RadiusPreset): void {
	if (typeof document === "undefined") return

	const root = document.documentElement
	root.style.setProperty("--radius-lg", RADIUS_VALUES[preset])
}

/**
 * Apply a semantic color override (success, danger, warning)
 *
 * This allows users to customize the semantic colors while maintaining
 * proper light/dark mode support.
 */
export function applySemanticColor(
	name: "success" | "danger" | "warning",
	colors: Theme.SemanticColorGroup,
	isDarkMode: boolean,
): void {
	if (typeof document === "undefined") return

	const root = document.documentElement
	const mode = isDarkMode ? "dark" : "light"

	root.style.setProperty(`--${name}`, colors.base[mode])
	root.style.setProperty(`--${name}-fg`, colors.fg[mode])
	root.style.setProperty(`--${name}-subtle`, colors.subtle[mode])
	root.style.setProperty(`--${name}-subtle-fg`, colors.subtleFg[mode])
}

/**
 * Reset a semantic color to its default value
 */
export function resetSemanticColor(name: "success" | "danger" | "warning"): void {
	if (typeof document === "undefined") return

	const root = document.documentElement

	// Remove the custom property to fall back to CSS defaults
	root.style.removeProperty(`--${name}`)
	root.style.removeProperty(`--${name}-fg`)
	root.style.removeProperty(`--${name}-subtle`)
	root.style.removeProperty(`--${name}-subtle-fg`)
}
