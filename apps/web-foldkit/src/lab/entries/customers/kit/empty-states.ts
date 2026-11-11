import { defineStaticLab, ignored } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { allClearState, noResultsState, noSourcesState } from "../../../../customers/ui/empty-states"

// `/lab/customers/kit/empty-states`: Foundations › Empty State Variants.

export const lab = defineStaticLab("Empty states", (h) =>
	labPage(h, { title: "Empty states" }, [
		labSection(
			h,
			"Variants",
			[
				allClearState(h, { snoozedCount: 4, onViewSnoozed: ignored }),
				noSourcesState(h, { onConnect: ignored }),
				noResultsState(h, { onClear: ignored }),
			],
			"grid gap-4 md:grid-cols-3 [&>*]:min-h-72",
		),
		labSection(h, "All clear, nothing snoozed", [allClearState(h, { snoozedCount: 0 })]),
	]),
)
