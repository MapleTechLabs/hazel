import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { defineStaticLab } from "../../../define"
import { labPage, labSection } from "../../../frame"

// `/lab/customers/kit/tokens`: the Customers color tokens (`theme.css` › Customers).

const swatch = <M>(h: HtmlBuilder<M>, fill: string, name: string, note?: string): Html =>
	h.div(
		[h.Class("flex w-32 flex-col gap-1.5")],
		[
			h.span([h.Class(twMerge("block h-6 rounded", fill))]),
			h.span([h.Class("font-mono text-xs")], [name]),
			...(note ? [h.span([h.Class("text-muted-fg text-xs")], [note])] : []),
		],
	)

export const lab = defineStaticLab("Customers tokens", (h) =>
	labPage(h, { title: "Customers tokens", description: "Marks only: text never takes a chart color." }, [
		labSection(h, "Chart", [
			h.div(
				[h.Class("flex flex-wrap gap-3")],
				[
					swatch(h, "bg-chart-new", "chart-new", "new / healthy"),
					swatch(h, "bg-chart-expansion", "chart-expansion"),
					swatch(h, "bg-chart-contraction", "chart-contraction", "contraction / at risk"),
					swatch(h, "bg-chart-churn", "chart-churn", "churn / critical"),
					swatch(h, "bg-chart-neutral", "chart-neutral", "neutral / unknown"),
					swatch(h, "bg-chart-series-1", "chart-series-1", "DAU"),
					swatch(h, "bg-chart-series-2", "chart-series-2", "WAU"),
					swatch(h, "bg-chart-series-3", "chart-series-3", "MAU"),
					swatch(h, "bg-chart-grid", "chart-grid"),
					swatch(h, "bg-chart-net", "chart-net", "net line"),
				],
			),
		]),
		labSection(h, "Health", [
			h.div(
				[h.Class("flex flex-wrap gap-3")],
				[
					swatch(h, "bg-health-healthy", "health-healthy"),
					swatch(h, "bg-health-at-risk", "health-at-risk"),
					swatch(h, "bg-health-critical", "health-critical"),
					swatch(h, "bg-health-unknown", "health-unknown"),
				],
			),
		]),
		labSection(h, "Severity", [
			h.div(
				[h.Class("flex flex-wrap gap-3")],
				[
					swatch(h, "bg-severity-high", "severity-high"),
					swatch(h, "bg-severity-medium", "severity-medium"),
					swatch(h, "bg-severity-low", "severity-low"),
					swatch(h, "bg-severity-off", "severity-off", "unlit bar"),
				],
			),
		]),
	]),
)
