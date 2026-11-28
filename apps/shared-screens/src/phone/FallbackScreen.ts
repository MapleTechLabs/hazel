// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A screen the phone draws as the web app at `path` (`WebFallback`), for a route with no shared
 * screen yet: pushed in `PhoneShell`, or on its own before the shell (a new account's onboarding).
 */
import { UiSchema } from "@effect/ui"
import { WebFallback } from "@hazel/ui/extensions/WebFallback"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"

export const FallbackScreen = Hazel.component({
	name: "FallbackScreen",
	props: Schema.Struct({ path: Schema.String, title: Schema.String }),
	model: Schema.Struct({}),
	message: UiSchema.TaggedEnum({ Noop: {} }),
}).make({
	init: () => ({}),
	update: { Noop: ($) => $.model },
	view: (h) =>
		h.screen
			.key(h.props.path)
			.title(h.props.title)
			.surface("page")
			// The list over the composer, or the page, has the whole height and scrolls itself.
			.fill(true)
			.children(h.extension(WebFallback, { path: h.props.path })),
})
