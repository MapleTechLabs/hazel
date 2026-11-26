// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The GIF picker (`emoji-gif-picker`): a web-only platform extension, a third-party search widget.
 * iOS draws the fallback (nothing, or a screen's own). Declared in phase 1.5; lane A3 registers it.
 */
import { Schema } from "effect"
import { extension } from "../vocabulary/Hazel.ts"

export const GifPicker = extension({
	name: "GifPicker",
	props: Schema.Struct({ open: Schema.Boolean }),
	events: { select: Schema.Struct({ url: Schema.String }), dismiss: Schema.Struct({}) },
	platforms: ["web"],
})
