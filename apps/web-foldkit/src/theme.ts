import { Theme } from "@hazel/domain/models"
import { Effect, Option, Schema } from "effect"
import { applyBrandColor, applyGrayPalette, applyRadius } from "~/lib/theme/apply"
import { DEFAULT_BRAND_COLOR, getDefaultThemeCustomization } from "~/lib/theme/presets"
import { readStored, writeStored } from "./data/storage"

/**
 * The legacy ThemeProvider (`components/theme-provider.tsx`), owned by the root: the stored mode and
 * customization (same keys and codecs as its atoms), the resolved theme, and the same DOM effects.
 */

export const ResolvedTheme = Schema.Literals(["light", "dark"])
export type ResolvedTheme = typeof ResolvedTheme.Type

/** `themeAtom`: what the user picked. */
export const ThemeMode = Schema.Literals(["system", "light", "dark"])
export type ThemeMode = typeof ThemeMode.Type

/** `themeCustomizationAtom`: brand color, gray palette and radius. */
export const ThemeCustomization = Schema.Struct({
	primary: Theme.HexColor,
	grayPalette: Theme.GrayPalette,
	radius: Theme.RadiusPreset,
})
export type ThemeCustomization = typeof ThemeCustomization.Type

export const ThemePreference = Schema.Struct({ mode: ThemeMode, customization: ThemeCustomization })
export type ThemePreference = typeof ThemePreference.Type

/** What pages read as `Shared.theme`: the preference plus `resolvedThemeAtom`. */
export interface ThemeState extends ThemePreference {
	readonly resolved: ResolvedTheme
}

export const defaultCustomization = (): ThemeCustomization => {
	const { primary, grayPalette, radius } = getDefaultThemeCustomization()
	return { primary, grayPalette, radius }
}

export const defaultThemePreference = (): ThemePreference => ({
	mode: "system",
	customization: defaultCustomization(),
})

export const resolveTheme = (mode: ThemeMode, system: ResolvedTheme): ResolvedTheme =>
	mode === "system" ? system : mode

export const resolveSystemTheme = (): ResolvedTheme =>
	window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"

// STORAGE

const MODE_KEY = "hazel-ui-theme"
const CUSTOMIZATION_KEY = "hazel-theme-customization"
const BRAND_COLOR_KEY = "brand-color"
const HexString = Schema.String.pipe(Schema.check(Schema.isPattern(/^#[0-9A-Fa-f]{6}$/)))
const ModeCodec = Schema.toCodecJson(Schema.NullOr(ThemeMode))
const BrandColorCodec = Schema.toCodecJson(Schema.NullOr(HexString))
const CustomizationCodec = Schema.toCodecJson(
	Schema.NullOr(
		Schema.Struct({
			primary: HexString,
			grayPalette: Theme.GrayPalette,
			radius: Theme.RadiusPreset,
		}),
	),
)
const decodeCustomization = Schema.decodeUnknownOption(ThemeCustomization)
const decodeHexColor = Schema.decodeUnknownOption(Theme.HexColor)

/**
 * The stored preference, with the atoms' defaults for a missing or undecodable key. A stored `null`
 * customization falls back to the legacy `brand-color` key (`applyBrandColorAtom`).
 */
export const loadThemePreference: Effect.Effect<ThemePreference> = Effect.gen(function* () {
	const mode = yield* readStored(MODE_KEY, ModeCodec)
	const stored = yield* readStored(CUSTOMIZATION_KEY, CustomizationCodec)
	const brandColor = yield* readStored(BRAND_COLOR_KEY, BrandColorCodec)
	const customization = Option.match(stored, {
		onNone: defaultCustomization,
		onSome: (value) =>
			value === null
				? {
						...defaultCustomization(),
						primary: Option.getOrElse(
							Option.flatMap(Option.flatMapNullishOr(brandColor, (hex) => hex), decodeHexColor),
							() => DEFAULT_BRAND_COLOR,
						),
					}
				: Option.getOrElse(decodeCustomization(value), defaultCustomization),
	})
	return { mode: Option.getOrNull(mode) ?? "system", customization }
})

/** `setTheme` / `setCustomization`: both atoms persist on every write. */
export const saveThemePreference = (preference: ThemePreference) =>
	Effect.all([
		writeStored(MODE_KEY, ModeCodec, preference.mode),
		writeStored(CUSTOMIZATION_KEY, CustomizationCodec, preference.customization),
	]).pipe(Effect.asVoid)

// DOM

/** `applyThemeAtom` and `applyThemeCustomizationAtom`: the `light`/`dark` class, then the variables. */
export const applyTheme = (resolved: ResolvedTheme, customization: ThemeCustomization) =>
	Effect.sync(() => {
		const root = document.documentElement
		if (!root.classList.contains(resolved)) {
			root.classList.add("no-transitions")
			root.classList.remove("light", "dark")
			root.classList.add(resolved)
			requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transitions")))
		}
		applyBrandColor(customization.primary)
		applyGrayPalette(customization.grayPalette, resolved === "dark")
		applyRadius(customization.radius)
	})
