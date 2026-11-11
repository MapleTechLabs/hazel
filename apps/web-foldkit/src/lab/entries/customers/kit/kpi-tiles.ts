import { sparkline } from "../../../../customers/charts/sparkline"
import {
	formatCount,
	formatDeltaPct,
	formatDeltaPoints,
	formatMoney,
	formatPct,
} from "../../../../customers/format"
import { kpiTile } from "../../../../customers/ui/kpi-tile"
import { defineStaticLab } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { overviewFixture } from "../../../fixtures/customers"

// `/lab/customers/kit/kpi-tiles`: Foundations › KPI Tile Variants. Hover or focus a label for its definition.

const overview = overviewFixture("30d")
const mrrTrend = [41_200, 42_000, 42_900, 43_300, 44_800, 45_400, 46_100, 47_300, 48_210]
const churnTrend = [1.6, 1.9, 1.8, 2.1, 2.2, 2.4, 2.6, 2.8]
const activeTrend = [166, 169, 167, 170, 168, 167, 169, 168, 168]

export const lab = defineStaticLab("KPI tiles", (h) =>
	labPage(h, { title: "KPI tiles" }, [
		labSection(
			h,
			"Positive · negative · neutral · ratio · loading · empty",
			[
				kpiTile(h, {
					id: "mrr",
					label: "MRR",
					definition:
						"Monthly recurring revenue: the sum of every non-canceled subscription, normalized to a month.",
					value: formatMoney(overview.kpis.mrrMinor.value),
					delta: { value: 6.2, text: formatDeltaPct(6.2) },
					comparison: "vs previous 30 days",
					trend: sparkline(h, {
						values: mrrTrend,
						size: "md",
						area: true,
						ariaLabel: "MRR, up 6.2%",
					}),
				}),
				kpiTile(h, {
					id: "churn",
					label: "Logo churn",
					definition:
						"Customers that churned in the period, as a share of the customers at its start.",
					value: formatPct(overview.kpis.logoChurn.value),
					delta: { value: 0.9, text: formatDeltaPoints(0.9), goodWhen: "down" },
					comparison: "vs previous 30 days",
					trend: sparkline(h, {
						values: churnTrend,
						size: "md",
						area: true,
						tone: "negative",
						ariaLabel: "Logo churn, up 0.9 points",
					}),
				}),
				kpiTile(h, {
					id: "active",
					label: "Active customers",
					definition: "Customers with at least one active user in the last 30 days.",
					value: formatCount(overview.kpis.activeCustomers.value),
					delta: { value: 0, text: "0.0%" },
					comparison: "vs previous 30 days",
					trend: sparkline(h, {
						values: activeTrend,
						size: "md",
						tone: "neutral",
						ariaLabel: "Active customers, flat",
					}),
				}),
				kpiTile(h, {
					id: "stickiness",
					label: "Stickiness (WAU ÷ MAU)",
					definition:
						"Weekly active users divided by monthly active users: how often monthly users come back.",
					value: formatPct(overview.kpis.stickinessPct.value),
					detail: `${formatCount(overview.kpis.wau.value)} / ${formatCount(overview.kpis.mau.value)}`,
					delta: { value: 2, text: formatDeltaPoints(2) },
					comparison: "vs previous 30 days",
				}),
				kpiTile(h, { id: "paying", label: "Paying customers", state: "loading" }),
				kpiTile(h, {
					id: "at-risk",
					label: "At-risk MRR",
					definition: "MRR of customers with an open high-severity risk signal.",
					state: "empty",
					emptyAction: h.a(
						[h.Href("#"), h.Class("text-primary-subtle-fg hover:underline")],
						["Connect Stripe to track revenue"],
					),
				}),
			],
			"grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
		),
	]),
)
