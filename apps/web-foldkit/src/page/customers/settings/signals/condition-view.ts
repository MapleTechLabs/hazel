import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatDate } from "../../../../customers/format"
import { PROVIDERS } from "../../../../customers/providers"
import { sourceChip, sourceLogo } from "../../../../customers/ui/identity"
import { AppRoute, hrefOf } from "../../../../route"
import { switchControl } from "../../../../ui/switch"
import { Message } from "./message"
import type { MetricRow, Model, RuleForm } from "./model"
import { card, fieldError, numberInput, toggleChip } from "./parts"

/**
 * The editor's condition, generated from the template's config: each threshold typed inline in its
 * sentence, its error under the row. `usage_drop` adds the metric picker and the windows bar.
 */

type H = HtmlBuilder<Message>

export interface ConditionContext {
	readonly model: Model
	readonly form: RuleForm
	readonly errors: Readonly<Record<string, string>>
	readonly isAdmin: boolean
	readonly orgSlug: string
	readonly nowMs: number
}

const DAY_MS = 86_400_000

const textOf = (form: RuleForm, key: string): string => {
	const value = form.config[key]
	return typeof value === "string" ? value : ""
}

const isOn = (form: RuleForm, key: string): boolean => form.config[key] === true

const inputIdOf = (key: string) => `signal-rule-${key}`

const num = (h: H, context: ConditionContext, key: string, label: string, isDisabled = false): Html =>
	numberInput(h, {
		id: inputIdOf(key),
		label,
		value: textOf(context.form, key),
		error: context.errors[`config.${key}`],
		isDisabled: !context.isAdmin || isDisabled,
		onInput: (value) => Message.ChangedConfigNumber({ key, value }),
	})

/** A labelled row: `Quiet for | No contact activity for [14] days`, errors for `keys` below. */
const row = (
	h: H,
	context: ConditionContext,
	label: string,
	sentence: ReadonlyArray<Html | string>,
	keys: ReadonlyArray<string>,
): Html =>
	h.div(
		[h.Class("grid gap-1 px-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-4")],
		[
			h.span([h.Class("text-muted-fg text-sm")], [label]),
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.div([h.Class("flex flex-wrap items-center gap-2 text-fg text-sm")], [...sentence]),
					...keys.flatMap((key) => fieldError(h, inputIdOf(key), context.errors[`config.${key}`])),
				],
			),
		],
	)

const rows = (h: H, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("divide-y divide-border rounded-lg border border-border")], [...children])

const note = (h: H, text: string): Html => h.p([h.Class("text-muted-fg text-xs")], [text])

const flag = (h: H, context: ConditionContext, key: string, label: string): Html =>
	switchControl(
		h,
		{
			id: inputIdOf(key),
			isSelected: isOn(context.form, key),
			isDisabled: !context.isAdmin,
			onChange: (isOn) => Message.ToggledConfigFlag({ key, isOn }),
		},
		label,
	)

const sentenceRows = (h: H, context: ConditionContext): ReadonlyArray<Html> => {
	const { form } = context
	switch (form.template) {
		case "inactive":
			return [
				rows(h, [
					row(
						h,
						context,
						"Quiet for",
						["No contact activity for", num(h, context, "inactiveDays", "Quiet days"), "days"],
						["inactiveDays"],
					),
					row(
						h,
						context,
						"Was active before",
						[
							"At least",
							num(h, context, "minPriorActiveUsers", "Active users before"),
							"active users in the",
							num(h, context, "priorWindowDays", "Days before"),
							"days before",
						],
						["minPriorActiveUsers", "priorWindowDays"],
					),
				]),
				note(
					h,
					"Accounts that were never active are left to Onboarding stalled, so the same account isn't flagged twice.",
				),
			]
		case "usage_drop":
			return []
		case "payment_failed":
			return [
				rows(h, [
					row(
						h,
						context,
						"Overdue",
						[
							"Subscription past due or unpaid, or an invoice open more than",
							num(h, context, "overdueDays", "Days overdue"),
							"days past its due date",
						],
						["overdueDays"],
					),
				]),
			]
		case "cancel_scheduled":
			return [
				rows(h, [
					row(h, context, "Cancellation", ["Set to cancel at the end of the billing period"], []),
					row(
						h,
						context,
						"Downgrades",
						[
							flag(h, context, "includeDowngrades", "Also flag downgrades"),
							"in the last",
							num(
								h,
								context,
								"downgradeWindowDays",
								"Downgrade window in days",
								!isOn(form, "includeDowngrades"),
							),
							"days",
						],
						["downgradeWindowDays"],
					),
				]),
			]
		case "trial_ending_low_activation":
			return [
				rows(h, [
					row(
						h,
						context,
						"Trial ends",
						["Within", num(h, context, "daysBeforeEnd", "Days before the trial ends"), "days"],
						["daysBeforeEnd"],
					),
					row(
						h,
						context,
						"Activation",
						[
							"Fewer than",
							num(h, context, "minActiveUsers", "Active users"),
							"active users in the last",
							num(h, context, "activeWindowDays", "Activity window in days"),
							"days",
						],
						["minActiveUsers", "activeWindowDays"],
					),
				]),
			]
		case "onboarding_stalled":
			return [
				rows(h, [
					row(
						h,
						context,
						"Account age",
						[
							"First seen",
							num(h, context, "minAgeDays", "Minimum age in days"),
							"to",
							num(h, context, "maxAgeDays", "Maximum age in days"),
							"days ago",
						],
						["minAgeDays", "maxAgeDays"],
					),
					row(
						h,
						context,
						"Activation",
						[
							"Fewer than",
							num(h, context, "minActiveContacts", "Active contacts"),
							"contacts ever active",
						],
						["minActiveContacts"],
					),
				]),
			]
		case "health_drop":
			return [
				rows(h, [
					row(
						h,
						context,
						"Drop",
						[
							"Health fell",
							num(h, context, "dropPoints", "Points"),
							"points or more within",
							num(h, context, "windowDays", "Window in days"),
							"days",
						],
						["dropPoints", "windowDays"],
					),
					row(
						h,
						context,
						"Critical",
						[flag(h, context, "onCritical", "Also when it turns Critical")],
						[],
					),
				]),
			]
		case "champion_inactive":
			return [
				rows(h, [
					row(
						h,
						context,
						"Champion",
						[
							"The most active user of the last",
							num(h, context, "windowDays", "Champion window in days"),
							"days",
						],
						["windowDays"],
					),
					row(
						h,
						context,
						"Quiet for",
						["Inactive for", num(h, context, "inactiveDays", "Quiet days"), "days"],
						["inactiveDays"],
					),
				]),
			]
		case "near_limit":
			return [
				rows(h, [
					row(
						h,
						context,
						"Threshold",
						[
							"At",
							num(h, context, "thresholdPct", "Percent of the limit"),
							"% or more of the plan limit",
						],
						["thresholdPct"],
					),
					row(h, context, "Features", [limitMetrics(h, context)], []),
				]),
			]
		case "seat_growth":
			return [
				rows(h, [
					row(
						h,
						context,
						"Growth",
						[
							"Active users up",
							num(h, context, "growthPct", "Growth percent"),
							"% or more in",
							num(h, context, "windowDays", "Window in days"),
							"days",
						],
						["growthPct", "windowDays"],
					),
					row(
						h,
						context,
						"Minimum",
						[
							"From at least",
							num(h, context, "minActiveUsers", "Active users at the start"),
							"active users",
						],
						["minActiveUsers"],
					),
				]),
			]
	}
}

// METRICS

const isMetricAvailable = (model: Model, metric: MetricRow): boolean =>
	metric.provider === null ||
	model.connectedProviders === null ||
	model.connectedProviders.includes(metric.provider)

/** `near_limit`'s features: the metered (Autumn) metrics; none picked = every limited metric. */
const limitMetrics = (h: H, context: ConditionContext): Html => {
	const picked = context.form.config.metricKeys
	const keys = Array.isArray(picked) ? picked : []
	const metered = context.model.metrics.filter((metric) => metric.provider === "autumn")
	return h.div(
		[h.Class("flex flex-wrap items-center gap-1.5")],
		[
			toggleChip(h, {
				label: "Any metered feature",
				isPressed: keys.length === 0,
				isDisabled: !context.isAdmin,
				onPress: Message.ClearedLimitMetrics(),
			}),
			...metered.map((metric) =>
				toggleChip(h, {
					label: metric.name,
					isPressed: keys.includes(metric.key),
					isDisabled: !context.isAdmin,
					onPress: Message.ToggledLimitMetric({ metricKey: metric.key }),
				}),
			),
		],
	)
}

const metricRow = (h: H, context: ConditionContext, metric: MetricRow, selected: string): Html => {
	const isSelected = metric.key === selected
	const available = isMetricAvailable(context.model, metric)
	const source = metric.provider ?? "hazel"
	const detail = [
		metric.description ?? (metric.provider === null ? "Built in" : PROVIDERS[metric.provider].name),
	]
	const body = [
		h.span(
			[
				h.AriaHidden(true),
				h.Class(
					twMerge(
						"flex size-4 shrink-0 items-center justify-center rounded-full border border-border",
						isSelected && "border-primary",
					),
				),
			],
			isSelected ? [h.span([h.Class("size-2 rounded-full bg-primary")])] : [],
		),
		h.span(
			[h.Class("flex min-w-0 flex-1 flex-col")],
			[
				h.span([h.Class("font-medium text-fg text-sm")], [metric.name]),
				h.span(
					[h.Class("truncate text-muted-fg text-xs")],
					[...detail, " · ", h.code([h.Class("font-mono")], [metric.key])],
				),
			],
		),
	]
	if (!available && metric.provider !== null) {
		return h.div(
			[h.Class("flex items-center gap-3 px-3 py-2.5")],
			[
				h.span([h.Class("flex min-w-0 flex-1 items-center gap-3 opacity-50")], body),
				h.span([h.Class("text-muted-fg text-xs")], [`Requires ${PROVIDERS[metric.provider].name}`]),
				h.a(
					[
						h.Href(
							hrefOf(
								AppRoute.CustomersSourceDetail({
									orgSlug: context.orgSlug,
									provider: metric.provider,
								}),
							),
						),
						h.Class("font-medium text-primary text-xs hover:underline"),
					],
					["Connect"],
				),
			],
		)
	}
	return h.button(
		[
			h.Type("button"),
			h.Role("radio"),
			h.AriaChecked(isSelected),
			...(context.isAdmin
				? [h.OnClick(Message.ClickedMetric({ metricKey: metric.key }))]
				: [h.Disabled(true)]),
			h.Class(
				twMerge(
					"flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-hidden transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset disabled:cursor-default",
					isSelected && "bg-primary-subtle/30 hover:bg-primary-subtle/30",
				),
			),
		],
		[...body, sourceLogo(h, source, "size-4")],
	)
}

const metricCard = (h: H, context: ConditionContext): Html => {
	const selected = textOf(context.form, "metricKey")
	const metrics = context.model.metrics.some((metric) => metric.key === selected)
		? context.model.metrics
		: [
				{ key: selected, name: selected, unit: null, provider: null, description: null },
				...context.model.metrics,
			]
	return card(
		h,
		{
			title: "Metric to watch",
			aside: h.span([h.Class("text-muted-fg text-xs")], ["Any daily metric synced from your sources"]),
		},
		[
			h.div(
				[
					h.Role("radiogroup"),
					h.AriaLabel("Metric to watch"),
					h.Class("divide-y divide-border overflow-hidden rounded-lg border border-border"),
				],
				metrics.map((metric) => metricRow(h, context, metric, selected)),
			),
		],
	)
}

/** `Baseline · previous 28 days | Last 7 days` to scale, with the days it spans (windows end yesterday). */
const windowsBar = (h: H, context: ConditionContext): ReadonlyArray<Html> => {
	const recent = Number(textOf(context.form, "recentDays"))
	const baseline = Number(textOf(context.form, "baselineDays"))
	if (!(Number.isInteger(recent) && Number.isInteger(baseline) && recent > 0 && baseline > 0)) return []
	const now = new Date(context.nowMs)
	const lastMs = context.nowMs - DAY_MS
	const day = (ms: number) => formatDate(new Date(ms), { now, timeZone: "UTC" })
	const share = (baseline / (baseline + recent)) * 100
	return [
		h.div(
			[h.Class("flex flex-col gap-1")],
			[
				h.div(
					[h.Class("flex h-7 overflow-hidden rounded-md text-xs")],
					[
						h.span(
							[
								h.Class(
									"flex items-center justify-center truncate bg-secondary px-2 text-fg-2",
								),
								h.Style({ width: `${share}%` }),
							],
							[`Baseline · previous ${baseline} days`],
						),
						h.span(
							[
								h.Class(
									"flex items-center justify-center truncate bg-warning-subtle px-2 text-warning-subtle-fg",
								),
								h.Style({ width: `${100 - share}%` }),
							],
							[`Last ${recent} days`],
						),
					],
				),
				h.div(
					[h.Class("relative h-4 text-muted-fg text-xs")],
					[
						h.span(
							[h.Class("absolute left-0")],
							[day(lastMs - (baseline + recent - 1) * DAY_MS)],
						),
						h.span(
							[h.Class("absolute -translate-x-1/2"), h.Style({ left: `${share}%` })],
							[day(lastMs - (recent - 1) * DAY_MS)],
						),
						h.span([h.Class("absolute right-0")], [day(lastMs)]),
					],
				),
			],
		),
	]
}

const usageDropCards = (h: H, context: ConditionContext): ReadonlyArray<Html> => [
	metricCard(h, context),
	card(h, { title: "Comparison" }, [
		...windowsBar(h, context),
		rows(h, [
			row(
				h,
				context,
				"Windows",
				[
					"Average of the last",
					num(h, context, "recentDays", "Recent days"),
					"days vs the",
					num(h, context, "baselineDays", "Baseline days"),
					"days before",
				],
				["recentDays", "baselineDays"],
			),
			row(
				h,
				context,
				"Drop",
				["Down by at least", num(h, context, "dropPct", "Drop percent"), "%"],
				["dropPct"],
			),
		]),
	]),
]

/** "Activity from": the sources the template reads (any one of them suffices). */
const activityFrom = (h: H, context: ConditionContext): Html | null => {
	const required = Customers.TEMPLATES[context.form.template].requiredSources
	if (required.length === 0) return null
	const connected = context.model.connectedProviders
	return h.span(
		[h.Class("flex flex-wrap items-center gap-1.5 text-muted-fg text-xs")],
		[
			"Activity from",
			...required.map((source) =>
				sourceChip(h, source, {
					className: twMerge(
						"h-6 text-xs",
						connected !== null && !connected.includes(source) && "opacity-50",
					),
				}),
			),
		],
	)
}

export const conditionCards = (h: H, context: ConditionContext): ReadonlyArray<Html> =>
	context.form.template === "usage_drop"
		? usageDropCards(h, context)
		: [card(h, { title: "Condition", aside: activityFrom(h, context) }, [...sentenceRows(h, context)])]
