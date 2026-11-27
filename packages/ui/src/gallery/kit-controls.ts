import type { Html, HtmlBuilder } from "foldkit/html"
import {
	addFilterButton,
	filterChip,
	sortTrigger,
} from "../../../../apps/web-foldkit/src/customers/ui/filter-bar.ts"

/**
 * The kit side of lane G3's control fixtures: today's customers filter bar pieces (`filterChip`,
 * `+ Filter` and the sort trigger), with their fixtures' content.
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
						filterChip(h, { field: "Kind", operator: "is", value: "Risk", onRemove: undefined as never }),
					),
					specimen(h, "button-dashed", addFilterButton(h)),
					specimen(h, "button-sort", sortTrigger(h, { label: "Priority" })),
				],
			),
		],
	)
