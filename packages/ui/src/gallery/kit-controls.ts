import type { Html, HtmlBuilder } from "foldkit/html"
import {
	addFilterButton,
	filterChip,
	sortTrigger,
} from "../../../../apps/web-foldkit/src/customers/ui/filter-bar.ts"
import { segmented } from "../../../../apps/web-foldkit/src/ui/segmented-control.ts"

/**
 * The kit side of lane G3's control fixtures: today's customers filter bar pieces (`filterChip`,
 * `+ Filter` and the sort trigger) and the range picker's segmented control, with their fixtures'
 * content.
 */

type H = HtmlBuilder<never>

const specimen = (h: H, id: string, child: Html): Html =>
	h.div(
		[h.Class("frame-button")],
		[h.div([h.Class("inline-flex"), h.Attribute("data-specimen", id)], [child])],
	)

export const controlSpecimens = (h: H): Html =>
	h.div(
		[],
		[
			h.div(
				[h.Class("frames frame-buttons")],
				[
					specimen(
						h,
						"button-filter",
						filterChip(h, {
							field: "Kind",
							operator: "is",
							value: "Risk",
							onRemove: undefined as never,
						}),
					),
					specimen(h, "button-dashed", addFilterButton(h)),
					specimen(h, "button-sort", sortTrigger(h, { label: "Priority" })),
					specimen(
						h,
						"choice-segmented",
						segmented(h, {
							ariaLabel: "Date range",
							segments: ["7d", "30d", "90d", "12m"].map((key) => ({ key, label: key })),
							selected: "30d",
							onSelect: () => undefined as never,
						}),
					),
				],
			),
		],
	)
