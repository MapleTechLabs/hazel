import { Atom } from "effect/reactivity"
import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Theme as ThemeModel } from "@hazel/domain/models"
import { Schema } from "effect"
import { applyBrandColor, applyGrayPalette, applyRadius } from "~/lib/theme/apply"
import { DEFAULT_BRAND_COLOR, getDefaultThemeCustomization } from "~/lib/theme/presets"
import { platformStorageRuntime } from "~/lib/platform-storage"

export type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
	children: React.ReactNode
	defaultTheme?: Theme
	storageKey?: string
}

const ThemeSchema = Schema.Literals(["dark", "light", "system"])

const HexColorSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^#[0-9A-Fa-f]{6}$/)))

const GrayPaletteSchema = Schema.Literals([
	"gray",
	"gray-blue",
	"gray-cool",
	"gray-modern",
	"gray-neutral",
	"gray-iron",
	"gray-true",
	"gray-warm",
])

const RadiusPresetSchema = Schema.Literals(["tight", "normal", "round", "full"])

const ThemeCustomizationSchema = Schema.Struct({
	primary: HexColorSchema,
	grayPalette: GrayPaletteSchema,
	radius: RadiusPresetSchema,
})

type ThemeCustomization = typeof ThemeCustomizationSchema.Type

// Theme mode atom with automatic localStorage persistence
export const themeAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "hazel-ui-theme",
	schema: Schema.toCodecJson(Schema.NullOr(ThemeSchema)),
	defaultValue: () => "system" as Theme | null,
})

// Brand color atom (legacy, kept for backward compatibility)
export const brandColorAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "brand-color",
	schema: Schema.toCodecJson(Schema.NullOr(HexColorSchema)),
	defaultValue: () => DEFAULT_BRAND_COLOR as string | null,
})

// Full theme customization atom
export const themeCustomizationAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "hazel-theme-customization",
	schema: Schema.toCodecJson(Schema.NullOr(ThemeCustomizationSchema)),
	defaultValue: () => getDefaultThemeCustomization() as ThemeCustomization | null,
})

// Resolved theme (system -> light/dark)
export const resolvedThemeAtom = Atom.transform(themeAtom, (get) => {
	const theme = get(themeAtom)
	if (theme !== "system" && theme !== null) return theme

	if (typeof window === "undefined") return "light" as const

	// Listen to system theme changes
	const matcher = window.matchMedia("(prefers-color-scheme: dark)")

	matcher.addEventListener("change", onChange)
	get.addFinalizer(() => matcher.removeEventListener("change", onChange))

	return matcher.matches ? ("dark" as const) : ("light" as const)

	function onChange() {
		get.setSelf(matcher.matches ? ("dark" as const) : ("light" as const))
	}
})

// Apply dark/light mode to document
export const applyThemeAtom = Atom.make((get) => {
	const theme = get(resolvedThemeAtom)
	if (typeof document === "undefined") return

	const root = document.documentElement

	// Disable transitions during theme switch to prevent flash
	root.classList.add("no-transitions")

	root.classList.remove("light", "dark")
	root.classList.add(theme)

	// Re-enable transitions after the theme change has painted
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			root.classList.remove("no-transitions")
		})
	})
})

// Apply full theme customization to CSS variables
export const applyThemeCustomizationAtom = Atom.make((get) => {
	const customization = get(themeCustomizationAtom)
	const resolvedTheme = get(resolvedThemeAtom)
	if (typeof document === "undefined") return
	if (!customization) return

	const isDarkMode = resolvedTheme === "dark"

	// Apply all customization parts
	applyBrandColor(customization.primary as unknown as ThemeModel.HexColor)
	applyGrayPalette(customization.grayPalette as ThemeModel.GrayPalette, isDarkMode)
	applyRadius(customization.radius as ThemeModel.RadiusPreset)
})

// Legacy: Apply brand color from old atom (for backward compatibility)
export const applyBrandColorAtom = Atom.make((get) => {
	const brandColor = get(brandColorAtom)
	const customization = get(themeCustomizationAtom)

	// If we have a full customization, it takes precedence (handled by applyThemeCustomizationAtom)
	// Only apply legacy brand color if no customization exists
	if (customization) return

	if (typeof document === "undefined") return

	const hexColor = brandColor || DEFAULT_BRAND_COLOR
	applyBrandColor(hexColor as unknown as ThemeModel.HexColor)
})

export function ThemeProvider({ children }: ThemeProviderProps) {
	useAtomMount(applyThemeAtom)
	useAtomMount(applyThemeCustomizationAtom)
	useAtomMount(applyBrandColorAtom)

	return <>{children}</>
}

/**
 * Hook for basic theme controls (mode + brand color)
 * For full customization, use useThemeCustomization
 */
export const useTheme = () => {
	const theme = useAtomValue(themeAtom)
	const setTheme = useAtomSet(themeAtom)
	const brandColor = useAtomValue(brandColorAtom)
	const setBrandColor = useAtomSet(brandColorAtom)
	const customization = useAtomValue(themeCustomizationAtom)
	const setCustomization = useAtomSet(themeCustomizationAtom)

	// When setting brand color, also update the customization
	const handleSetBrandColor = (color: string) => {
		setBrandColor(color as string & null)
		if (customization) {
			setCustomization({
				...customization,
				primary: color,
			} as unknown as ThemeCustomization)
		}
	}

	return {
		theme: (theme || "system") as Theme,
		setTheme: setTheme as (value: Theme | null) => void,
		brandColor: (customization?.primary || brandColor || DEFAULT_BRAND_COLOR) as string,
		setBrandColor: handleSetBrandColor,
	}
}

/**
 * Hook for full theme customization
 */
export const useThemeCustomization = () => {
	const customization = useAtomValue(themeCustomizationAtom)
	const setCustomization = useAtomSet(themeCustomizationAtom)
	const resolvedTheme = useAtomValue(resolvedThemeAtom)

	const activeCustomization = customization || getDefaultThemeCustomization()

	const setPrimary = (color: string) => {
		setCustomization({
			...activeCustomization,
			primary: color,
		} as unknown as ThemeCustomization)
	}

	const setGrayPalette = (palette: ThemeModel.GrayPalette) => {
		setCustomization({
			...activeCustomization,
			grayPalette: palette,
		} as unknown as ThemeCustomization)
	}

	const setRadius = (radius: ThemeModel.RadiusPreset) => {
		setCustomization({
			...activeCustomization,
			radius: radius,
		} as unknown as ThemeCustomization)
	}

	const setFullCustomization = (newCustomization: ThemeModel.ThemeCustomization) => {
		setCustomization(newCustomization as unknown as ThemeCustomization)
	}

	return {
		customization: activeCustomization as ThemeModel.ThemeCustomization,
		isDarkMode: resolvedTheme === "dark",
		setPrimary,
		setGrayPalette,
		setRadius,
		setFullCustomization,
	}
}
