// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A bot's HTML render (`MessageEmbed.html`): its page in a sandboxed frame, from a short-lived
 * signed URL the screen loads. A web-only platform extension (phase 4, lane PC6); the web draws the
 * frame, sizes it to the page, themes it and offers "Show more" and fullscreen. iOS draws the fallback.
 */
import { Schema } from "effect"
import { extension } from "../vocabulary/Hazel.ts"

export const HtmlRenderMode = Schema.Literals(["inline", "fullscreen"])
export type HtmlRenderMode = typeof HtmlRenderMode.Type

export const HtmlRender = extension({
	name: "HtmlRender",
	props: Schema.Struct({
		/** The signed URL; null while it is fetched. */
		src: Schema.NullOr(Schema.String),
		/** The page's title: the frame's accessible name and the failure copy. */
		title: Schema.String,
		/** The frame's height until the page reports its own, in CSS pixels. */
		height: Schema.Finite,
		/** The URL could not be had: the frame shows why instead. */
		failed: Schema.Boolean,
		mode: HtmlRenderMode,
	}),
	events: {
		/** The reader clicked a link in the page. */
		openLink: Schema.Struct({ url: Schema.String }),
		fullscreen: Schema.Struct({}),
		/** Escape inside the fullscreen page, which holds the keyboard while it has focus. */
		leaveFullscreen: Schema.Struct({}),
	},
	platforms: ["web"],
})
