import { barSparkline, evidenceBars, meter, sparkline } from "../../../../customers/charts/sparkline"
import { evidenceViz } from "../../../../customers/ui/evidence"
import { defineStaticLab } from "../../../define"
import { labPage, labRow, labSection } from "../../../frame"
import type { SignalEvidence } from "@hazel/domain/customers"
import { DAU_14D, SIGNALS } from "../../../fixtures/customers"

// `/lab/customers/kit/sparklines`: Foundations › Sparkline Variants and Evidence Row.

const up = [10, 12, 11, 14, 15, 15, 17, 18, 21, 22]
const down = [22, 21, 21, 18, 17, 15, 14, 14, 12, 10]
const flat = [14, 15, 13, 15, 14, 13, 15, 14, 14, 15]
const evidenceOf = <Tag extends SignalEvidence["_tag"]>(tag: Tag) =>
	SIGNALS.map((signal) => signal.evidence).find(
		(evidence): evidence is Extract<SignalEvidence, { _tag: Tag }> => evidence._tag === tag,
	)
const amount = evidenceOf("amount")
const usageDrop = evidenceOf("series")

export const lab = defineStaticLab("Sparklines", (h) =>
	labPage(h, { title: "Sparklines" }, [
		labSection(h, "80×24 inline", [
			labRow(h, [
				sparkline(h, { values: up, endDot: true, ariaLabel: "Up 42%" }),
				h.span([h.Class("text-sm text-success-subtle-fg")], ["+42%"]),
				sparkline(h, { values: down, endDot: true, ariaLabel: "Down 38%" }),
				h.span([h.Class("text-danger-subtle-fg text-sm")], ["−38%"]),
				sparkline(h, { values: flat, endDot: true, tone: "neutral", ariaLabel: "Flat" }),
				h.span([h.Class("text-muted-fg text-sm")], ["+1%"]),
			]),
		]),
		labSection(h, "120×32 card", [
			labRow(
				h,
				[
					sparkline(h, { values: up, size: "md", area: true, ariaLabel: "Up" }),
					sparkline(h, { values: down, size: "md", area: true, ariaLabel: "Down" }),
					sparkline(h, { values: flat, size: "md", tone: "neutral", ariaLabel: "Flat" }),
					sparkline(h, { values: [5], size: "md", ariaLabel: "One point" }),
					sparkline(h, { values: [], size: "md", ariaLabel: "No data" }),
				],
				"Last two: one point, no data",
			),
		]),
		labSection(h, "Mini bars · invoice evidence · limit", [
			labRow(h, [
				barSparkline(h, {
					values: DAU_14D,
					highlightLast: true,
					ariaLabel: "Daily active users, 14 days",
				}),
				h.span([h.Class("text-muted-fg text-sm")], ["Daily active users, 14d"]),
				amount === undefined ? h.empty : evidenceViz(h, amount),
				meter(h, { value: 461_000, limit: 500_000, ariaLabel: "92% of limit" }),
				meter(h, { value: 500_000, limit: 500_000, ariaLabel: "100% of limit" }),
				meter(h, { value: 610_000, limit: 500_000, ariaLabel: "122% of limit" }),
			]),
		]),
		labSection(h, "Evidence bars: recent window vs dashed baseline", [
			usageDrop !== undefined
				? evidenceBars(h, {
						values: usageDrop.series.map((point) => point.value),
						highlightFrom: usageDrop.series.length - usageDrop.recentDays,
						baseline: usageDrop.baselineAvg,
						ariaLabel: "Daily active users, 35 days, last 7 highlighted",
						className: "max-w-md",
					})
				: h.empty,
		]),
	]),
)
