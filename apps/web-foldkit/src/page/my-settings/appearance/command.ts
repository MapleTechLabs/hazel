import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import { applyBrandColor, applyGrayPalette, applyRadius } from "~/lib/theme/apply"
import { getDefaultThemeCustomization } from "~/lib/theme/presets"
import { generateRemixOptions } from "~/lib/theme/remix"
import { resolveSystemTheme } from "../../../theme"
import { readStored, writeStored } from "../storage"
import { Message } from "./message"
import { Customization, ThemeMode } from "./model"

/** Same keys and codecs as `themeAtom` and `themeCustomizationAtom` (`components/theme-provider.tsx`). */
const MODE_KEY = "hazel-ui-theme"
const CUSTOMIZATION_KEY = "hazel-theme-customization"
const ModeCodec = Schema.toCodecJson(Schema.NullOr(ThemeMode))
const StoredCustomization = Schema.Struct({
	primary: Schema.String.pipe(Schema.check(Schema.isPattern(/^#[0-9A-Fa-f]{6}$/))),
	grayPalette: Customization.fields.grayPalette,
	radius: Customization.fields.radius,
})
const CustomizationCodec = Schema.toCodecJson(Schema.NullOr(StoredCustomization))
const decodeCustomization = Schema.decodeUnknownOption(Customization)

export const defaultCustomization = (): Customization => {
	const { primary, grayPalette, radius } = getDefaultThemeCustomization()
	return { primary, grayPalette, radius }
}

export const LoadAppearance = Command.define("LoadAppearance", {
	args: {},
	messages: [Message.LoadedAppearance],
	execute: () =>
		Effect.all([readStored(MODE_KEY, ModeCodec), readStored(CUSTOMIZATION_KEY, CustomizationCodec)]).pipe(
			Effect.map(([mode, customization]) =>
				Message.LoadedAppearance({
					mode: Option.getOrNull(mode) ?? "system",
					customization: Option.getOrElse(
						Option.flatMap(
							Option.flatMapNullishOr(customization, (value) => value),
							decodeCustomization,
						),
						defaultCustomization,
					),
				}),
			),
		),
})

/**
 * The legacy ThemeProvider atoms' DOM effects (`light`/`dark` class, brand, gray and radius
 * variables), plus persistence so the choice survives a reload.
 */
export const ApplyAppearance = Command.define("ApplyAppearance", {
	args: { mode: ThemeMode, customization: Customization, shouldPersist: Schema.Boolean },
	messages: [Message.CompletedApplyAppearance],
	execute: ({ mode, customization, shouldPersist }) =>
		Effect.gen(function* () {
			yield* Effect.sync(() => {
				const resolved = mode === "system" ? resolveSystemTheme() : mode
				const root = document.documentElement
				if (!root.classList.contains(resolved)) {
					root.classList.add("no-transitions")
					root.classList.remove("light", "dark")
					root.classList.add(resolved)
					requestAnimationFrame(() =>
						requestAnimationFrame(() => root.classList.remove("no-transitions")),
					)
				}
				applyBrandColor(customization.primary)
				applyGrayPalette(customization.grayPalette, resolved === "dark")
				applyRadius(customization.radius)
			})
			if (shouldPersist) {
				yield* writeStored(MODE_KEY, ModeCodec, mode)
				yield* writeStored(CUSTOMIZATION_KEY, CustomizationCodec, customization)
			}
			return Message.CompletedApplyAppearance()
		}),
})

/**
 * `ThemeRemixSection.handleGenerate`: the legacy generator (Math.random), shown after its 150ms delay.
 * Generating before the delay keeps the draws independent of the fiber scheduling around it.
 */
export const GenerateRemixOptions = Command.define("GenerateRemixOptions", {
	args: {},
	messages: [Message.GeneratedRemixOptions],
	execute: () =>
		Effect.sync(() =>
			Message.GeneratedRemixOptions({
				options: generateRemixOptions(4).map(({ primary, grayPalette, radius }) => ({
					primary,
					grayPalette,
					radius,
				})),
			}),
		).pipe(Effect.tap(() => Effect.sleep("150 millis"))),
})
