import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { PROVIDER_ORDER, PROVIDERS } from "../../../../customers/providers"
import { STAGE_LABEL } from "../../../../customers/ui/badges"
import { Message } from "./message"
import type { AttentionRow } from "./model"
import { card, toggleChip } from "./parts"

/** Who Needs attention covers (`AttentionSettings`): every rule looks only at these customers. */

type H = HtmlBuilder<Message>

const field = (h: H, label: string, hint: string, chips: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start")],
		[
			h.div(
				[h.Class("flex flex-col pt-1")],
				[
					h.span([h.Class("font-medium text-fg text-sm")], [label]),
					h.span([h.Class("text-muted-fg text-xs")], [hint]),
				],
			),
			h.div([h.Class("flex flex-wrap items-center gap-1.5")], [...chips]),
		],
	)

export const attentionCard = (h: H, row: AttentionRow, isDisabled: boolean): Html => {
	const { stages, requiredSources } = row.attention
	return card(h, { title: "Who needs attention" }, [
		h.p(
			[h.Class("-mt-2 text-muted-fg text-sm")],
			[
				"Rules only look at these customers; the others never show up in Needs attention. A customer that churns gets one last entry, Churned, and nothing after it.",
			],
		),
		field(
			h,
			"Stages",
			"None picked: only churn entries",
			Customers.AttentionStage.literals.map((stage) =>
				toggleChip(h, {
					label: STAGE_LABEL[stage],
					isPressed: stages.includes(stage),
					isDisabled,
					onPress: Message.ToggledAttentionStage({ stage }),
				}),
			),
		),
		field(
			h,
			"Has a record in",
			"Any of these; none picked: any customer",
			PROVIDER_ORDER.map((provider) =>
				toggleChip(h, {
					label: PROVIDERS[provider].name,
					isPressed: requiredSources.includes(provider),
					isDisabled,
					onPress: Message.ToggledAttentionSource({ provider }),
				}),
			),
		),
	])
}
