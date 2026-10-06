import type { Theme } from "@hazel/domain/models"
import { Effect, Schema } from "effect"
import { applyBrandColor, applyGrayPalette, applyRadius } from "~/lib/theme/apply"
import { getDefaultThemeCustomization } from "~/lib/theme/presets"

/**
 * Same DOM effects as the legacy ThemeProvider atoms: `light`/`dark` class on <html>,
 * then brand color, gray palette and radius CSS variables.
 */
export const ResolvedTheme = Schema.Literals(["light", "dark"])
export type ResolvedTheme = typeof ResolvedTheme.Type

export const resolveSystemTheme = (): ResolvedTheme =>
	window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"

export const applyTheme = (theme: ResolvedTheme) =>
	Effect.sync(() => {
		const root = document.documentElement
		root.classList.add("no-transitions")
		root.classList.remove("light", "dark")
		root.classList.add(theme)
		requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transitions")))

		const customization = getDefaultThemeCustomization()
		applyBrandColor(customization.primary as Theme.HexColor)
		applyGrayPalette(customization.grayPalette as Theme.GrayPalette, theme === "dark")
		applyRadius(customization.radius as Theme.RadiusPreset)
	})
