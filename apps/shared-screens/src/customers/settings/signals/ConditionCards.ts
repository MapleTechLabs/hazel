// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The rule editor's condition (today's `condition-view.ts`), generated from the template's config:
 * each threshold typed in its sentence, its error under the field. `usage_drop` adds the metric
 * picker and its windows; `near_limit` the metered features.
 */
import { meteredProviders, requiredSourcesOf } from "@hazel/customer-integrations"
import { type Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { formatDate } from "../../data/format"
import { providerOf } from "../../data/providers"
import { sourceChip, sourceLogoSrc } from "../../ui/identity"
import { type EditorContext, RuleEditorMessage } from "./editor-state"
import type { MetricRow } from "./model"
import { panel } from "./parts"

type H = Hazel.H<RuleEditorMessage>

const DAY_MS = 86_400_000

const textOf = (context: EditorContext, key: string): string => {
	const value = context.form.config[key]
	return typeof value === "string" ? value : ""
}

const isOn = (context: EditorContext, key: string): boolean => context.form.config[key] === true

/** A threshold, typed in its sentence. */
// HAZEL-GAP(pk7-inline-number-field): today a 64px field sits inline in the sentence, named only for assistive tech; `textField` draws its label above and takes its row.
const num = (h: H, context: EditorContext, key: string, label: string, isDisabled = false) =>
	h.textField
		.key(key)
		.label(label)
		.inputKind("number")
		.value(context.model.fields[`config.${key}`] ?? TextField.empty)
		.error(context.errors[`config.${key}`])
		.disabled(!context.isAdmin || isDisabled)
		.on("change", (payload) => RuleEditorMessage.ChangedField({ key: `config.${key}`, payload }))

type Run = Hazel.NoTextInput<RuleEditorMessage> | string

/** A labelled row: `Quiet for | No contact activity for [14] days`. */
const row = (h: H, label: string, ...sentence: ReadonlyArray<Run>) =>
	h.property
		.key(label)
		.label(label)
		.children(
			h.stack
				.axis("horizontal")
				.wrap()
				.align("center")
				.density("compact")
				.children(
					...sentence.map((part, index) =>
						typeof part === "string" ? h.text.key(`t${index}`).children(part) : part,
					),
				),
		)

const rows = (h: H, ...children: ReadonlyArray<Hazel.NoTextInput<RuleEditorMessage>>) =>
	h.frame
		.key("rows")
		.surface("inset")
		.children(h.stack.density("regular").children(...children))

const note = (h: H, text: string) => h.text.key("note").role("caption").tone("muted").children(text)

const flag = (h: H, context: EditorContext, key: string, label: string) =>
	h.toggle
		.key(key)
		.label(label)
		.checked(isOn(context, key))
		.disabled(!context.isAdmin)
		.on("change", ({ checked }) => RuleEditorMessage.ToggledConfigFlag({ key, checked }))

/** The SLA templates: one grace field; the deadlines come from the SLA policies. */
const graceRows = (h: H, context: EditorContext, sentence: string) => [
	rows(
		h,
		row(h, "Grace (minutes)", sentence, num(h, context, "graceMinutes", "Grace in minutes"), "minutes"),
	),
	note(
		h,
		"Deadlines come from the SLA policies. Covers every customer, whatever Needs attention covers; the scope below still applies.",
	),
]

const sentenceRows = (h: H, context: EditorContext) => {
	switch (context.form.template) {
		case "inactive":
			return [
				rows(
					h,
					row(
						h,
						"Quiet for",
						"No contact activity for",
						num(h, context, "inactiveDays", "Quiet days"),
						"days",
					),
					row(
						h,
						"Was active before",
						"At least",
						num(h, context, "minPriorActiveUsers", "Active users before"),
						"active users in the",
						num(h, context, "priorWindowDays", "Days before"),
						"days before",
					),
				),
				note(
					h,
					"Accounts that were never active are left to Onboarding stalled, so the same account isn't flagged twice.",
				),
			]
		case "usage_drop":
			return []
		case "payment_failed":
			return [
				rows(
					h,
					row(
						h,
						"Overdue",
						"Subscription past due or unpaid, or an invoice open more than",
						num(h, context, "overdueDays", "Days overdue"),
						"days past its due date",
					),
				),
			]
		case "cancel_scheduled":
			return [
				rows(
					h,
					row(h, "Cancellation", "Set to cancel at the end of the billing period"),
					row(
						h,
						"Downgrades",
						flag(h, context, "includeDowngrades", "Also flag downgrades"),
						"in the last",
						num(
							h,
							context,
							"downgradeWindowDays",
							"Downgrade window in days",
							!isOn(context, "includeDowngrades"),
						),
						"days",
					),
				),
			]
		case "trial_ending_low_activation":
			return [
				rows(
					h,
					row(
						h,
						"Trial ends",
						"Within",
						num(h, context, "daysBeforeEnd", "Days before the trial ends"),
						"days",
					),
					row(
						h,
						"Activation",
						"Fewer than",
						num(h, context, "minActiveUsers", "Active users"),
						"active users in the last",
						num(h, context, "activeWindowDays", "Activity window in days"),
						"days",
					),
				),
			]
		case "onboarding_stalled":
			return [
				rows(
					h,
					row(
						h,
						"Account age",
						"First seen",
						num(h, context, "minAgeDays", "Minimum age in days"),
						"to",
						num(h, context, "maxAgeDays", "Maximum age in days"),
						"days ago",
					),
					row(
						h,
						"Activation",
						"Fewer than",
						num(h, context, "minActiveContacts", "Active contacts"),
						"contacts ever active",
					),
				),
			]
		case "champion_inactive":
			return [
				rows(
					h,
					row(
						h,
						"Champion",
						"The most active user of the last",
						num(h, context, "windowDays", "Champion window in days"),
						"days",
					),
					row(
						h,
						"Quiet for",
						"Inactive for",
						num(h, context, "inactiveDays", "Quiet days"),
						"days",
					),
				),
			]
		case "near_limit":
			return [
				rows(
					h,
					row(
						h,
						"Threshold",
						"At",
						num(h, context, "thresholdPct", "Percent of the limit"),
						"% or more of the plan limit",
					),
					row(h, "Features", limitMetrics(h, context)),
				),
			]
		case "seat_growth":
			return [
				rows(
					h,
					row(
						h,
						"Growth",
						"Active users up",
						num(h, context, "growthPct", "Growth percent"),
						"% or more in",
						num(h, context, "windowDays", "Window in days"),
						"days",
					),
					row(
						h,
						"Minimum",
						"From at least",
						num(h, context, "minActiveUsers", "Active users at the start"),
						"active users",
					),
				),
			]
		case "churned":
			return [
				rows(
					h,
					row(
						h,
						"Window",
						"Churned in the last",
						num(h, context, "windowDays", "Window in days"),
						"days",
					),
				),
			]
		case "response_overdue":
			return graceRows(h, context, "An open issue's reply is overdue by at least")
		case "resolution_overdue":
			return graceRows(h, context, "An open issue is past its resolution target by at least")
	}
}

// METRICS

const isMetricAvailable = (context: EditorContext, metric: MetricRow): boolean =>
	metric.provider === null ||
	context.model.providers === null ||
	context.model.providers.includes(metric.provider)

const ANY = "*any"

/** `near_limit`'s features: the metered sources' metrics; none picked = every limited metric. */
const limitMetrics = (h: H, context: EditorContext) => {
	const picked = context.form.config.metricKeys
	const keys = Array.isArray(picked) ? picked : []
	const metered = context.model.metrics.filter(
		(metric) => metric.provider !== null && meteredProviders.includes(metric.provider),
	)
	return h.choiceGroup
		.key("features")
		.label("Features")
		.labelHidden()
		.style("chips")
		.multiple()
		.options([
			{ value: ANY, label: "Any metered feature" },
			...metered.map((metric) => ({ value: metric.key, label: metric.name })),
		])
		.selected(keys.length === 0 ? [ANY] : keys)
		.disabled(!context.isAdmin)
		.on("change", ({ selected }) =>
			RuleEditorMessage.PickedLimitMetrics({
				// Picking "Any" clears the others; picking a feature drops "Any".
				metricKeys:
					selected.includes(ANY) && keys.length > 0 ? [] : selected.filter((key) => key !== ANY),
			}),
		)
}

// HAZEL-GAP(pk7-metric-connect): today an unavailable metric row ends in "Requires <source> · Connect", a link to the source.
const metricCard = (h: H, context: EditorContext) => {
	const selected = textOf(context, "metricKey")
	const metrics: ReadonlyArray<MetricRow> = context.model.metrics.some((metric) => metric.key === selected)
		? context.model.metrics
		: [
				{ key: selected, name: selected, unit: null, provider: null, description: null },
				...context.model.metrics,
			]
	return panel(
		h,
		{
			key: "metric",
			title: "Metric to watch",
			aside: h.text.role("caption").tone("muted").children("Any daily metric synced from your sources"),
		},
		h.choiceGroup
			.label("Metric to watch")
			.labelHidden()
			.options(
				metrics.map((metric) => {
					const available = isMetricAvailable(context, metric)
					const source = metric.provider === null ? "Built in" : providerOf(metric.provider).name
					return {
						value: metric.key,
						label: metric.name,
						description: available
							? `${metric.description ?? source} · ${metric.key}`
							: `Requires ${source} · ${metric.key}`,
						image: sourceLogoSrc(metric.provider ?? "hazel"),
						disabled: !available,
					}
				}),
			)
			.selected([selected])
			.disabled(!context.isAdmin)
			.on("change", ({ selected: picked }) =>
				RuleEditorMessage.PickedMetric({
					metricKey: picked.find((key) => key !== selected) ?? selected,
				}),
			),
	)
}

/** `Baseline · previous 28 days | Last 7 days`, with the days each spans (windows end yesterday). */
// HAZEL-GAP(pk7-windows-bar): today the two windows are a bar drawn to scale (grey baseline, amber recent) over three day ticks.
const windows = (h: H, context: EditorContext) => {
	const recent = Number(textOf(context, "recentDays"))
	const baseline = Number(textOf(context, "baselineDays"))
	if (!(Number.isInteger(recent) && Number.isInteger(baseline) && recent > 0 && baseline > 0)) return null
	const now = new Date(context.nowMs)
	const lastMs = context.nowMs - DAY_MS
	const day = (ms: number) => formatDate(new Date(ms), { now, timeZone: "UTC" })
	return h.text
		.key("windows")
		.role("caption")
		.tone("muted")
		.children(
			`Baseline · previous ${baseline} days (${day(lastMs - (baseline + recent - 1) * DAY_MS)} to ${day(lastMs - recent * DAY_MS)}) · Last ${recent} days (${day(lastMs - (recent - 1) * DAY_MS)} to ${day(lastMs)})`,
		)
}

const usageDropCards = (h: H, context: EditorContext) => [
	metricCard(h, context),
	panel(
		h,
		{ key: "comparison", title: "Comparison" },
		windows(h, context),
		rows(
			h,
			row(
				h,
				"Windows",
				"Average of the last",
				num(h, context, "recentDays", "Recent days"),
				"days vs the",
				num(h, context, "baselineDays", "Baseline days"),
				"days before",
			),
			row(h, "Drop", "Down by at least", num(h, context, "dropPct", "Drop percent"), "%"),
		),
	),
]

/** "Activity from": the sources the template reads (any one of them suffices). */
// HAZEL-GAP(pk7-source-chip-dim): today a source that is not connected shows its chip at half opacity.
const activityFrom = (h: H, context: EditorContext) => {
	const required = requiredSourcesOf(context.form.template)
	if (required.length === 0) return undefined
	return h.stack
		.axis("horizontal")
		.wrap()
		.align("center")
		.density("snug")
		.children(
			h.text.role("caption").tone("muted").children("Activity from"),
			...required.map((source) => sourceChip(h, source).key(source)),
		)
}

export const conditionCards = (h: H, context: EditorContext) =>
	context.form.template === "usage_drop"
		? usageDropCards(h, context)
		: [
				panel(
					h,
					{ key: "condition", title: "Condition", aside: activityFrom(h, context) },
					...sentenceRows(h, context),
				),
			]
