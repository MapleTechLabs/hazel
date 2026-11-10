import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { distributionBar } from "../../../../customers/charts/distribution"
import { formatCount, formatDeltaCount, formatMoney } from "../../../../customers/format"
import type { AccountRow } from "../../../../customers/queries"
import { HEALTH_FILL, HEALTH_LABEL, healthBadge } from "../../../../customers/ui/badges"
import { segmented } from "../../../../customers/ui/filter-bar"
import { IconChevronRight } from "../../../../icons"
import { button } from "../../../../ui/button"
import * as Select from "../../../../ui/select"
import { view as selectView } from "../../../../ui/select-view"
import * as Slider from "../../../../ui/slider"
import { scaleButton } from "./components-view"
import { card, cardTitle, type Context, type H, numberInput, parseNumber, textOf } from "./fields"
import { Message } from "./message"
import {
	type BandKey,
	COMPONENT_LABEL,
	changesOf,
	distributionOf,
	type Model,
	movedCount,
	type PreviewMetric,
} from "./model"
import { SLIDER_MESSAGE, toCheckAccountMessage } from "./update"

/** The bands editor, the distribution preview, "Check one customer" and the unsaved-changes bar. */

type Status = Customers.HealthStatus
type Row = Customers.HealthDistributionRow

const STATUSES: ReadonlyArray<Status> = ["healthy", "at_risk", "critical", "unknown"]

/** A position on the 0–100 scale; an emptied field sits at 0. */
const onScale = (value: number) => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0)

// BANDS

const bandHandle = (h: H, model: Model, band: BandKey, context: Context): Html => {
	const value = onScale(context.draft.bands[band])
	return h.submodel({
		slotId: `health-band-${band}`,
		model: model.sliders[band],
		view: Slider.view,
		viewInputs: {
			value,
			ariaLabel: band === "healthyMin" ? "Healthy from" : "At risk from",
			isDisabled: !context.canEdit,
			toView: (attributes) =>
				h.div(
					[...attributes.root, h.Class("pointer-events-none absolute inset-0 flex items-center")],
					[
						h.div([...attributes.track, h.Class("h-1.5 w-full")]),
						h.div(
							[
								...attributes.thumb,
								h.Class(
									"pointer-events-auto top-1/2 size-4 -translate-y-1/2 cursor-grab rounded-full border-2 border-bg bg-fg shadow-sm outline-hidden focus-visible:ring-3 focus-visible:ring-ring/40 data-dragging:cursor-grabbing data-disabled:cursor-default",
								),
							],
							[
								h.span(
									[
										h.AriaHidden(true),
										h.Class(
											"absolute -top-5 left-1/2 -translate-x-1/2 font-medium text-fg text-xs tabular-nums",
										),
									],
									[String(value)],
								),
							],
						),
					],
				),
		},
		toParentMessage: SLIDER_MESSAGE[band],
	})
}

const bandInput = (h: H, band: BandKey, context: Context): Html =>
	numberInput(h, context, {
		field: band,
		value: context.draft.bands[band],
		ariaLabel: band === "healthyMin" ? "Healthy from score" : "At risk from score",
		onInput: (text) => Message.ChangedBand({ band, value: parseNumber(text), text }),
	})

const statusLabel = (h: H, status: Status): Html =>
	h.span(
		[h.Class("inline-flex w-20 shrink-0 items-center gap-2 text-fg")],
		[h.span([h.Class(twMerge("size-2 rounded-full", HEALTH_FILL[status]))]), HEALTH_LABEL[status]],
	)

export const bandsCard = (h: H, model: Model, context: Context): Html => {
	const { healthyMin, atRiskMin } = context.draft.bands
	const healthy = onScale(healthyMin)
	const atRisk = Math.min(onScale(atRiskMin), healthy)
	const bandRow = (status: Status, rule: ReadonlyArray<Html | string>, range: string) =>
		h.div(
			[h.Class("flex min-h-10 items-center gap-3 border-border border-b px-1 text-xs last:border-b-0")],
			[
				statusLabel(h, status),
				h.span([h.Class("flex flex-1 items-center gap-2 text-muted-fg")], [...rule]),
				h.span([h.Class("text-muted-fg tabular-nums")], [range]),
			],
		)
	return card(h, "", [
		cardTitle(h, "Bands", "Where a score turns into a status"),
		h.div(
			[h.Class("flex flex-col gap-1 pt-5")],
			[
				h.div(
					[h.Class("relative h-4")],
					[
						h.div(
							[
								h.AriaHidden(true),
								h.Class(
									"absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 overflow-hidden rounded-full",
								),
							],
							[
								h.span([
									h.Class("h-full bg-health-critical"),
									h.Style({ width: `${atRisk}%` }),
								]),
								h.span([
									h.Class("h-full bg-health-at-risk"),
									h.Style({ width: `${healthy - atRisk}%` }),
								]),
								h.span([h.Class("h-full flex-1 bg-health-healthy")]),
							],
						),
						bandHandle(h, model, "atRiskMin", context),
						bandHandle(h, model, "healthyMin", context),
					],
				),
				h.div(
					[h.Class("flex justify-between text-muted-fg text-xs tabular-nums")],
					[h.span([], ["0"]), h.span([], ["100"])],
				),
			],
		),
		h.div(
			[h.Class("flex flex-col rounded-lg border border-border px-2")],
			[
				bandRow(
					"healthy",
					["Score of at least", bandInput(h, "healthyMin", context)],
					`${textOf(healthyMin)}–100`,
				),
				bandRow(
					"at_risk",
					["Score of at least", bandInput(h, "atRiskMin", context)],
					`${textOf(atRiskMin)}–${textOf(healthyMin - 1)}`,
				),
				bandRow("critical", [`Everything below ${textOf(atRiskMin)}`], `0–${textOf(atRiskMin - 1)}`),
				bandRow("unknown", ["Churned, or no part has data yet"], ""),
			],
		),
		...(context.invalid.has("healthyMin") || context.invalid.has("atRiskMin")
			? [
					h.p(
						[h.Role("alert"), h.Class("text-danger-subtle-fg text-xs")],
						["Bands are whole scores from 0 to 100, and at risk starts below healthy."],
					),
				]
			: []),
	])
}

// DISTRIBUTION

const byStatus = (rows: ReadonlyArray<Row>, status: Status): Row =>
	rows.find((row) => row.status === status) ?? { status, count: 0, mrrMinor: 0 }

const bar = (h: H, label: string, rows: ReadonlyArray<Row>, metric: PreviewMetric): Html =>
	h.div(
		[h.Class("grid grid-cols-[6.5rem_1fr] items-center gap-3 text-xs")],
		[
			h.span([h.Class("text-muted-fg")], [label]),
			distributionBar(h, {
				ariaLabel: `${label}: ${STATUSES.map((status) => `${HEALTH_LABEL[status]} ${byStatus(rows, status).count}`).join(", ")}`,
				segments: STATUSES.map((status) => {
					const row = byStatus(rows, status)
					return {
						key: status,
						label: HEALTH_LABEL[status],
						value: metric === "customers" ? row.count : row.mrrMinor,
						fillClass: HEALTH_FILL[status],
					}
				}),
			}),
		],
	)

const bandText = (status: Status, bands: Customers.HealthBands): string =>
	status === "healthy"
		? `≥ ${bands.healthyMin}`
		: status === "at_risk"
			? `${bands.atRiskMin}–${bands.healthyMin - 1}`
			: status === "critical"
				? `< ${bands.atRiskMin}`
				: "No data"

/** "8 customers change band: 6 Healthy → At risk, 2 At risk → Critical." */
export const transitionsText = (result: Customers.HealthDryRunResult): string => {
	const moved = movedCount(result)
	if (moved === 0) return "No customer changes band."
	const parts = [...result.transitions]
		.sort((a, b) => b.count - a.count)
		.map(
			(transition) =>
				`${transition.count} ${HEALTH_LABEL[transition.from]} → ${HEALTH_LABEL[transition.to]}`,
		)
	return `${formatCount(moved)} ${moved === 1 ? "customer changes" : "customers change"} band: ${parts.join(", ")}.`
}

const th = (h: H, label: string, className = "text-right") =>
	h.th([h.Class(twMerge("py-2 font-normal", className))], [label])
const td = (h: H, text: string, className = "") =>
	h.td([h.Class(twMerge("py-2 text-right text-fg tabular-nums", className))], [text])

const distributionTable = (
	h: H,
	saved: ReadonlyArray<Row>,
	proposed: ReadonlyArray<Row> | null,
	bands: Customers.HealthBands,
	currency: string,
): Html =>
	h.table(
		[h.Class("w-full text-sm")],
		[
			h.thead(
				[],
				[
					h.tr(
						[h.Class("border-border border-b text-muted-fg text-xs")],
						proposed === null
							? [th(h, "Status", "text-left"), th(h, "Customers"), th(h, "MRR")]
							: [
									th(h, "Status", "text-left"),
									th(h, "Saved"),
									th(h, "With changes"),
									th(h, "Change"),
									th(h, "MRR"),
								],
					),
				],
			),
			h.tbody(
				[],
				STATUSES.map((status) => {
					const before = byStatus(saved, status)
					const after = proposed === null ? null : byStatus(proposed, status)
					const name = h.td(
						[h.Class("py-2")],
						[
							h.span(
								[h.Class("inline-flex items-center gap-2")],
								[
									h.span([h.Class(twMerge("size-2.5 rounded-[2px]", HEALTH_FILL[status]))]),
									h.span([h.Class("text-fg")], [HEALTH_LABEL[status]]),
									h.span([h.Class("text-muted-fg text-xs")], [bandText(status, bands)]),
								],
							),
						],
					)
					if (after === null)
						return h.tr(
							[],
							[
								name,
								td(h, formatCount(before.count)),
								td(h, formatMoney(before.mrrMinor, currency)),
							],
						)
					const change = after.count - before.count
					return h.tr(
						[],
						[
							name,
							td(h, formatCount(before.count), "text-muted-fg"),
							td(h, formatCount(after.count)),
							td(
								h,
								change === 0 ? "—" : formatDeltaCount(change),
								change === 0
									? "text-muted-fg"
									: (status === "healthy") === change > 0
										? "text-success-subtle-fg"
										: "text-danger-subtle-fg",
							),
							td(h, formatMoney(after.mrrMinor, currency)),
						],
					)
				}),
			),
		],
	)

const metricToggle = (h: H, metric: PreviewMetric): Html =>
	segmented(h, {
		ariaLabel: "Measure the distribution by",
		segments: [
			{ key: "customers", label: "Customers" },
			{ key: "mrr", label: "MRR" },
		],
		selected: metric,
		onSelect: (next) => Message.ClickedPreviewMetric({ metric: next }),
	})

const pausedPanel = (h: H, title: string, body: string): Html =>
	h.div(
		[h.Class("flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center")],
		[
			h.div(
				[h.AriaHidden(true), h.Class("flex w-48 flex-col gap-1.5 opacity-60")],
				[
					h.span([h.Class("h-2 rounded-full bg-secondary")]),
					h.span([h.Class("h-2 rounded-full bg-secondary")]),
				],
			),
			h.p([h.Class("font-medium text-fg text-sm")], [title]),
			h.p([h.Class("max-w-xs text-muted-fg text-xs")], [body]),
		],
	)

export const distributionCard = (
	h: H,
	model: Model,
	context: Context,
	isValid: boolean,
	currency: string,
): Html => {
	const accounts = model.accounts
	const totals = (rows: ReadonlyArray<Row>) =>
		`${formatCount(rows.reduce((sum, row) => sum + row.count, 0))} customers · ${formatMoney(
			rows.reduce((sum, row) => sum + row.mrrMinor, 0),
			currency,
		)} MRR`
	const frame = (subtitle: string, children: ReadonlyArray<Html>) =>
		card(h, "", [
			h.div(
				[h.Class("flex flex-wrap items-start justify-between gap-3")],
				[cardTitle(h, "Distribution preview", subtitle), metricToggle(h, model.previewMetric)],
			),
			...children,
		])

	if (!context.isDirty) {
		if (accounts === null) return frame("Loading customers…", [])
		const saved = distributionOf(accounts)
		return frame(`${totals(saved)} · as saved`, [
			bar(h, "Saved", saved, model.previewMetric),
			distributionTable(h, saved, null, context.saved.bands, currency),
		])
	}
	if (!isValid) {
		const customers = accounts === null ? "customers" : `${formatCount(accounts.length)} customers`
		const first = context.total === 100 ? "Fix the highlighted fields" : "Weights must add up to 100%"
		return card(h, "", [
			pausedPanel(
				h,
				"Preview paused",
				`${first} before we can rescore your ${customers}. Saved scores stay live in the meantime.`,
			),
		])
	}
	return AsyncData.match(model.preview.result, {
		onIdle: () => frame("Scoring your changes…", []),
		onLoading: () =>
			frame("Scoring your changes…", [
				pausedPanel(h, "Scoring your customers…", "Saved scores stay live in the meantime."),
			]),
		onFailure: (reason) =>
			frame(commonMessage(reason).title, [
				h.div(
					[h.Class("flex items-center gap-3")],
					[
						h.p([h.Class("text-muted-fg text-sm")], ["The preview couldn't be computed."]),
						button(h, { intent: "outline", size: "xs", onPress: Message.PressedRetryPreview() }, [
							"Try again",
						]),
					],
				),
			]),
		onSuccess: (result) => previewResult(h, model, context, result, currency, frame, totals, false),
		onRefreshing: (result) => previewResult(h, model, context, result, currency, frame, totals, true),
		onStale: ({ data: result }) =>
			previewResult(h, model, context, result, currency, frame, totals, false),
	})
}

const previewResult = (
	h: H,
	model: Model,
	context: Context,
	result: Customers.HealthDryRunResult,
	currency: string,
	frame: (subtitle: string, children: ReadonlyArray<Html>) => Html,
	totals: (rows: ReadonlyArray<Row>) => string,
	isRefreshing: boolean,
): Html =>
	frame(`${totals(result.proposed)} · scored with your unsaved changes`, [
		h.div(
			[
				h.Class(twMerge("flex flex-col gap-4 transition-opacity", isRefreshing && "opacity-60")),
				h.AriaBusy(isRefreshing),
			],
			[
				h.div(
					[h.Class("flex flex-col gap-2")],
					[
						bar(h, "Saved", result.current, model.previewMetric),
						bar(h, "With changes", result.proposed, model.previewMetric),
					],
				),
				distributionTable(h, result.current, result.proposed, context.draft.bands, currency),
				h.p(
					[h.Class("rounded-lg bg-warning-subtle/60 px-3 py-2 text-fg text-xs")],
					[transitionsText(result)],
				),
			],
		),
	])

// CHECK ONE CUSTOMER

const formatWeight = (weight: number) => `${Math.round(weight)}%`

const breakdownTable = (h: H, breakdown: Customers.HealthBreakdown): Html =>
	h.table(
		[h.Class("w-full text-sm")],
		[
			h.thead(
				[],
				[
					h.tr(
						[h.Class("border-border border-b text-muted-fg text-xs")],
						[
							th(h, "Part", "text-left"),
							th(h, "Why", "text-left"),
							th(h, "Part score"),
							th(h, "Weight"),
							th(h, "Points"),
						],
					),
				],
			),
			h.tbody(
				[],
				breakdown.components.map((part) =>
					h.tr(
						[h.Class("border-border border-b")],
						[
							h.td([h.Class("py-2 pr-3 text-fg")], [COMPONENT_LABEL[part.key]]),
							h.td(
								[h.Class("py-2 pr-3 text-muted-fg text-xs")],
								[part.excluded ? `${part.why} · no data, weight shared` : part.why],
							),
							td(h, part.score === null ? "—" : String(part.score)),
							td(h, part.excluded ? "—" : formatWeight(part.effectiveWeight), "text-muted-fg"),
							td(
								h,
								part.score === null
									? "—"
									: ((part.effectiveWeight * part.score) / 100).toFixed(1),
							),
						],
					),
				),
			),
			h.tfoot(
				[],
				[
					h.tr(
						[],
						[
							h.td(
								[h.Class("py-2 pr-3 text-muted-fg text-xs"), h.Attribute("colspan", "3")],
								[
									"Rounded to the nearest whole number. The same table appears on every customer page.",
								],
							),
							h.td([h.Class("py-2 text-right text-muted-fg text-xs")], ["Score"]),
							td(h, breakdown.score === null ? "—" : String(breakdown.score), "font-semibold"),
						],
					),
				],
			),
		],
	)

const scoreText = (breakdown: Customers.HealthBreakdown) =>
	breakdown.score === null ? "no score" : String(breakdown.score)

export const checkCard = (h: H, model: Model, context: Context): Html => {
	const accounts: ReadonlyArray<AccountRow> = model.accounts ?? []
	const result = Option.getOrNull(AsyncData.getData(model.preview.result))
	const sample =
		context.isDirty && model.check !== null
			? (result?.samples.find((candidate) => candidate.accountId === model.check?.accountId) ?? null)
			: null
	const saved = model.check === null ? null : Option.getOrNull(AsyncData.getData(model.check.saved))
	const picker = h.submodel({
		slotId: "health-check-account",
		model: model.checkAccount,
		view: selectView,
		viewInputs: {
			items: accounts.map((account) => Select.item(account.id, account.name)),
			ariaLabel: "Customer",
			placeholder: "Pick a customer",
			triggerClassName: "w-56",
		},
		toParentMessage: toCheckAccountMessage,
	})
	const scores: ReadonlyArray<Html> =
		sample !== null
			? [
					h.span([h.Class("text-muted-fg text-xs")], [`Saved ${scoreText(sample.current)}`]),
					IconChevronRight(h, { className: "size-3.5 text-muted-fg" }),
					healthBadge(h, { status: sample.proposed.status, score: sample.proposed.score }),
				]
			: saved !== null
				? [healthBadge(h, { status: saved.status, score: saved.score })]
				: []
	const body = (): ReadonlyArray<Html> => {
		if (model.check === null)
			return [
				h.p([h.Class("text-muted-fg text-sm")], ["Pick a customer to see how its score is built."]),
			]
		if (sample !== null) return [breakdownTable(h, sample.proposed)]
		return AsyncData.match(model.check.saved, {
			onIdle: () => [],
			onLoading: () => [h.p([h.Class("text-muted-fg text-sm")], ["Loading…"])],
			onRefreshing: (health) => breakdownOrNone(h, health, context, result !== null),
			onSuccess: (health) => breakdownOrNone(h, health, context, result !== null),
			onStale: ({ data: health }) => breakdownOrNone(h, health, context, result !== null),
			onFailure: (reason) => [h.p([h.Class("text-muted-fg text-sm")], [commonMessage(reason).title])],
		})
	}
	return card(h, "", [
		h.div(
			[h.Class("flex flex-wrap items-center gap-3")],
			[
				h.h2([h.Class("font-medium text-fg text-sm")], ["Check one customer"]),
				picker,
				h.span([h.Class("flex-1")]),
				...scores,
			],
		),
		...body(),
	])
}

const breakdownOrNone = (
	h: H,
	health: Customers.HealthBreakdown | null,
	context: Context,
	hasPreview: boolean,
): ReadonlyArray<Html> => [
	...(context.isDirty && hasPreview
		? [
				h.p(
					[h.Class("text-muted-fg text-xs")],
					[
						"Your changes keep this customer in its band. The preview details only customers that change band, so this is its saved breakdown.",
					],
				),
			]
		: []),
	health === null
		? h.p(
				[h.Class("text-muted-fg text-sm")],
				["Not scored yet: it gets a breakdown on the next compute."],
			)
		: breakdownTable(h, health),
]

// UNSAVED CHANGES

export const unsavedBar = (h: H, model: Model, context: Context, isValid: boolean): Html => {
	const result = Option.getOrNull(AsyncData.getData(model.preview.result))
	const moved = result === null ? [] : [`${formatCount(movedCount(result))} customers change band`]
	const isWeightProblem = context.total !== 100
	return h.div(
		[
			h.Role("region"),
			h.AriaLabel("Unsaved changes"),
			h.Class(
				"sticky bottom-0 z-10 -mx-4 -mb-6 flex flex-wrap items-center gap-3 border-border border-t bg-bg/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8",
			),
		],
		[
			h.span([
				h.AriaHidden(true),
				h.Class(twMerge("size-2 rounded-full", isValid ? "bg-warning" : "bg-danger")),
			]),
			h.span(
				[h.Class("font-medium text-fg text-sm")],
				[isValid ? "Unsaved changes" : "Can't save yet"],
			),
			h.span(
				[h.Class("min-w-0 flex-1 truncate text-muted-fg text-sm")],
				[
					isValid
						? [...changesOf(context.saved, context.draft), ...moved].join(" · ")
						: isWeightProblem
							? `Weights add up to ${context.total}%, not 100%`
							: "Fix the highlighted fields",
				],
			),
			button(h, { intent: "plain", size: "sm", onPress: Message.PressedDiscard() }, ["Discard"]),
			...(isWeightProblem ? [scaleButton(h, "min-h-8")] : []),
			button(
				h,
				{
					intent: "primary",
					size: "sm",
					isDisabled: !isValid,
					isPending: model.isSaving,
					onPress: Message.PressedSave(),
				},
				["Save and rescore"],
			),
		],
	)
}
