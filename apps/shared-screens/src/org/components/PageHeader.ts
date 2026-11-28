// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Today's `pageHeader` (`web-foldkit/src/ui/page-header.ts`) for a wide page: the display title over
 * a muted subtitle, the actions at the row's end. `screen` `page` is the phone's 56pt bar, so a wide
 * page composes it (`p4-screen-page-column`).
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"

export const pageHeader = <Msg>(
	h: Hazel.H<Msg>,
	options: { readonly title: string; readonly subtitle?: string },
	...actions: ReadonlyArray<unknown>
) =>
	// Today's actions wrap under the title when the page is narrow.
	h.stack
		.axis("horizontal")
		.align("start")
		.wrap()
		.children(
			// The kit's `gap-0.5` between the title and the subtitle.
			h.stack
				.density("tight")
				.children(
					h.heading.level("1").children(options.title),
					options.subtitle === undefined
						? undefined
						: h.text.role("label").tone("muted").children(options.subtitle),
				),
			h.spacer,
			...(actions as Array<never>),
		)
