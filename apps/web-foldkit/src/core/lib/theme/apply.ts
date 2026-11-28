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

/**
 * Dark mode's tint per gray palette: the hue and chroma laid over the whole ink ladder (theme.css
 * `--color-ink-*`), measured from each palette's darkest shades and kept a little under them so a
 * tint reads as an undertone, not a colour. `lift` raises every step, for a lighter dark theme.
 *
 * Dark mode tints the ladder instead of swapping surfaces for the palette's fixed shades, so every
 * palette keeps Ink's layering (sidebar under page under card under popover) and its alpha hairlines,
 * and the UI kit, which reads the same `--color-ink-*`, follows the pick too.
 */
const DARK_MODE_TINTS = {
	gray: { h: 262, c: 0.012, lift: 0 },
	"gray-blue": { h: 275, c: 0.024, lift: 0 },
	"gray-cool": { h: 276, c: 0.02, lift: 0 },
	"gray-modern": { h: 263, c: 0.016, lift: 0 },
	"gray-neutral": { h: 0, c: 0, lift: 0 },
	"gray-iron": { h: 286, c: 0.006, lift: 0 },
	"gray-true": { h: 0, c: 0, lift: 0 },
	"gray-warm": { h: 56, c: 0.007, lift: 0 },
	/** Hazel's first dark theme: zinc's undertone with the page back at 0.19. */
	"gray-zinc": { h: 285.9, c: 0.006, lift: 0.005 },
} satisfies Record<Theme.GrayPalette, { h: number; c: number; lift: number }>

const TINT_PROPERTIES = ["--ink-h", "--ink-c", "--ink-lift"] as const

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
 * Apply a gray palette.
 *
 * Dark mode tints the ink ladder (`DARK_MODE_TINTS`). Light mode overrides the semantic tokens
 * (--secondary, --muted, etc.) with the palette's shades; "gray-neutral" and "gray-zinc" are the
 * CSS defaults (zinc), so they clear the overrides.
 */
export function applyGrayPalette(palette: Theme.GrayPalette, isDarkMode: boolean): void {
	if (typeof document === "undefined") return

	const root = document.documentElement
	resetGrayPalette()

	if (isDarkMode) {
		const tint = DARK_MODE_TINTS[palette]
		root.style.setProperty("--ink-h", String(tint.h))
		root.style.setProperty("--ink-c", String(tint.c))
		root.style.setProperty("--ink-lift", String(tint.lift))
		return
	}

	// Light mode: "gray-neutral" (and the classic zinc) are the CSS defaults; any other palette
	// swaps the semantic tokens for its shades.
	if (palette === "gray-neutral" || palette === "gray-zinc") return
	for (const [token, shade] of Object.entries(LIGHT_MODE_GRAY_TOKENS)) {
		root.style.setProperty(token, `var(--color-${palette}-${shade})`)
	}
}

/**
 * Reset gray palette overrides (restores original CSS defaults)
 */
export function resetGrayPalette(): void {
	if (typeof document === "undefined") return

	const root = document.documentElement
	for (const token of [...Object.keys(LIGHT_MODE_GRAY_TOKENS), ...TINT_PROPERTIES]) {
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
