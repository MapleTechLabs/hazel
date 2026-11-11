import { defineStaticLab } from "../../../define"
import { labPage, labRow, labSection } from "../../../frame"
import {
	healthBadge,
	healthDot,
	kindChip,
	severityChip,
	severityGlyph,
	signalCounts,
	stageBadge,
} from "../../../../customers/ui/badges"

// `/lab/customers/kit/badges`: Foundations › Health Badge States, Severity And Kind Chips, Lifecycle Stage Badges.

export const lab = defineStaticLab("Badges", (h) =>
	labPage(h, { title: "Badges and chips" }, [
		labSection(h, "Health badge", [
			labRow(h, [
				healthBadge(h, { status: "healthy" }),
				healthBadge(h, { status: "at_risk" }),
				healthBadge(h, { status: "critical" }),
				healthBadge(h, { status: "unknown" }),
			]),
			labRow(h, [
				healthBadge(h, { status: "healthy", score: 82 }),
				healthBadge(h, { status: "at_risk", score: 54 }),
				healthBadge(h, { status: "critical", score: 27 }),
				healthBadge(h, { status: "unknown", score: null }),
			]),
			labRow(
				h,
				[
					healthDot(h, { status: "healthy", score: 82 }),
					healthDot(h, { status: "at_risk", score: 54 }),
					healthDot(h, { status: "critical", score: 27 }),
					healthDot(h, { status: "unknown", score: null }),
				],
				"Compact, for dense table cells",
			),
		]),
		labSection(h, "Severity chip", [
			labRow(h, [severityChip(h, "high"), severityChip(h, "medium"), severityChip(h, "low")]),
			labRow(
				h,
				[severityGlyph(h, "high"), severityGlyph(h, "medium"), severityGlyph(h, "low")],
				"Glyph only, named on hover",
			),
		]),
		labSection(h, "Kind chip", [labRow(h, [kindChip(h, "risk"), kindChip(h, "opportunity")])]),
		labSection(h, "Lifecycle stage", [
			labRow(h, [
				stageBadge(h, "lead"),
				stageBadge(h, "trialing"),
				stageBadge(h, "active"),
				stageBadge(h, "past_due"),
				stageBadge(h, "churned"),
			]),
			labRow(
				h,
				[
					stageBadge(h, "trialing", { trialDaysLeft: 4 }),
					stageBadge(h, "trialing", { trialDaysLeft: 0 }),
				],
				"Square corners, no dot: stage, not health",
			),
		]),
		labSection(h, "Open signals (list cell)", [
			labRow(h, [
				signalCounts(h, { high: 1, medium: 2, low: 0, opportunities: 1 }),
				signalCounts(h, { high: 0, medium: 0, low: 3, opportunities: 0 }),
				signalCounts(h, { high: 0, medium: 0, low: 0, opportunities: 2 }),
				signalCounts(h, { high: 0, medium: 0, low: 0, opportunities: 0 }),
			]),
		]),
	]),
)
