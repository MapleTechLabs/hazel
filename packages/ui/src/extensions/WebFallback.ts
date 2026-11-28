// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A route the native app has no shared screen for yet: the app draws the web app at `path` there
 * (`apps/ios/Hazel/FallbackPage.swift`), pushed like any screen. iOS only; it goes away
 * route by route as the shared screens reach the phone (`docs/ios-native.md`).
 */
import { Schema } from "effect"
import { extension } from "../vocabulary/Hazel.ts"

export const WebFallback = extension({
	name: "WebFallback",
	props: Schema.Struct({ path: Schema.String }),
	platforms: ["ios"],
})
