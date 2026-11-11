import { evidenceDetail, evidenceViz } from "../../../../customers/ui/evidence"
import { kindChip } from "../../../../customers/ui/badges"
import { defineStaticLab } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { NOW, SIGNAL_ENTRIES } from "../../../fixtures/customers"

// `/lab/customers/kit/evidence`: every evidence viz, as the queue cell and as the side panel.

const byViz = [
	...new Map(
		SIGNAL_ENTRIES.map((entry) => [`${entry.signal.evidence._tag}:${entry.signal.template}`, entry]),
	).values(),
]

export const lab = defineStaticLab("Evidence", (h) =>
	labPage(h, { title: "Evidence" }, [
		labSection(
			h,
			"By viz: queue cell · side panel",
			byViz.map(({ signal, account }) =>
				h.div(
					[
						h.Class(
							"grid grid-cols-[1fr_9rem_20rem] items-start gap-6 rounded-xl border border-border p-4",
						),
					],
					[
						h.div(
							[h.Class("flex min-w-0 flex-col gap-1")],
							[
								h.span(
									[h.Class("flex items-center gap-2 text-sm")],
									[
										kindChip(h, signal.kind),
										h.span([h.Class("font-medium")], [signal.title]),
										h.span(
											[h.Class("font-mono text-muted-fg text-xs")],
											[`${signal.evidence._tag} · ${signal.template}`],
										),
									],
								),
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[`${account.name}: ${signal.reason}`],
								),
							],
						),
						evidenceViz(h, signal.evidence),
						evidenceDetail(h, signal.evidence, { now: NOW }),
					],
				),
			),
		),
	]),
)
