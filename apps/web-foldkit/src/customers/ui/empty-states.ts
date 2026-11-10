import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconCheck, IconConnect, IconMagnifier3, IconPlus } from "../../icons"
import { button } from "../../ui/button"
import { emptyState } from "../../ui/empty-state"

/**
 * The Customers empty states (Foundations › Empty State Variants) over the app's `emptyState`:
 * all clear, no data source, no results. `framed` puts them in a bordered panel.
 */

const frame = <M>(h: HtmlBuilder<M>, framed: boolean, className: string | undefined, child: Html): Html =>
	framed
		? h.div(
				[
					h.Class(
						twMerge(
							"flex items-center justify-center rounded-xl border border-border px-6",
							className,
						),
					),
				],
				[child],
			)
		: child

/** The queue with nothing open: `All clear`, and how many snoozed signals wake this week. */
export const allClearState = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ snoozedCount: number; onViewSnoozed?: M; framed?: boolean; className?: string }>,
): Html =>
	frame(
		h,
		options.framed ?? true,
		options.className,
		emptyState(h, {
			title: "All clear",
			icon: (className) => IconCheck(h, { className }),
			description:
				options.snoozedCount === 0
					? "No open signals assigned to you."
					: `No open signals assigned to you. ${options.snoozedCount} snoozed ${options.snoozedCount === 1 ? "signal wakes" : "signals wake"} up this week.`,
			action:
				options.snoozedCount > 0 && options.onViewSnoozed !== undefined
					? button(h, { intent: "outline", size: "sm", onPress: options.onViewSnoozed }, [
							"View snoozed",
						])
					: undefined,
		}),
	)

/** No source connected: start with Clerk. `action` overrides the default `+ Connect Clerk` button. */
export const noSourcesState = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ onConnect?: M; action?: Html; framed?: boolean; className?: string }>,
): Html =>
	frame(
		h,
		options.framed ?? true,
		options.className,
		emptyState(h, {
			title: "Connect a data source",
			icon: (className) => IconConnect(h, { className }),
			description: "Start with Clerk to import your organizations, then add Stripe for revenue.",
			action:
				options.action ??
				(options.onConnect === undefined
					? undefined
					: button(h, { intent: "primary", size: "sm", onPress: options.onConnect }, [
							IconPlus(h),
							"Connect Clerk",
						])),
		}),
	)

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
