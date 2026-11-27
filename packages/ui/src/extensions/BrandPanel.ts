// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The auth frame's brand panel (lane PA1, `p4-auth-brand-panel`): the season's pixel picture for the
 * local time of day, the logo linking home, and an optional tagline card. Drawn in `screen`'s `aside`
 * (`centered`); web only, so iOS draws the fallback (nothing, the panel is decoration).
 */
import { Schema } from "effect"
import { extension } from "../vocabulary/Hazel.ts"

export const BrandPanel = extension({
	name: "BrandPanel",
	props: Schema.Struct({
		/** The folder of `<spring|summer|autumn|winter>-<day|night>.webp`, e.g. `/images/onboarding`. */
		pictures: Schema.String,
		/** Where the logo goes (the app's root). */
		homeHref: Schema.String,
		/** The card's text; `null` draws the panel without the card. */
		tagline: Schema.NullOr(Schema.String),
	}),
	platforms: ["web"],
})
