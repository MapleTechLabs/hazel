import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { formatCount, formatMoney } from "../../../../customers/format"
import { dataTable } from "../../../../customers/ui/data-table"
import { button } from "../../../../ui/button"
import { heading } from "../../../../ui/heading"
import { loader } from "../../../../ui/loader"
import { Message } from "./message"
import { CLASS_LABEL, type Model } from "./model"
import { CARD } from "./rules-view"

/** The draft's preview: MRR, variable MRR and run-rate now and under it, and how each price's lines class. */

type H = HtmlBuilder<Message>
type Group = Customers.RevenuePreviewGroup

const isChanged = (group: Group) => group.current.classification !== group.proposed.classification

const totalCell = (h: H, label: string, current: number, proposed: number, currency: string): Html => {
	const delta = proposed - current
	return h.div(
		[h.Class("flex min-w-0 flex-col gap-0.5 px-4 py-3")],
		[
			h.span([h.Class("text-muted-fg text-xs")], [label]),
			h.span(
				[h.Class("flex flex-wrap items-baseline gap-x-1.5 font-semibold text-fg tabular-nums")],
				delta === 0
					? [formatMoney(proposed, currency)]
					: [
							h.span([h.Class("font-normal text-muted-fg")], [formatMoney(current, currency)]),
							h.span([h.AriaHidden(true), h.Class("font-normal text-muted-fg")], ["→"]),
							formatMoney(proposed, currency),
							h.span(
								[
									h.Class(
										twMerge(
											"font-normal text-xs",
											delta > 0 ? "text-success-subtle-fg" : "text-danger-subtle-fg",
										),
									),
								],
								[formatMoney(delta, currency, { signed: true })],
							),
						],
			),
		],
	)
}

const totals = (h: H, result: Customers.RevenuePreviewResult): Html => {
	const { current, proposed, currency } = result
	return h.div(
		[
			h.Role("group"),
			h.AriaLabel("Current and proposed totals"),
			h.Class(
				"grid divide-border rounded-lg border border-border max-sm:divide-y sm:grid-cols-3 sm:divide-x",
			),
		],
		[
			totalCell(h, "MRR", current.mrrMinor, proposed.mrrMinor, currency),
			totalCell(h, "Variable MRR", current.variableMrrMinor, proposed.variableMrrMinor, currency),
			totalCell(
				h,
				"Run-rate MRR",
				current.mrrMinor + current.variableMrrMinor,
				proposed.mrrMinor + proposed.variableMrrMinor,
				currency,
			),
		],
	)
}

const plural = (count: number, word: string) => `${formatCount(count)} ${word}${count === 1 ? "" : "s"}`

const amountCell = (h: H, count: number, word: string, amount: string): Html =>
	count === 0
		? h.span([h.Class("text-muted-fg")], ["—"])
		: h.span(
				[h.Class("flex flex-col items-end")],
				[amount, h.span([h.Class("text-muted-fg text-xs")], [plural(count, word)])],
			)

const groupKey = (group: Group) => `${group.priceId ?? group.label}:${group.source}:${group.proration}`

const groupsTable = (h: H, result: Customers.RevenuePreviewResult): Html =>
	dataTable(h, {
		ariaLabel: "How billing lines classify",
		id: "revenue-preview-groups",
		className: "rounded-lg",
		rows: result.groups,
		rowKey: groupKey,
		rowClassName: (group) =>
			isChanged(group) ? "bg-warning-subtle/40 hover:bg-warning-subtle/60" : undefined,
		columns: [
			{
				key: "line",
				label: "Billing line",
				cell: (group) =>
					h.span(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.span([h.Class("truncate font-medium"), h.Title(group.label)], [group.label]),
							...(group.detail === null
								? []
								: [h.span([h.Class("truncate text-muted-fg text-xs")], [group.detail])]),
						],
					),
			},
			{
				key: "source",
				label: "Source",
				widthClass: "w-36",
				hideClass: "max-md:hidden",
				cell: (group) =>
					h.span(
						[h.Class("flex flex-col whitespace-nowrap text-sm")],
						[
							group.source === "subscription" ? "Subscription" : "Invoice item",
							...(group.proration
								? [h.span([h.Class("text-muted-fg text-xs")], ["Proration"])]
								: []),
						],
					),
			},
			{
				key: "billed",
				label: "Billed, 90 days",
				align: "right",
				widthClass: "w-32",
				hideClass: "max-sm:hidden",
				cell: (group) =>
					amountCell(h, group.lineCount, "line", formatMoney(group.amountMinor, result.currency)),
			},
			{
				key: "monthly",
				label: "Live, monthly",
				align: "right",
				widthClass: "w-32",
				hideClass: "max-lg:hidden",
				cell: (group) =>
					amountCell(h, group.itemCount, "item", formatMoney(group.monthlyMinor, result.currency)),
			},
			{
				key: "class",
				label: "Class",
				widthClass: "w-44",
				cell: (group) =>
					isChanged(group)
						? h.span(
								[h.Class("inline-flex items-center gap-1 whitespace-nowrap")],
								[
									h.span(
										[h.Class("text-muted-fg")],
										[CLASS_LABEL[group.current.classification]],
									),
									h.span([h.AriaHidden(true), h.Class("text-muted-fg")], ["→"]),
									h.span([h.Class("sr-only")], ["changes to"]),
									h.span(
										[h.Class("font-medium text-warning-subtle-fg")],
										[CLASS_LABEL[group.proposed.classification]],
									),
								],
							)
						: h.span(
								[h.Class("whitespace-nowrap")],
								[CLASS_LABEL[group.proposed.classification]],
							),
			},
		],
	})

const body = (h: H, model: Model): ReadonlyArray<Html> => {
	const { result } = model.preview
	if (AsyncData.isIdle(result))
		return [
			h.p(
				[h.Class("py-8 text-center text-muted-fg text-sm")],
				["Finish the highlighted rules to see their effect."],
			),
		]
	const data = Option.getOrNull(AsyncData.getData(result))
	if (data === null) {
		if (AsyncData.isFailure(result)) {
			const message = commonMessage(result.error)
			return [
				h.div(
					[h.Class("flex flex-col items-center gap-2 py-8 text-center")],
					[
						h.span([h.Class("font-medium text-fg text-sm")], [message.title]),
						button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetryPreview() }, [
							"Try again",
						]),
					],
				),
			]
		}
		return [
			h.div([h.Class("flex justify-center py-10")], [loader(h, { ariaLabel: "Loading the preview" })]),
		]
	}
	return [
		h.div(
			[
				h.Class(
					twMerge(
						"flex min-w-0 flex-col gap-4 transition-opacity",
						!AsyncData.isSuccess(result) && "opacity-60",
					),
				),
			],
			[
				totals(h, data),
				data.groups.length === 0
					? h.p(
							[h.Class("py-6 text-center text-muted-fg text-sm")],
							["No billing lines in the last 90 days."],
						)
					: groupsTable(h, data),
			],
		),
	]
}

export const previewCard = (h: H, model: Model, hasDraft: boolean): Html => {
	const data = Option.getOrNull(AsyncData.getData(model.preview.result))
	const changed = data === null ? 0 : data.groups.filter(isChanged).length
	return h.section(
		[h.AriaLabel("Preview"), h.Class(CARD)],
		[
			h.div(
				[h.Class("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-col gap-0.5")],
						[
							heading(h, { variant: "section" }, ["Preview"]),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								[
									hasDraft
										? "Your saved rules against this draft. Nothing is written until you save."
										: "How your billing lines classify under the saved rules.",
								],
							),
						],
					),
					...(hasDraft && data !== null
						? [
								h.span(
									[h.Class("text-muted-fg text-sm tabular-nums")],
									[
										`${formatCount(changed)} of ${plural(data.groups.length, "group")} change class`,
									],
								),
							]
						: []),
				],
			),
			...body(h, model),
		],
	)
}
