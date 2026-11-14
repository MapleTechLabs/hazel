import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { type DeltaTone, deltaTone } from "../format"
import { IconArrowDown, IconArrowUp } from "./icons"

/**
 * KPI tiles (Foundations › KPI Tile Variants): positive, negative, neutral, ratio, loading, empty.
 * The label carries the metric's definition in a hover/focus card, so every number explains itself.
 */

const TONE_TEXT = {
	positive: "text-success-subtle-fg",
	negative: "text-danger-subtle-fg",
	neutral: "text-muted-fg",
} as const satisfies Record<DeltaTone, string>

/** A change: its value (sign = direction), its text, and which direction is good for the metric. */
export type Delta = Readonly<{ value: number; text: string; goodWhen?: "up" | "down" }>

/** `↑ 6.2%` green when good, red when bad, grey and arrowless when flat. */
export const deltaPill = <M>(h: HtmlBuilder<M>, delta: Delta, className?: string): Html => {
	const tone = deltaTone(delta.value, delta.goodWhen ?? "up")
	return h.span(
		[
			h.Class(
				twMerge(
					"inline-flex items-center gap-0.5 whitespace-nowrap font-medium tabular-nums",
					TONE_TEXT[tone],
					className,
				),
			),
		],
		[
			...(delta.value > 0
				? [IconArrowUp(h, { className: "size-3.5" })]
				: delta.value < 0
					? [IconArrowDown(h, { className: "size-3.5" })]
					: []),
			delta.text,
		],
	)
}

/** A label that reveals `definition` on hover or focus (CSS only: no state to keep). */
export const definedLabel = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ id: string; label: string; definition?: string; className?: string }>,
): Html =>
	options.definition === undefined
		? h.span([h.Class(twMerge("text-muted-fg text-sm", options.className))], [options.label])
		: h.span(
				[h.Class(twMerge("group/definition relative inline-flex", options.className))],
				[
					h.button(
						[
							h.Type("button"),
							h.AriaDescribedBy(`${options.id}-definition`),
							h.Class(
								"cursor-help text-left text-muted-fg text-sm underline decoration-muted-fg/40 decoration-dotted underline-offset-4 outline-hidden hover:text-fg focus-visible:text-fg",
							),
						],
						[options.label],
					),
					h.span(
						[
							h.Id(`${options.id}-definition`),
							h.Role("tooltip"),
							// A phone: out of the layout until the label is tapped (an invisible card still widens the
							// page), then a card across the screen above the tab bar, wherever the tile sits.
							h.Class(
								"pointer-events-none invisible absolute top-full left-0 z-20 mt-2 w-64 rounded-lg border border-fg/10 bg-overlay px-3 py-2 text-overlay-fg text-xs/5 opacity-0 shadow-md transition-opacity duration-150 group-focus-within/definition:visible group-focus-within/definition:opacity-100 group-hover/definition:visible group-hover/definition:opacity-100 " +
									"max-md:fixed max-md:inset-x-4 max-md:top-auto max-md:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] max-md:mt-0 max-md:hidden max-md:w-auto max-md:text-sm/5 max-md:group-focus-within/definition:block max-md:group-hover/definition:block",
							),
						],
						[options.definition],
					),
				],
			)

export type KpiTileOptions = Readonly<{
	/** Unique on the page: names the definition card. */
	id: string
	label: string
	/** What the number means and how it is computed. */
	definition?: string
	/** `$48,210`; ignored while loading or empty. */
	value?: string
	/** Beside the value: `978 / 1,611` (ratio tiles). */
	detail?: string
	delta?: Delta | null
	/** `vs previous 30 days`. */
	comparison?: string
	/** Right of the value: a `sparkline(…, { size: "md", area: true })`. */
	trend?: Html
	state?: "ready" | "loading" | "empty"
	/** Empty: the reason and the way out (`Connect Stripe to track revenue`, a link or button). */
	emptyAction?: Html
	className?: string
}>

export const kpiTile = <M>(h: HtmlBuilder<M>, options: KpiTileOptions): Html => {
	const state = options.state ?? "ready"
	const body =
		state === "loading"
			? [
					h.div(
						[h.AriaHidden(true), h.Class("flex items-end justify-between gap-4")],
						[
							h.span([h.Class("h-8 w-24 animate-pulse rounded-md bg-secondary")]),
							h.span([h.Class("h-4 w-20 animate-pulse rounded bg-secondary")]),
						],
					),
					h.span([h.AriaHidden(true), h.Class("h-4 w-36 animate-pulse rounded bg-secondary")]),
					h.span([h.Class("sr-only")], ["Loading"]),
				]
			: state === "empty"
				? [
						h.span([h.Class("font-semibold text-2xl/8 text-muted-fg")], ["—"]),
						...(options.emptyAction ? [h.div([h.Class("text-sm")], [options.emptyAction])] : []),
					]
				: [
						h.div(
							[h.Class("flex items-end justify-between gap-4")],
							[
								h.div(
									// A narrow tile wraps the detail under the value instead of cutting it off.
									[h.Class("flex min-w-0 flex-wrap items-baseline gap-x-2")],
									[
										h.span(
											[
												h.Class(
													"font-semibold text-2xl/8 text-fg tabular-nums tracking-tight max-md:text-xl/7",
												),
											],
											[options.value ?? "—"],
										),
										...(options.detail
											? [
													h.span(
														[
															h.Class(
																"min-w-0 truncate text-muted-fg text-sm tabular-nums",
															),
														],
														[options.detail],
													),
												]
											: []),
									],
								),
								...(options.trend ? [options.trend] : []),
							],
						),
						...(options.delta || options.comparison
							? [
									h.p(
										[h.Class("flex flex-wrap items-center gap-x-1.5 text-sm")],
										[
											...(options.delta ? [deltaPill(h, options.delta)] : []),
											...(options.comparison
												? [
														h.span(
															[h.Class("whitespace-nowrap text-muted-fg")],
															[options.comparison],
														),
													]
												: []),
										],
									),
								]
							: []),
					]
	return h.div(
		[
			...(state === "loading" ? [h.AriaBusy(true)] : []),
			h.Class(
				twMerge(
					"flex min-w-0 flex-col gap-2 rounded-xl border bg-bg p-4 max-md:p-3",
					state === "empty" ? "border-border border-dashed" : "border-border",
					options.className,
				),
			),
		],
		[
			definedLabel(h, {
				id: options.id,
				label: options.label,
				definition: options.definition,
			}),
			...body,
		],
	)
}
