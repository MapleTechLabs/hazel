// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The GIF picker (`emoji-gif-picker`): a web-only platform extension, a third-party search widget.
 * iOS draws the fallback (nothing, or a screen's own). The screen owns the search (`gif-picker-results`):
 * it answers `query`, `category` and `reachEnd` with `gifs`, `categories`, `status` and `paging`.
 */
import { Schema } from "effect"
import { extension } from "../vocabulary/Hazel.ts"

/** One result: the still the grid shows, the animation under the pointer, and the URL a pick sends. */
export const GifItem = Schema.Struct({
	url: Schema.String,
	still: Schema.String,
	animated: Schema.String,
	title: Schema.String,
	width: Schema.Finite,
	height: Schema.Finite,
})
export type GifItem = typeof GifItem.Type

/** A category chip under the search field (Trending searches by `query`). */
export const GifCategory = Schema.Struct({ label: Schema.String, query: Schema.String })
export type GifCategory = typeof GifCategory.Type

/** Why the first page failed, as the screen words it. */
export const GifFailureText = Schema.Struct({ title: Schema.String, description: Schema.String })

export const GifPicker = extension({
	name: "GifPicker",
	props: Schema.Struct({
		open: Schema.Boolean,
		gifs: Schema.optional(Schema.Array(GifItem)),
		categories: Schema.optional(Schema.Array(GifCategory)),
		/** The chip whose `query` is showing. */
		category: Schema.optional(Schema.String),
		/** The categories could not load: a small line with a retry (`retryCategories`). */
		categoriesFailed: Schema.optional(Schema.Boolean),
		/** The first page: loading (a spinner), ready, or failed (`failure`, with `retry`). */
		status: Schema.optional(Schema.Literals(["loading", "ready", "failed"])),
		failure: Schema.optional(GifFailureText),
		/** The next page: none asked, loading, no more, or failed (`retry`). */
		paging: Schema.optional(Schema.Literals(["idle", "loading", "done", "failed"])),
	}),
	events: {
		select: Schema.Struct({ url: Schema.String }),
		dismiss: Schema.Struct({}),
		/** The search text, after today's 300ms pause; "" is trending. */
		query: Schema.Struct({ text: Schema.String }),
		/** A chip pressed: its query, or "" when the pressed chip was the one showing. */
		category: Schema.Struct({ query: Schema.String }),
		/** Scrolled within half a view of the end, with more to load. */
		reachEnd: Schema.Struct({}),
		retry: Schema.Struct({}),
		retryCategories: Schema.Struct({}),
	},
	platforms: ["web"],
})
