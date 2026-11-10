import * as Customers from "@hazel/domain/customers"
import { Option, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { evidenceBars } from "../../../../customers/charts/sparkline"
import {
	formatCount,
	formatDay,
	formatDeltaCount,
	formatDeltaPct,
	formatMoney,
} from "../../../../customers/format"
import { PROVIDERS, sourcesLabel } from "../../../../customers/providers"
import { evidenceViz } from "../../../../customers/ui/evidence"
import { companyLogo } from "../../../../customers/ui/identity"
import { IconWarning } from "../../../../icons"
import { AppRoute, customerRoute, hrefOf } from "../../../../route"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { loader } from "../../../../ui/loader"
import type { EditorStatus } from "./draft"
import { metricNameOf } from "./list-view"
import { Message } from "./message"
import type { Editor, Model, RuleForm } from "./model"
import { card } from "./parts"

/**
 * The live preview (Wonder `ati`, `mia`): the draft dry-run over today's data, what saving would do
 * to Needs attention, the top matches, why the rest don't match, and for a usage rule an example
 * match's daily series with both windows.
 */

type H = HtmlBuilder<Message>
type Result = Customers.RuleDryRunResult
type SeriesEvidence = Extract<Customers.SignalEvidence, { _tag: "series" }>

const toExample = (accountId: string) => Message.ChangedExampleAccount({ accountId })

export interface PreviewContext {
	readonly model: Model
	readonly editor: Editor
	readonly form: RuleForm
	readonly status: EditorStatus
	readonly orgSlug: string
}

const statusLine = (h: H, context: PreviewContext): Html => {
	const { editor, status } = context
	const [text, dot] = Option.isNone(status.draft)
		? ["Waiting for valid values", "bg-warning"]
		: AsyncData.isPending(editor.preview)
			? ["Updating…", "bg-info animate-pulse"]
			: editor.ruleId !== null && status.changes === 0
				? ["Same as saved", "bg-success"]
				: ["Updates as you edit", "bg-success"]
	return h.span(
		[h.AriaLive("polite"), h.Class("inline-flex items-center gap-1.5 text-muted-fg text-xs")],
		[h.span([h.AriaHidden(true), h.Class(twMerge("size-1.5 rounded-full", dot))]), text],
	)
}

const missingSources = (h: H, result: Result, orgSlug: string): ReadonlyArray<Html> => {
	const providers = result.missingSources.filter(Schema.is(Customers.CustomerProvider))
	const first = providers[0]
	return first === undefined
		? []
		: [
				h.div(
					[
						h.Role("note"),
						h.Class(
							"flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm text-warning-subtle-fg",
						),
					],
					[
						IconWarning(h, { className: "mt-0.5 size-4 shrink-0" }),
						h.span(
							[h.Class("flex-1")],
							[
								`This rule needs ${sourcesLabel(providers)} connected before anything can match. `,
							],
						),
						h.a(
							[
								h.Href(hrefOf(AppRoute.CustomersSourceDetail({ orgSlug, provider: first }))),
								h.Class("shrink-0 font-medium underline underline-offset-2"),
							],
							[`Connect ${PROVIDERS[first].name}`],
						),
					],
				),
			]
}

/** What saving does to the queue (`queueDelta`), in words. */
const queueEffect = (h: H, context: PreviewContext, result: Result): Html => {
	const { opens, resolves, stays } = result.queueDelta
	const items = (count: number) => `${formatCount(count)} ${count === 1 ? "item" : "items"}`
	const unchanged = context.editor.ruleId !== null && context.status.changes === 0
	const [title, detail] = !context.form.enabled
		? ["The rule is off", "Nothing reaches Needs attention while it stays off."]
		: unchanged
			? [
					`${items(stays)} in Needs attention`,
					opens > 0 ? `${items(opens)} more on the next hourly check.` : "Nothing changes on save.",
				]
			: [
					opens === 0 && resolves === 0
						? "Saving changes nothing in Needs attention"
						: [
								...(opens > 0 ? [`Saving adds ${items(opens)} to Needs attention`] : []),
								...(resolves > 0
									? [`${opens > 0 ? "and resolves" : "Saving resolves"} ${items(resolves)}`]
									: []),
							].join(" "),
					stays > 0 ? `The ${formatCount(stays)} already open or snoozed stay as they are.` : null,
				]
	return h.div(
		[h.Class("flex flex-col gap-0.5 rounded-lg bg-primary-subtle/40 px-3 py-2.5")],
		[
			h.span([h.Class("font-medium text-fg text-sm")], [title]),
			...(detail === null ? [] : [h.span([h.Class("text-muted-fg text-xs")], [detail])]),
		],
	)
}

const headline = (h: H, context: PreviewContext, result: Result): Html => {
	const saved = context.status.saved
	const delta = saved === undefined ? 0 : result.matchCount - saved.matchingCount
	const total = context.model.accounts?.length ?? null
	return h.div(
		[h.Class("flex flex-col gap-0.5")],
		[
			h.div(
				[h.Class("flex flex-wrap items-baseline gap-2")],
				[
					h.span(
						[h.Class("font-semibold text-3xl text-fg tabular-nums")],
						[formatCount(result.matchCount)],
					),
					h.span(
						[h.Class("text-fg text-sm")],
						[result.matchCount === 1 ? "account matches" : "accounts match"],
					),
					...(delta === 0
						? []
						: [
								badge(h, { intent: delta > 0 ? "warning" : "info" }, [
									`${formatDeltaCount(delta)} vs saved`,
								]),
							]),
				],
			),
			h.span(
				[h.Class("text-muted-fg text-xs")],
				[
					`${formatMoney(result.mrrMinor, result.currency)} MRR`,
					...(total === null ? [] : [` · checked against all ${formatCount(total)} accounts`]),
				],
			),
		],
	)
}

// THE EXAMPLE CHART (usage_drop)

const seriesMatches = (result: Result) =>
	result.topMatches.flatMap((match) =>
		match.evidence._tag === "series" ? [{ match, evidence: match.evidence as SeriesEvidence }] : [],
	)

const exampleChart = (h: H, context: PreviewContext, result: Result): ReadonlyArray<Html> => {
	const examples = seriesMatches(result)
	const example =
		examples.find(({ match }) => match.accountId === context.editor.exampleAccountId) ?? examples[0]
	if (example === undefined) return []
	const { evidence } = example
	const values = evidence.series.map((point) => point.value)
	const split = Math.max(0, values.length - evidence.recentDays)
	const days = evidence.series.map((point) => point.day)
	const last = days.at(-1)
	const metric = metricNameOf(context.model)(evidence.metricKey)
	return [
		h.div(
			[h.Class("flex flex-col gap-3 rounded-lg border border-border p-3")],
			[
				h.div(
					[h.Class("flex items-center justify-between gap-2")],
					[
						h.label(
							[h.Class("flex min-w-0 items-center gap-2 text-muted-fg text-xs")],
							[
								"Example",
								h.select(
									[
										h.Class(
											"min-w-0 rounded-md border border-border bg-bg px-1.5 py-0.5 font-medium text-fg text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-ring/70",
										),
										h.OnChange(toExample),
									],
									examples.map(({ match }) =>
										h.option(
											[
												h.Value(match.accountId),
												h.Selected(match.accountId === example.match.accountId),
											],
											[match.name],
										),
									),
								),
							],
						),
						badge(h, { intent: "danger" }, [formatDeltaPct(evidence.changePct)]),
					],
				),
				evidenceBars(h, {
					values,
					highlightFrom: split,
					baseline: evidence.baselineAvg,
					ariaLabel: `${metric} for ${example.match.name}: ${evidence.baselineDays}-day average ${evidence.baselineAvg}, last ${evidence.recentDays} days ${evidence.recentAvg}`,
					className: "h-24",
				}),
				h.div(
					[h.Class("relative h-4 text-muted-fg text-xs")],
					[
						h.span(
							[h.Class("absolute left-0")],
							[days[0] === undefined ? "" : formatDay(days[0])],
						),
						h.span(
							[
								h.Class("absolute -translate-x-1/2"),
								h.Style({ left: `${(split / Math.max(1, values.length)) * 100}%` }),
							],
							[days[split] === undefined ? "" : formatDay(days[split])],
						),
						h.span([h.Class("absolute right-0")], [last === undefined ? "" : formatDay(last)]),
					],
				),
				h.div(
					[h.Class("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs")],
					[
						h.span(
							[h.Class("inline-flex items-center gap-1.5 text-muted-fg")],
							[
								h.span([
									h.AriaHidden(true),
									h.Class("w-4 border-fg-2 border-t border-dashed"),
								]),
								`${evidence.baselineDays}-day avg ${evidence.baselineAvg}`,
							],
						),
						h.span(
							[h.Class("inline-flex items-center gap-1.5 text-muted-fg")],
							[
								h.span([h.AriaHidden(true), h.Class("size-2 rounded-[2px] bg-chart-churn")]),
								`${evidence.recentDays}-day avg ${evidence.recentAvg}`,
							],
						),
					],
				),
				h.p(
					[h.Class("text-muted-fg text-xs")],
					[
						`Daily ${metric.toLowerCase()}. The rule compares averages, so one quiet day doesn't trigger it.`,
					],
				),
			],
		),
	]
}

// MATCHES

const matchRow = (h: H, match: Customers.RuleMatch, currency: string, orgSlug: string): Html =>
	h.li(
		[h.Class("relative flex items-center gap-3 px-1 py-2.5")],
		[
			companyLogo(h, { name: match.name, logoUrl: match.logoUrl, size: "sm" }),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span(
						[h.Class("flex items-baseline justify-between gap-2")],
						[
							h.a(
								[
									h.Href(hrefOf(customerRoute(orgSlug, match.accountId))),
									h.Class("truncate font-medium text-fg text-sm hover:underline"),
								],
								[match.name],
							),
							h.span(
								[h.Class("shrink-0 text-fg-2 text-xs tabular-nums")],
								[formatMoney(match.mrrMinor, currency)],
							),
						],
					),
					h.span([h.Class("truncate text-muted-fg text-xs")], [match.reason]),
				],
			),
			evidenceViz(h, match.evidence, { className: "w-20 shrink-0" }),
		],
	)

const nonMatches = (h: H, result: Result): ReadonlyArray<Html> => {
	const others = result.nonMatches.reduce((sum, entry) => sum + entry.count, 0)
	return others === 0
		? []
		: [
				h.div(
					[h.Class("flex flex-col gap-1.5 border-border border-t pt-3")],
					[
						h.span(
							[h.Class("text-muted-fg text-xs")],
							[`Why the other ${formatCount(others)} don't match`],
						),
						h.ul(
							[h.Class("flex flex-col gap-1")],
							result.nonMatches.map((entry) =>
								h.li(
									[h.Class("flex items-center justify-between gap-2 text-fg-2 text-xs")],
									[
										h.span([], [entry.reason]),
										h.span([h.Class("tabular-nums")], [formatCount(entry.count)]),
									],
								),
							),
						),
					],
				),
			]
}

const resultView = (h: H, context: PreviewContext, result: Result): ReadonlyArray<Html> => [
	...missingSources(h, result, context.orgSlug),
	headline(h, context, result),
	queueEffect(h, context, result),
	...(context.form.template === "usage_drop" ? exampleChart(h, context, result) : []),
	...(result.topMatches.length === 0
		? []
		: [
				h.div(
					[h.Class("flex flex-col")],
					[
						h.div(
							[h.Class("flex items-center justify-between text-muted-fg text-xs")],
							[h.span([], ["Top matches"]), h.span([], ["MRR · evidence"])],
						),
						h.ul(
							[h.Class("divide-y divide-border")],
							result.topMatches.map((match) =>
								matchRow(h, match, result.currency, context.orgSlug),
							),
						),
						...(result.matchCount > result.topMatches.length
							? [
									h.span(
										[h.Class("pt-1 text-muted-fg text-xs")],
										[
											`+${formatCount(result.matchCount - result.topMatches.length)} more`,
										],
									),
								]
							: []),
					],
				),
			]),
	...nonMatches(h, result),
]

const failure = (h: H, reason: Parameters<typeof commonMessage>[0]): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Role("alert"), h.Class("flex flex-col items-start gap-2 py-4")],
		[
			h.span([h.Class("font-medium text-fg text-sm")], ["Couldn't preview this rule"]),
			h.span([h.Class("text-muted-fg text-sm")], [message.description ?? message.title]),
			button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetryPreview() }, [
				"Try again",
			]),
		],
	)
}

export const previewCard = (h: H, context: PreviewContext): Html => {
	const { editor, status } = context
	const body: ReadonlyArray<Html> = Option.isNone(status.draft)
		? [
				h.p(
					[h.Class("py-4 text-muted-fg text-sm")],
					["Fix the highlighted fields to see which accounts match."],
				),
			]
		: AsyncData.match(editor.preview, {
				onIdle: () => [loading(h)],
				onLoading: () => [loading(h)],
				onFailure: (error) => [failure(h, error)],
				onRefreshing: (data) => [
					h.div(
						[h.Class("flex flex-col gap-4 opacity-70 transition-opacity")],
						resultView(h, context, data),
					),
				],
				onStale: ({ data, error }) => [failure(h, error), ...resultView(h, context, data)],
				onSuccess: (data) => resultView(h, context, data),
			})
	return card(
		h,
		{ title: "Live preview", aside: statusLine(h, context), className: "lg:sticky lg:top-6" },
		[...body],
	)
}

const loading = (h: H): Html =>
	h.div(
		[h.Class("flex items-center gap-2 py-6 text-muted-fg text-sm")],
		[loader(h, { className: "size-4", ariaLabel: "Checking every account" }), "Checking every account…"],
	)
