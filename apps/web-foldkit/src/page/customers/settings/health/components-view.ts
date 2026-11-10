import * as Customers from "@hazel/domain/customers"
import type { Html } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { severityGlyph } from "../../../../customers/ui/badges"
import { sourceMark } from "../../../../customers/ui/identity"
import { IconCheck, IconWarning } from "../../../../icons"
import { button } from "../../../../ui/button"
import * as Slider from "../../../../ui/slider"
import { card, type Context, type H, numberInput, parseNumber, ruleHeading, ruleRow, textOf } from "./fields"
import { Message } from "./message"
import {
	COMPONENT_LABEL,
	COMPONENTS,
	type Model,
	PENALTY_FIELDS,
	type ScoreField,
	type StepList,
} from "./model"
import { SLIDER_MESSAGE } from "./update"

/** The score card (weights and their total) and the four component cards (weight, scoring rules). */

type ComponentKey = Customers.HealthComponentKey

export const COMPONENT_FILL = {
	usage: "bg-chart-series-1",
	engagement: "bg-chart-series-2",
	billing: "bg-chart-series-3",
	signals: "bg-chart-neutral",
} as const satisfies Record<ComponentKey, string>

const COMPONENT_BORDER = {
	usage: "border-chart-series-1",
	engagement: "border-chart-series-2",
	billing: "border-chart-series-3",
	signals: "border-chart-neutral",
} as const satisfies Record<ComponentKey, string>

const DESCRIPTION = {
	usage: "How much of the account uses the product",
	engagement: "How recently anyone at the account was active",
	billing: "Whether the account pays on time",
	signals: "Open risk items in Needs attention",
} as const satisfies Record<ComponentKey, string>

const SOURCES = {
	usage: ["clerk", "maple"],
	engagement: ["clerk", "maple"],
	billing: ["stripe", "autumn"],
	signals: ["hazel"],
} as const satisfies Record<ComponentKey, ReadonlyArray<Customers.CustomerSource>>

const off = (total: number) => Math.abs(total - 100)

/** "Weights add up to 110%. Lower one or more parts by 10 points in total, …" */
export const totalProblem = (total: number): string =>
	`Weights add up to ${total}%. ${total > 100 ? "Lower" : "Raise"} one or more parts by ${off(total)} points in total, or scale them back to 100%.`

export const scaleButton = (h: H, className?: string): Html =>
	button(h, { intent: "outline", size: "xs", onPress: Message.PressedScaleWeights(), className }, [
		"Scale to 100%",
	])

const totalPill = (h: H, total: number): Html =>
	total === 100
		? h.span(
				[
					h.Class(
						"inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 font-medium text-success-subtle-fg text-xs tabular-nums",
					),
				],
				[IconCheck(h, { className: "size-3" }), "100%", h.span([h.Class("font-normal")], ["total"])],
			)
		: h.span(
				[
					h.Class(
						"inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2 py-0.5 font-medium text-danger-subtle-fg text-xs tabular-nums",
					),
				],
				[
					IconWarning(h, { className: "size-3" }),
					`${total}%`,
					h.span([h.Class("font-normal")], [`${off(total)} ${total > 100 ? "over" : "under"}`]),
				],
			)

/** "Score = weighted average of four parts": the stacked weights, their legend and total. */
export const weightsCard = (h: H, context: Context): Html => {
	const { draft, saved, total } = context
	const isOff = total !== 100
	const scale = Math.max(total, 100)
	return card(h, twMerge(isOff && "border-danger"), [
		h.div(
			[h.Class("flex flex-wrap items-start justify-between gap-3")],
			[
				h.div(
					[h.Class("flex min-w-0 flex-col gap-0.5")],
					[
						h.h2(
							[h.Class("font-medium text-fg text-sm")],
							["Score = weighted average of four parts"],
						),
						isOff
							? h.p(
									[h.Role("alert"), h.Class("text-danger-subtle-fg text-xs")],
									[totalProblem(total)],
								)
							: h.p(
									[h.Class("text-muted-fg text-xs")],
									[
										"Each part scores 0–100 from the rules below. A part with no data drops out and its weight is shared by the others.",
									],
								),
					],
				),
				h.div(
					[h.Class("flex items-center gap-2")],
					[...(isOff && context.canEdit ? [scaleButton(h)] : []), totalPill(h, total)],
				),
			],
		),
		h.div(
			[h.Class("relative")],
			[
				h.div(
					[
						h.Role("img"),
						h.AriaLabel(
							COMPONENTS.map((key) => `${COMPONENT_LABEL[key]} ${draft.weights[key]}%`).join(
								", ",
							),
						),
						h.Class("flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-secondary"),
					],
					COMPONENTS.filter((key) => draft.weights[key] > 0).map((key) =>
						h.span([
							h.Class(
								twMerge(
									"block h-full first:rounded-l-full last:rounded-r-full",
									COMPONENT_FILL[key],
								),
							),
							h.Style({ width: `${(draft.weights[key] / scale) * 100}%` }),
						]),
					),
				),
				...(total > 100
					? [
							h.span([
								h.AriaHidden(true),
								h.Class(
									"absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-danger",
								),
								h.Style({ left: `${(100 / total) * 100}%` }),
							]),
						]
					: []),
			],
		),
		h.div(
			[h.Class("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs")],
			[
				...COMPONENTS.map((key) =>
					h.span(
						[h.Class("inline-flex items-center gap-1.5")],
						[
							h.span([h.Class(twMerge("size-2.5 rounded-[2px]", COMPONENT_FILL[key]))]),
							h.span([h.Class("text-muted-fg")], [COMPONENT_LABEL[key]]),
							h.span([h.Class("font-medium text-fg tabular-nums")], [`${draft.weights[key]}%`]),
							...(draft.weights[key] === saved.weights[key]
								? []
								: [
										h.span(
											[h.Class("text-warning-subtle-fg")],
											[`was ${saved.weights[key]}%`],
										),
									]),
						],
					),
				),
				...(total > 100 ? [h.span([h.Class("ml-auto text-muted-fg")], ["Red line = 100%"])] : []),
			],
		),
	])
}

// COMPONENT CARDS

/** − 40% +: steps by 5 to the next multiple of 5. */
const stepper = (h: H, key: ComponentKey, context: Context): Html => {
	const value = context.draft.weights[key]
	const isChanged = value !== context.saved.weights[key]
	const stepButton = (label: string, ariaLabel: string, next: number) =>
		h.button(
			[
				h.Type("button"),
				h.AriaLabel(ariaLabel),
				h.Disabled(!context.canEdit || next === value),
				h.OnClick(Message.ChangedWeight({ key, value: next })),
				h.Class(
					"flex h-7 w-7 cursor-pointer items-center justify-center text-muted-fg outline-hidden hover:text-fg focus-visible:text-fg disabled:cursor-default disabled:opacity-50",
				),
			],
			[label],
		)
	return h.div(
		[
			h.Class(
				twMerge(
					"flex shrink-0 items-center rounded-lg border border-border bg-bg",
					isChanged && "border-warning",
				),
			),
		],
		[
			stepButton(
				"−",
				`Lower the ${COMPONENT_LABEL[key]} weight`,
				Math.max(0, Math.ceil(value / 5) * 5 - 5),
			),
			h.span(
				[
					h.AriaLive("polite"),
					h.Class("w-11 text-center font-semibold text-fg text-sm tabular-nums"),
				],
				[`${value}%`],
			),
			stepButton(
				"+",
				`Raise the ${COMPONENT_LABEL[key]} weight`,
				Math.min(100, Math.floor(value / 5) * 5 + 5),
			),
		],
	)
}

const weightSlider = (h: H, model: Model, key: ComponentKey, context: Context): Html => {
	const saved = context.saved.weights[key]
	const value = context.draft.weights[key]
	return h.submodel({
		slotId: `health-weight-${key}`,
		model: model.sliders[key],
		view: Slider.view,
		viewInputs: {
			value,
			ariaLabel: `${COMPONENT_LABEL[key]} weight`,
			formatValue: (weight: number) => `${weight}%`,
			isDisabled: !context.canEdit,
			toView: (attributes) =>
				h.div(
					[
						...attributes.root,
						h.Class(
							"relative flex h-4 w-full touch-none select-none items-center data-disabled:opacity-60",
						),
					],
					[
						h.div(
							[...attributes.track, h.Class("h-1.5 w-full rounded-full bg-secondary")],
							[
								h.div([
									...attributes.filledTrack,
									h.Class(twMerge("rounded-full", COMPONENT_FILL[key])),
								]),
								...(saved === value
									? []
									: [
											h.span([
												h.Title(`Saved: ${saved}%`),
												h.Class(
													"pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-fg",
												),
												h.Style({ left: `${saved}%` }),
											]),
										]),
							],
						),
						h.div([
							...attributes.thumb,
							h.Class(
								twMerge(
									"top-1/2 size-4 -translate-y-1/2 cursor-grab rounded-full border-2 bg-fg outline-hidden focus-visible:ring-3 focus-visible:ring-ring/30 data-dragging:cursor-grabbing data-disabled:cursor-default",
									COMPONENT_BORDER[key],
								),
							),
						]),
					],
				),
		},
		toParentMessage: SLIDER_MESSAGE[key],
	})
}

const scoreInput = (h: H, field: ScoreField, value: number, ariaLabel: string, context: Context): Html =>
	numberInput(h, {
		value: textOf(value),
		ariaLabel,
		isInvalid: context.invalid.has(field),
		isDisabled: !context.canEdit,
		onInput: (text) => Message.ChangedScore({ field, value: parseNumber(text) }),
	})

/** One threshold list: every step but the last has a threshold; the last catches the rest. */
const stepRows = (
	h: H,
	context: Context,
	options: Readonly<{
		list: StepList
		steps: ReadonlyArray<{ readonly threshold: number; readonly score: number }>
		/** The threshold as the input shows it, and back. */
		show: (threshold: number) => number
		read: (shown: number) => number
		condition: (input: Html) => ReadonlyArray<Html | string>
		otherwise: string
		unit: string
	}>,
): ReadonlyArray<Html> =>
	options.steps.map((step, index) => {
		const isLast = index === options.steps.length - 1
		const threshold = numberInput(h, {
			value: textOf(options.show(step.threshold)),
			ariaLabel: `Step ${index + 1} threshold, ${options.unit}`,
			isInvalid: context.invalid.has(`${options.list}.${index}.threshold`),
			isDisabled: !context.canEdit,
			onInput: (text) =>
				Message.ChangedStep({
					list: options.list,
					index,
					field: "threshold",
					value: options.read(parseNumber(text)),
				}),
		})
		return ruleRow(h, isLast ? [options.otherwise] : options.condition(threshold), [
			"→",
			numberInput(h, {
				value: textOf(step.score),
				ariaLabel: `Step ${index + 1} score`,
				isInvalid: context.invalid.has(`${options.list}.${index}.score`),
				isDisabled: !context.canEdit,
				onInput: (text) =>
					Message.ChangedStep({
						list: options.list,
						index,
						field: "score",
						value: parseNumber(text),
					}),
			}),
		])
	})

const rules = (h: H, key: ComponentKey, context: Context): ReadonlyArray<Html> => {
	const { steps } = context.draft
	const identity = (value: number) => value
	const section = (children: ReadonlyArray<Html>) =>
		h.div([h.Class("flex flex-col gap-1.5")], [...children])
	switch (key) {
		case "usage":
			return [
				section([
					ruleHeading(h, "Active ratio", "active users 30d ÷ contacts"),
					...stepRows(h, context, {
						list: "activeRatio",
						steps: steps.usage.activeRatio.map((step) => ({
							threshold: step.min,
							score: step.score,
						})),
						show: (ratio) => Math.round(ratio * 10_000) / 100,
						read: (percent) => percent / 100,
						condition: (input) => ["At least", input, "%"],
						otherwise: "Anything lower",
						unit: "percent of contacts",
					}),
				]),
				section([
					ruleHeading(h, "Usage trend", "active users, last 7 days vs the 28 before"),
					...stepRows(h, context, {
						list: "trend",
						steps: steps.usage.trend.map((step) => ({ threshold: step.min, score: step.score })),
						show: identity,
						read: identity,
						condition: (input) => ["Change of at least", input, "%"],
						otherwise: "Anything lower",
						unit: "percent change",
					}),
				]),
				h.p(
					[h.Class("flex flex-wrap items-center gap-1.5 text-muted-fg text-xs")],
					[
						"Part score =",
						scoreInput(
							h,
							"activeRatioWeight",
							steps.usage.activeRatioWeight,
							"Active ratio share",
							context,
						),
						`% active ratio + ${textOf(100 - steps.usage.activeRatioWeight)}% trend. No trend yet: the ratio alone.`,
					],
				),
			]
		case "engagement":
			return [
				section([
					ruleHeading(h, "Days since last activity", "any contact, any source"),
					...stepRows(h, context, {
						list: "daysSinceActive",
						steps: steps.engagement.daysSinceActive.map((step) => ({
							threshold: step.max,
							score: step.score,
						})),
						show: identity,
						read: identity,
						condition: (input) => ["Active in the last", input, "days"],
						otherwise: "Anything older, or never active",
						unit: "days",
					}),
				]),
			]
		case "billing": {
			const row = (field: (typeof BILLING_ROWS)[number][0], label: string) =>
				ruleRow(
					h,
					[label],
					["→", scoreInput(h, field, steps.billing[field], `${label} score`, context)],
				)
			return [
				section([
					ruleHeading(h, "Payment status", "worst state wins"),
					...BILLING_ROWS.map(([field, label]) => row(field, label)),
				]),
			]
		}
		case "signals":
			return [
				section([
					ruleHeading(h, "Start at 100, subtract per open item", "floor at 0"),
					...PENALTY_FIELDS.map((severity) =>
						ruleRow(
							h,
							[severityGlyph(h, severity), `Each open ${severity}-severity risk`],
							[
								"−",
								scoreInput(
									h,
									severity,
									steps.signals[severity],
									`${severity} severity penalty`,
									context,
								),
							],
						),
					),
				]),
				h.p(
					[h.Class("text-muted-fg text-xs")],
					[
						`Snoozed items count; dismissed ones and opportunities don't. Never counted, so the score can't feed itself: ${context.draft.excludedTemplates
							.map((template) => Customers.TEMPLATES[template].name)
							.join(", ")}.`,
					],
				),
			]
	}
}

const BILLING_ROWS = [
	["ok", "Paid up, no open invoices"],
	["overdue", "Invoice overdue up to 7 days"],
	["cancelScheduled", "Cancellation scheduled"],
	["overdueOverWeek", "Invoice overdue more than 7 days"],
	["pastDue", "Payment past due or unpaid"],
] as const satisfies ReadonlyArray<readonly [ScoreField, string]>

export interface DataGaps {
	readonly neverActive: number
	readonly noSubscription: number
}

const footnote = (key: ComponentKey, gaps: DataGaps | null): string | null => {
	if (key === "signals") return "Always has data"
	if (gaps === null) return null
	if (key === "billing")
		return gaps.noSubscription === 0
			? "Every account has a subscription"
			: `No subscription: ${gaps.noSubscription} accounts, weight shared`
	return gaps.neverActive === 0
		? "Every account has been active"
		: `Never active: ${gaps.neverActive} accounts, lowest step`
}

export const componentCard = (
	h: H,
	model: Model,
	key: ComponentKey,
	context: Context,
	gaps: DataGaps | null,
): Html => {
	const { weights } = context.draft
	const others = context.total - weights[key]
	const note = footnote(key, gaps)
	return card(h, "", [
		h.div(
			[h.Class("flex items-start justify-between gap-3")],
			[
				h.div(
					[h.Class("flex min-w-0 flex-col gap-0.5")],
					[
						h.div(
							[h.Class("flex items-center gap-2")],
							[
								h.span([h.Class(twMerge("size-2.5 rounded-[2px]", COMPONENT_FILL[key]))]),
								h.h3([h.Class("font-medium text-fg text-sm")], [COMPONENT_LABEL[key]]),
							],
						),
						h.p([h.Class("text-muted-fg text-xs")], [DESCRIPTION[key]]),
					],
				),
				stepper(h, key, context),
			],
		),
		weightSlider(h, model, key, context),
		...(model.lastWeight === key && context.total > 100
			? [
					h.p(
						[h.Class("-mt-2 text-danger-subtle-fg text-xs")],
						[`Max ${Math.max(0, 100 - others)}% here while the other parts stay at ${others}%`],
					),
				]
			: []),
		h.div([h.Class("flex flex-col gap-3")], [...rules(h, key, context)]),
		h.div(
			[h.Class("mt-auto flex items-center gap-1.5 border-border border-t pt-3")],
			[
				...SOURCES[key].map((source) => sourceMark(h, source, { size: "sm" })),
				...(note === null ? [] : [h.span([h.Class("ml-auto text-muted-fg text-xs")], [note])]),
			],
		),
	])
}
