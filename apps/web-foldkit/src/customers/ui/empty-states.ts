import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconMagnifier3 } from "../../icons"
import { button } from "../../ui/button"
import { cardClassName } from "../../ui/card"
import { emptyState } from "../../ui/empty-state"

/**
 * The Customers empty states (Foundations › Empty State Variants) over the app's `emptyState`:
 * no results. `framed` puts it in a bordered panel.
 */

const frame = <M>(h: HtmlBuilder<M>, framed: boolean, className: string | undefined, child: Html): Html =>
	framed
		? h.div(
				[h.Class(cardClassName(twMerge("flex items-center justify-center px-6", className)))],
				[child],
			)
		: child

/** Filters or search matched nothing. */
export const noResultsState = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title?: string
		description?: string
		onClear?: M
		clearLabel?: string
		framed?: boolean
		className?: string
	}>,
): Html =>
	frame(
		h,
		options.framed ?? true,
		options.className,
		emptyState(h, {
			title: options.title ?? "No customers match",
			icon: (className) => IconMagnifier3(h, { className }),
			description: options.description ?? "Remove a filter or search by domain instead of name.",
			action:
				options.onClear === undefined
					? undefined
					: button(h, { intent: "plain", size: "sm", onPress: options.onClear }, [
							options.clearLabel ?? "Clear filters",
						]),
		}),
	)
