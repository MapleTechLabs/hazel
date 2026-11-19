import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { lineChart } from "../../../../customers/charts/line-chart"
import { bucketLabels, formatCount, formatMetric } from "../../../../customers/format"
import { AppRoute, customerRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { link } from "../../../../ui/link"
import { loader } from "../../../../ui/loader"
import { commonMessage } from "~/lib/error-messages"
import type { LayoutRow } from "../../../../customers/overview/rows"
import { Message } from "./message"
import { type Editor, type MetricForm, PREVIEW_DAYS, type PreviewFailure } from "./model"
import { card } from "./parts"

/** The editor's side cards: the preview over the last days, and the layouts that use the metric. */

type H = HtmlBuilder<Message>

const toHovered = (index: number | null) => Message.HoveredSampleDay({ index })

const muted = (h: H, text: string): Html => h.p([h.Class("text-muted-fg text-sm")], [text])

const failureText = (reason: PreviewFailure): string =>
	reason === "Invalid"
		? "Hazel refused this source. Check it and run the preview again."
		: (commonMessage(reason).description ?? commonMessage(reason).title)

const coverageBar = (h: H, result: Customers.MetricPreviewResult): Html => {
	const pct = result.totalAccounts === 0 ? 0 : (result.accountsWithData / result.totalAccounts) * 100
	return h.div(
		[h.Class("flex flex-col gap-1.5")],
		[
			h.div(
				[h.Class("flex items-baseline justify-between gap-2 text-sm")],
				[
					h.span([h.Class("text-muted-fg")], ["Customers with data"]),
					h.span(
						[h.Class("font-semibold text-fg tabular-nums")],
						[`${formatCount(result.accountsWithData)} / ${formatCount(result.totalAccounts)}`],
					),
				],
			),
			h.div(
				[
					h.Role("meter"),
					h.AriaLabel("Customers with data"),
					h.AriaValuemin(0),
					h.AriaValuemax(result.totalAccounts),
					h.AriaValuenow(result.accountsWithData),
					h.Class("h-1.5 overflow-hidden rounded-full bg-secondary"),
				],
				[h.div([h.Class("h-full rounded-full bg-primary"), h.Style({ width: `${pct}%` })])],
			),
			...(result.unmatchedRows === 0
				? []
				: [
						h.p(
							[h.Class("text-muted-fg text-xs")],
							[
								`${formatCount(result.unmatchedRows)} ${result.unmatchedRows === 1 ? "row names" : "rows name"} no known customer.`,
							],
						),
					]),
		],
	)
}

const sampleChart = (
	h: H,
	sample: NonNullable<Customers.MetricPreviewResult["sample"]>,
	form: MetricForm,
	hovered: number | null,
): Html => {
	const format = (value: number) =>
		formatMetric(value, { format: form.format, unit: form.unit.trim() || null })
	const labels = sample.points.map((point) => bucketLabels("day", point.day))
	return h.div(
		[h.Class("flex flex-col gap-2 border-border border-t pt-4")],
		[
			h.span([h.Class("text-muted-fg text-xs")], [`${sample.name}, daily`]),
			lineChart(h, {
				ariaLabel: `${sample.name}, last ${PREVIEW_DAYS} days: ${sample.points.map((point) => format(point.value)).join(", ")}`,
				series: [
					{
						key: "sample",
						label: form.name.trim() || "Value",
						color: "series-1",
						values: sample.points.map((point) => point.value),
					},
				],
				xLabels: labels.map((label) => label.tick),
				headings: labels.map((label) => label.heading),
				formatValue: format,
				hoveredIndex: hovered,
				onHover: toHovered,
				heightClass: "h-36",
			}),
		],
	)
}

const topList = (h: H, result: Customers.MetricPreviewResult, form: MetricForm, orgSlug: string): Html =>
	h.div(
		[h.Class("flex flex-col gap-1.5 border-border border-t pt-4")],
		[
			h.span([h.Class("text-muted-fg text-xs")], ["Top customers"]),
			h.ul(
				[h.Class("flex flex-col gap-1")],
				result.top.map((row) =>
					h.li(
						[h.Key(row.accountId), h.Class("flex items-baseline justify-between gap-3 text-sm")],
						[
							link(
								h,
								{
									href: hrefOf(customerRoute(orgSlug, row.accountId)),
									className: "min-w-0 truncate text-fg",
								},
								[row.name],
							),
							h.span(
								[h.Class("shrink-0 text-fg-2 tabular-nums")],
								[
									formatMetric(row.value, {
										format: form.format,
										unit: form.unit.trim() || null,
									}),
								],
							),
						],
					),
				),
			),
		],
	)

const resultView = (
	h: H,
	result: Customers.MetricPreviewResult,
	editor: Editor,
	form: MetricForm,
	orgSlug: string,
): ReadonlyArray<Html> =>
	result.error !== null
		? [
				h.p(
					[
						h.Role("alert"),
						h.Class(
							"rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2.5 text-danger-subtle-fg text-sm",
						),
					],
					[result.error],
				),
			]
		: [
				coverageBar(h, result),
				...(result.sample === null ? [] : [sampleChart(h, result.sample, form, editor.hoveredDay)]),
				...(result.top.length === 0 ? [] : [topList(h, result, form, orgSlug)]),
			]

export const previewCard = (
	h: H,
	options: Readonly<{
		editor: Editor
		form: MetricForm
		canRun: boolean
		isAdmin: boolean
		orgSlug: string
	}>,
): Html => {
	const { editor, form } = options
	const isRunning = AsyncData.isLoading(editor.preview) || AsyncData.isRefreshing(editor.preview)
	return card(
		h,
		{
			title: "Preview",
			description: `Runs the source over the last ${PREVIEW_DAYS} days without saving it.`,
			aside: options.isAdmin
				? button(
						h,
						{
							intent: "outline",
							size: "xs",
							isDisabled: !options.canRun,
							isPending: isRunning,
							onPress: Message.PressedRunPreview(),
						},
						["Run preview"],
					)
				: undefined,
		},
		AsyncData.matchDataSplitEmpty(editor.preview, {
			onIdle: () => [
				muted(
					h,
					options.isAdmin
						? options.canRun
							? "See which customers have data, and what a customer's days look like."
							: "Finish the source to preview it."
						: "Only admins and owners can run a preview.",
				),
			],
			onLoading: () => [
				h.div(
					[h.Class("flex justify-center py-8")],
					[loader(h, { ariaLabel: "Running the preview" })],
				),
			],
			onFailure: (reason) => [
				h.p([h.Role("alert"), h.Class("text-danger-subtle-fg text-sm")], [failureText(reason)]),
			],
			onData: (result) => resultView(h, result, editor, form, options.orgSlug),
		}),
	)
}

export const usedByCard = (h: H, layouts: ReadonlyArray<LayoutRow>, orgSlug: string): Html =>
	card(h, { title: "Used by" }, [
		layouts.length === 0
			? muted(h, "No Overview layout shows this metric yet.")
			: h.ul(
					[h.Class("flex flex-col gap-1.5")],
					layouts.map((layout) =>
						h.li(
							[h.Key(layout.id), h.Class("flex items-baseline gap-3 text-sm")],
							[
								h.span([h.Class("w-14 shrink-0 text-muted-fg text-xs")], ["Layout"]),
								link(
									h,
									{
										href: hrefOf(
											AppRoute.CustomersSettingsLayout({
												orgSlug,
												layoutId: layout.id,
												preview: Option.none(),
											}),
										),
										className: "min-w-0 truncate",
									},
									[layout.name],
								),
							],
						),
					),
				),
	])
