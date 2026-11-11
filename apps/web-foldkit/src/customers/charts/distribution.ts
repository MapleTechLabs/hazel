import type { HealthBands, HealthDistributionRow, HealthStatus } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatCount, formatMoney, formatPct } from "../format"
import { HEALTH_FILL, HEALTH_LABEL } from "../ui/badges"
import { segmented } from "../ui/filter-bar"
import { chartCard } from "./frame"

/**
 * A segmented 100% bar and its legend table (Foundations › Distribution Bar Health), HTML like
 * Maple's `hbar-chart`.
 */

export type DistributionSegment = Readonly<{ key: string; label: string; value: number; fillClass: string }>

/** Segments sized by share; zero segments are left out. */
export const distributionBar = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		segments: ReadonlyArray<DistributionSegment>
		ariaLabel: string
		className?: string
	}>,
): Html => {
	const total = options.segments.reduce((sum, segment) => sum + segment.value, 0)
	return h.div(
		[
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(
				twMerge(
					"flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-secondary",
					options.className,
				),
			),
		],
		total === 0
			? []
			: options.segments
					.filter((segment) => segment.value > 0)
					.map((segment) =>
						h.span([
							h.Class(
								twMerge(
									"block h-full first:rounded-l-full last:rounded-r-full",
									segment.fillClass,
								),
							),
							h.Style({ width: `${(segment.value / total) * 100}%` }),
						]),
					),
	)
}

/** Share of `value` in `total`, as a whole percent (`0%` of nothing). */
export const shareOf = (value: number, total: number): number =>
	total === 0 ? 0 : Math.round((value / total) * 100)

export type HealthMetric = "customers" | "mrr"

const ORDER: ReadonlyArray<HealthStatus> = ["healthy", "at_risk", "critical", "unknown"]

const bandText = (status: HealthStatus, bands: HealthBands): string =>
	status === "healthy"
		? `≥ ${bands.healthyMin}`
		: status === "at_risk"
			? `${bands.atRiskMin}–${bands.healthyMin - 1}`
			: status === "critical"
				? `< ${bands.atRiskMin}`
				: "No data"

/** The overview's health card: bar by customers or MRR, then status · band · customers · MRR · share. */
export const healthDistribution = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		rows: ReadonlyArray<HealthDistributionRow>
		bands: HealthBands
		currency: string
		metric: HealthMetric
		onMetric: (metric: HealthMetric) => M
		className?: string
	}>,
): Html => {
	const byStatus = new Map(options.rows.map((row) => [row.status, row]))
	const rows = ORDER.map((status) => byStatus.get(status) ?? { status, count: 0, mrrMinor: 0 })
	const valueOf = (row: HealthDistributionRow) =>
		options.metric === "customers" ? row.count : row.mrrMinor
	const total = rows.reduce((sum, row) => sum + valueOf(row), 0)
	const customers = rows.reduce((sum, row) => sum + row.count, 0)
	const mrr = rows.reduce((sum, row) => sum + row.mrrMinor, 0)
	const cell = (text: string, className = "") =>
		h.td([h.Class(twMerge("py-2 text-right tabular-nums", className))], [text])
	return chartCard(
		h,
		{
			title: "Health distribution",
			description: `${formatCount(customers)} customers · ${formatMoney(mrr, options.currency)} MRR`,
			aside: segmented(h, {
				ariaLabel: "Measure health by",
				segments: [
					{ key: "customers", label: "Customers" },
					{ key: "mrr", label: "MRR" },
				],
				selected: options.metric,
				onSelect: options.onMetric,
			}),
			className: options.className,
		},
		[
			distributionBar(h, {
				ariaLabel: rows
					.map((row) => `${HEALTH_LABEL[row.status]} ${shareOf(valueOf(row), total)}%`)
					.join(", "),
				segments: rows.map((row) => ({
					key: row.status,
					label: HEALTH_LABEL[row.status],
					value: valueOf(row),
					fillClass: HEALTH_FILL[row.status],
				})),
			}),
			h.table(
				[h.Class("w-full text-sm")],
				[
					h.thead(
						[],
						[
							h.tr(
								[h.Class("border-border border-b text-muted-fg")],
								[
									h.th([h.Class("py-2 text-left font-normal")], ["Status"]),
									h.th([h.Class("py-2 text-right font-normal")], ["Customers"]),
									h.th([h.Class("py-2 text-right font-normal")], ["MRR"]),
									h.th([h.Class("py-2 text-right font-normal")], ["Share"]),
								],
							),
						],
					),
					h.tbody(
						[],
						rows.map((row) =>
							h.tr(
								[],
								[
									h.td(
										[h.Class("py-2")],
										[
											h.span(
												[h.Class("inline-flex items-center gap-2")],
												[
													h.span([
														h.Class(
															twMerge(
																"size-2.5 rounded-[2px]",
																HEALTH_FILL[row.status],
															),
														),
													]),
													h.span([h.Class("text-fg")], [HEALTH_LABEL[row.status]]),
													h.span(
														[h.Class("text-muted-fg text-xs")],
														[bandText(row.status, options.bands)],
													),
												],
											),
										],
									),
									cell(formatCount(row.count), "text-fg"),
									cell(formatMoney(row.mrrMinor, options.currency), "text-fg"),
									cell(
										formatPct(shareOf(valueOf(row), total), { digits: 0 }),
										"text-muted-fg",
									),
								],
							),
						),
					),
				],
			),
		],
	)
}
