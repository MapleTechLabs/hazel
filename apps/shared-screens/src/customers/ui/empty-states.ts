// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The Customers empty states (today's `web-foldkit/src/customers/ui/empty-states.ts`) on the
 * hazel `emptyState`: no results, framed in a card unless `framed: false`.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"

/** Filters or search matched nothing. */
export const noResultsState = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		title?: string
		description?: string
		onClear?: Msg
		clearLabel?: string
		framed?: boolean
	}> = {},
) => {
	const empty = h.emptyState
		.title(options.title ?? "No customers match")
		.description(options.description ?? "Remove a filter or search by domain instead of name.")
		.icon("search")
	const state =
		options.onClear === undefined
			? empty
			: empty.action(
					h.button
						.label(options.clearLabel ?? "Clear filters")
						.variant("ghost")
						.size("small")
						.on("press", options.onClear),
				)
	return options.framed === false ? state : h.frame.children(state)
}
