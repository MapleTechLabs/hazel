import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { activeUsersChart } from "../../../customers/charts/line-chart"
import { chartLegend } from "../../../customers/charts/frame"
import { distributionBar, healthDistribution } from "../../../customers/charts/distribution"
import { sparkline } from "../../../customers/charts/sparkline"
import { mrrLegend, mrrMovementChart } from "../../../customers/charts/stacked-bar-chart"
import {
	formatCount,
	formatDate,
	formatDeltaCount,
	formatDeltaPct,
	formatMetricValue,
	formatMoney,
	formatPct,
	formatRelative,
} from "../../../customers/format"
import { type AccountRow, msOf, type SignalRow } from "../../../customers/queries"
import { shownSuggestions, suggestionRow } from "../../../customers/suggestions"
import {
	environmentsHint,
	HEALTH_FILL,
	HEALTH_LABEL,
	healthDot,
	severityGlyph,
} from "../../../customers/ui/badges"
import { environmentCounts } from "../../../customers/groups"
import { connectCard } from "../../../customers/ui/connect-card"
import { companyLogo } from "../../../customers/ui/identity"
import { deltaPill, type Delta } from "../../../customers/ui/kpi-tile"
import { disclosure } from "../../../customers/ui/disclosure"
import { formatResponse, formatWithin } from "../../../customers/support-report"
import { rangePicker } from "../../../customers/ui/filter-bar"
import {
	moreLink,
	pageHeader,
	panel,
	panelClass,
	panelHeader,
	titleClass,
} from "../../../customers/ui/surface"
import { IconArrowPath } from "../../../icons"
import { AppRoute, customerRoute, customersListRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import { switchControl } from "../../../ui/switch"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import {
	isUnconnected,
	type Model,
	newAccounts,
	previousPeriodOf,
	QUIET_AFTER_DAYS,
	quietAccounts,
	openSignals,
	SUGGESTIONS_SHOWN,
} from "./model"
import { heading } from "../../../ui/heading"

/** The Customers overview (Wonder: Overview › default, hover, empty, partial, 12 months). */

type Result = Customers.OverviewResult

const toHoverMrr = (index: number | null) => Message.HoveredChart({ chart: "mrr", index })
const toHoverActiveUsers = (index: number | null) => Message.HoveredChart({ chart: "activeUsers", index })
const toRange = (range: Customers.CustomersRange) => Message.ClickedRange({ range })
const toHealthMetric = (metric: "customers" | "mrr") => Message.ClickedHealthMetric({ metric })
const toCompare = (isComparing: boolean) => Message.ToggledCompare({ isComparing })

interface Context {
	readonly orgSlug: string
	readonly nowMs: number
	readonly accountsById: ReadonlyMap<string, AccountRow>
	/** Each primary's environments: a signal's customer is the primary. */
	readonly environmentCounts: ReadonlyMap<string, number>
}

const link = moreLink
const card = panel

const cardHeader = (h: HtmlBuilder<Message>, title: Html | string, description: string, aside?: Html): Html =>
	panelHeader(h, { title, description, aside })

// HEADER

const header = (h: HtmlBuilder<Message>, model: Model, result: Result | undefined, nowMs: number): Html => {
	const customers = model.accounts?.length ?? 0
	const synced =
		model.settings?.lastComputedAtMs == null
			? null
			: `Synced ${formatRelative(new Date(model.settings.lastComputedAtMs), new Date(nowMs))}`
	const subtitle = isUnconnected(model)
		? "No data sources connected yet"
		: [
				`${result?.hasData.billing === false ? "Usage and health" : "Revenue, usage and health"} across ${formatCount(customers)} customers`,
				...(synced === null ? [] : [synced]),
			].join(" · ")
	const previous = previousPeriodOf(model.range, nowMs)
	return pageHeader(h, {
		title: "Overview",
		subtitle,
		actions: isUnconnected(model)
			? []
			: [
					h.div(
						[h.Class("flex flex-wrap items-center gap-4")],
						[
							switchControl(
								h,
								{
									id: "overview-compare",
									isSelected: model.isComparing,
									onChange: toCompare,
								},
								`Compare to ${formatDate(new Date(previous.startMs), { now: new Date(nowMs) })} – ${formatDate(new Date(previous.endMs), { now: new Date(nowMs) })}`,
							),
							rangePicker(h, { selected: model.range, onSelect: toRange, caption: null }),
						],
					),
				],
	})
}

// HEADLINE

const pctDelta = (model: Model, kpi: Customers.Kpi, goodWhen: "up" | "down" = "up"): Delta | null =>
	!model.isComparing || kpi.deltaPct === null
		? null
		: { value: kpi.deltaPct, text: formatDeltaPct(kpi.deltaPct), goodWhen }

const countDelta = (model: Model, kpi: Customers.Kpi, goodWhen: "up" | "down" = "up"): Delta | null =>
	!model.isComparing || kpi.previous === null
		? null
		: { value: kpi.value - kpi.previous, text: formatDeltaCount(kpi.value - kpi.previous), goodWhen }

const CELL =
	"flex min-w-0 flex-col gap-1 px-5 py-4 max-md:px-4 md:border-l md:border-border md:first:border-l-0"

/** One of the three headline numbers: a label, the number, and one line under it. */
const headlineCell = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		id: string
		label: string
		definition: string
		value: string
		valueClass?: string
		suffix?: string
		delta?: Delta | null
		detail?: string
		footer?: Html
	}>,
): Html =>
	h.div(
		[h.Id(options.id), h.Class(CELL)],
		[
			h.span([h.Class("text-muted-fg text-sm"), h.Title(options.definition)], [options.label]),
			h.span(
				[h.Class("flex min-w-0 items-baseline gap-2")],
				[
					h.span(
						[
							h.Class(
								twMerge(
									"whitespace-nowrap font-semibold text-2xl text-fg tabular-nums tracking-tight",
									options.valueClass,
								),
							),
						],
						[options.value],
					),
					...(options.suffix === undefined
						? []
						: [
								h.span(
									[h.Class("whitespace-nowrap text-muted-fg text-sm tabular-nums")],
									[options.suffix],
								),
							]),
				],
			),
			h.span(
				[h.Class("flex min-w-0 items-center gap-2 text-muted-fg text-xs")],
				[
					...(options.delta == null ? [] : [deltaPill(h, options.delta, "text-xs")]),
					...(options.detail === undefined
						? []
						: [h.span([h.Class("truncate")], [options.detail])]),
				],
			),
			...(options.footer === undefined ? [] : [options.footer]),
		],
	)

/**
 * The three numbers worth reading every day: revenue, the revenue at risk, and who is using the
 * product. The rest of the KPIs follow in one quiet line.
 */
const headline = (
	h: HtmlBuilder<Message>,
	model: Model,
	result: Result | undefined,
	context: Context,
): Html => {
	const strip = (cells: ReadonlyArray<Html>) =>
		h.div(
			[
				h.AriaLabel("Key numbers"),
				h.Role("group"),
				h.Class(
					"grid divide-border rounded-xl border border-border bg-bg max-md:divide-y md:grid-cols-3",
				),
			],
			[...cells],
		)
	if (result === undefined)
		return strip(
			["MRR", "MRR at risk", "Active customers"].map((label) =>
				h.div(
					[h.Key(label), h.Class(CELL)],
					[
						h.span([h.Class("text-muted-fg text-sm")], [label]),
						h.span([h.Class("mt-1 block h-7 w-28 animate-pulse rounded bg-secondary")]),
					],
				),
			),
		)
	const { kpis, currency } = result
	const total = model.accounts?.length ?? 0
	const comparing = model.isComparing ? "vs previous period" : undefined
	const active = headlineCell(h, {
		id: "kpi-active",
		label: "Active customers",
		definition: "Customers with at least one active user in the last 30 days.",
		value: formatCount(kpis.activeCustomers.value),
		suffix: `of ${formatCount(total)}`,
		delta: pctDelta(model, kpis.activeCustomers),
		detail: `${formatCount(kpis.mau.value)} monthly users`,
	})
	if (!result.hasData.billing)
		return strip([
			h.div(
				[h.Class(twMerge(CELL, "md:col-span-2"))],
				[
					h.span([h.Class("text-muted-fg text-sm")], ["MRR · MRR at risk"]),
					h.span([h.Class("font-medium text-fg")], ["Connect Stripe or Autumn to see revenue"]),
					h.span(
						[h.Class("flex flex-wrap items-center gap-x-3 text-muted-fg text-xs")],
						[
							`Subscriptions are matched to your ${formatCount(total)} customers automatically.`,
							link(
								h,
								hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: context.orgSlug })),
								"Connect billing",
							),
						],
					),
				],
			),
			active,
		])
	const atRiskPct = kpis.mrrMinor.value === 0 ? 0 : (kpis.atRiskMrrMinor.value / kpis.mrrMinor.value) * 100
	const risky = result.healthDistribution
		.filter((row) => row.status === "at_risk" || row.status === "critical")
		.reduce((sum, row) => sum + row.count, 0)
	return strip([
		headlineCell(h, {
			id: "kpi-mrr",
			label: "MRR",
			definition:
				"Monthly recurring revenue of every active subscription, plus usage billing averaged over the last 3 months, in the reporting currency.",
			value: formatMoney(kpis.mrrMinor.value, currency),
			delta: pctDelta(model, kpis.mrrMinor),
			detail: comparing,
		}),
		headlineCell(h, {
			id: "kpi-at-risk",
			label: "MRR at risk",
			definition: "MRR of customers with an open high-severity risk signal.",
			value: formatMoney(kpis.atRiskMrrMinor.value, currency),
			valueClass: kpis.atRiskMrrMinor.value > 0 ? "text-warning-subtle-fg" : undefined,
			detail: `${formatPct(atRiskPct, { digits: 0 })} of MRR · ${formatCount(risky)} customers at risk or critical`,
			footer: distributionBar(h, {
				ariaLabel: "MRR by health",
				className: "mt-1.5 h-1.5",
				segments: HEALTH_ORDER.map((status) => ({
					key: status,
					label: HEALTH_LABEL[status],
					value: result.healthDistribution.find((row) => row.status === status)?.mrrMinor ?? 0,
					fillClass: HEALTH_FILL[status],
				})),
			}),
		}),
		active,
	])
}

const HEALTH_ORDER: ReadonlyArray<Customers.HealthStatus> = ["healthy", "at_risk", "critical", "unknown"]

/** Revenue, paying customers and logo churn: worth a glance, not a tile each. */
const secondaryLine = (
	h: HtmlBuilder<Message>,
	model: Model,
	result: Result | undefined,
): ReadonlyArray<Html> => {
	if (result === undefined || !result.hasData.billing) return []
	const { kpis, currency } = result
	const total = model.accounts?.length ?? 0
	const churnBase = kpis.payingCustomers.previous ?? kpis.payingCustomers.value
	const churnPct = churnBase === 0 ? 0 : (kpis.logoChurn.value / churnBase) * 100
	const part = (id: string, label: string, value: string, delta: Delta | null, detail?: string) =>
		h.span(
			[h.Id(id), h.Class("inline-flex items-baseline gap-1.5 whitespace-nowrap")],
			[
				h.span([h.Class("text-muted-fg")], [label]),
				h.span([h.Class("font-medium text-fg tabular-nums")], [value]),
				...(detail === undefined ? [] : [h.span([h.Class("text-muted-fg tabular-nums")], [detail])]),
				...(delta === null ? [] : [deltaPill(h, delta, "self-center text-xs")]),
			],
		)
	return [
		h.p(
			[h.Class("flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-sm")],
			[
				part(
					"kpi-revenue",
					"Revenue",
					formatMoney(kpis.revenueMinor.value, currency),
					pctDelta(model, kpis.revenueMinor),
				),
				part(
					"kpi-paying",
					"Paying customers",
					formatCount(kpis.payingCustomers.value),
					countDelta(model, kpis.payingCustomers),
					`of ${formatCount(total)}`,
				),
				part(
					"kpi-churn",
					"Logo churn",
					formatPct(churnPct),
					countDelta(model, kpis.logoChurn, "down"),
					`${formatCount(kpis.logoChurn.value)} of ${formatCount(churnBase)}`,
				),
			],
		),
	]
}

// NEEDS ATTENTION

/** The queue's top rows: the page's main list. Each row opens the customer. */
const attentionSection = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	userId: string | null,
): Html => {
	const open = openSignals(model)
	const top = open.slice(0, ATTENTION_SHOWN)
	// "Mine" as the queue and the sidebar badge count it: signals on accounts I own.
	const mine = open.filter(
		(signal) => userId !== null && context.accountsById.get(signal.accountId)?.ownerUserId === userId,
	).length
	const row = (signal: SignalRow) => {
		const account = context.accountsById.get(signal.accountId)
		if (account === undefined) return h.empty
		return h.li(
			[h.Key(signal.id)],
			[
				h.a(
					[
						h.Href(hrefOf(customerRoute(context.orgSlug, account.id))),
						h.Class(
							"flex items-center gap-3 px-4 py-3 outline-hidden transition-colors hover:bg-wash focus-visible:bg-wash",
						),
					],
					[
						companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
						h.div(
							[h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
							[
								h.span(
									[h.Class("flex min-w-0 items-baseline gap-2")],
									[
										h.span(
											[h.Class("truncate font-medium text-fg text-sm")],
											[account.name],
										),
										...environmentsHint(
											h,
											context.environmentCounts.get(account.id) ?? 0,
										),
									],
								),
								h.span(
									[h.Class("flex min-w-0 items-center gap-1.5 text-muted-fg text-xs")],
									[
										severityGlyph(h, signal.severity),
										h.span([h.Class("shrink-0 text-fg-2")], [signal.title]),
										h.span([h.Class("truncate")], [`· ${signal.reason}`]),
									],
								),
							],
						),
						h.span(
							[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
							[
								account.mrrMinor > 0
									? `${formatMoney(account.mrrMinor, account.currency)}/mo`
									: "",
							],
						),
					],
				),
			],
		)
	}
	return h.section(
		[h.AriaLabel("Needs attention"), h.Class(twMerge(panelClass, "flex min-w-0 flex-col lg:col-span-2"))],
		[
			h.header(
				[h.Class("flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-2")],
				[
					h.div(
						[h.Class("flex min-w-0 items-baseline gap-2")],
						[
							heading(h, { variant: "section" }, ["Needs attention"]),
							h.span(
								[h.Class("text-muted-fg text-sm tabular-nums")],
								[
									open.length === 0
										? ""
										: `${formatCount(open.length)} open${mine > 0 ? ` · ${formatCount(mine)} on your accounts` : ""}`,
								],
							),
						],
					),
					link(h, hrefOf(AppRoute.CustomersAttention({ orgSlug: context.orgSlug })), "View queue"),
				],
			),
			model.signals === null
				? h.div([h.Class("m-4 h-48 animate-pulse rounded-lg bg-secondary/40")])
				: top.length === 0
					? h.p(
							[h.Class("px-4 py-10 text-center text-muted-fg text-sm")],
							["All clear: no open signals."],
						)
					: h.ul(
							[h.Class("flex flex-col divide-y divide-border border-border border-t")],
							top.map(row),
						),
		],
	)
}

const ATTENTION_SHOWN = 6

// SIDE COLUMN: DROPS AND SUPPORT

/** The customers whose usage fell most, beside the queue: the ones a signal may not have caught yet. */
const dropsCard = (h: HtmlBuilder<Message>, result: Result, context: Context): Html => {
	const drops = result.topMovers.decliners.slice(0, 4)
	return h.section(
		[h.AriaLabel("Biggest usage drops"), h.Class(twMerge(panelClass, "flex min-w-0 flex-col"))],
		[
			h.header(
				[h.Class("flex flex-col gap-0.5 px-4 pt-4 pb-2")],
				[
					heading(h, { variant: "subsection", level: 2 }, ["Biggest usage drops"]),
					h.span(
						[h.Class("text-muted-fg text-xs")],
						[
							result.range === "12m"
								? "Daily active users, last 90 days"
								: "Daily active users, this period",
						],
					),
				],
			),
			drops.length === 0
				? h.p([h.Class("px-4 pb-4 text-muted-fg text-sm")], ["No big drops in this period."])
				: h.ul(
						[h.Class("flex flex-col pb-1.5")],
						drops.map((mover) =>
							h.li(
								[h.Key(mover.accountId)],
								[
									h.a(
										[
											h.Href(hrefOf(customerRoute(context.orgSlug, mover.accountId))),
											h.Class(
												"flex items-center gap-2.5 px-4 py-2 text-sm outline-hidden transition-colors hover:bg-wash focus-visible:bg-wash",
											),
										],
										[
											companyLogo(h, {
												name: mover.name,
												logoUrl: mover.logoUrl,
												size: "xs",
											}),
											h.span(
												[h.Class("min-w-0 flex-1 truncate text-fg")],
												[mover.name],
											),
											deltaPill(
												h,
												{
													value: mover.changePct,
													text: formatDeltaPct(mover.changePct),
												},
												"shrink-0 text-xs",
											),
										],
									),
								],
							),
						),
					),
		],
	)
}

/** First response and breaches for the range, in a small card that opens the Support report. */
const supportCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const href = hrefOf(AppRoute.CustomersSupportReport({ orgSlug: context.orgSlug }))
	const report = Option.getOrUndefined(AsyncData.getData(model.support))
	const failed = report === undefined && AsyncData.getError(model.support)._tag === "Some"
	const stat = (id: string, label: string, value: string, tone?: "danger") =>
		h.div(
			[h.Id(id), h.Class("flex items-baseline justify-between gap-3 py-1 text-sm")],
			[
				h.span([h.Class("text-muted-fg")], [label]),
				h.span(
					[
						h.Class(
							twMerge(
								"font-medium text-fg tabular-nums",
								tone === "danger" && "text-danger-subtle-fg",
							),
						),
					],
					[value],
				),
			],
		)
	return h.section(
		[h.AriaLabel("Support"), h.Class(twMerge(panelClass, "flex min-w-0 flex-col gap-1 px-4 py-4"))],
		[
			h.div(
				[h.Class("flex items-center justify-between gap-4 pb-1")],
				[heading(h, { variant: "subsection", level: 2 }, ["Support"]), link(h, href, "Report")],
			),
			...(report === undefined
				? failed
					? [
							button(
								h,
								{ intent: "plain", size: "xs", onPress: Message.PressedRetrySupport() },
								[
									IconArrowPath(h, { attributes: { "data-slot": "icon" } }),
									"Couldn't load · Retry",
								],
							),
						]
					: [h.div([h.Class("h-20 animate-pulse rounded-lg bg-secondary/40")])]
				: [
						stat(
							"kpi-support-median",
							"Median first response",
							formatResponse(report.firstResponse.medianMs),
						),
						stat(
							"kpi-support-within",
							"Within SLA",
							formatWithin(report.firstResponse.withinPct),
						),
						stat(
							"kpi-support-breaches",
							report.overdueNow > 0
								? `Breaches · ${formatCount(report.overdueNow)} overdue now`
								: "Breaches",
							formatCount(report.breaches),
							report.overdueNow > 0 ? "danger" : undefined,
						),
					]),
		],
	)
}

// CHARTS

const mrrCard = (h: HtmlBuilder<Message>, model: Model, result: Result): Html => {
	if (!result.hasData.billing)
		return card(h, "lg:col-span-2", [
			cardHeader(h, "MRR movement", `New, expansion, contraction and churn by ${result.bucket}`),
			h.div(
				[
					h.Class(
						"flex min-h-56 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border border-dashed px-6 text-center",
					),
				],
				[
					h.span([h.Class(titleClass)], ["Connect Stripe or Autumn to see revenue"]),
					h.span(
						[h.Class("max-w-sm text-muted-fg text-sm")],
						[
							"MRR movement needs subscription history. Hazel backfills 12 months once a billing source connects.",
						],
					),
					h.div(
						[h.Class("flex gap-2")],
						[
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									onPress: Message.PressedConnect({ provider: "autumn" }),
								},
								["Connect Autumn"],
							),
							button(
								h,
								{ size: "sm", onPress: Message.PressedConnect({ provider: "stripe" }) },
								["Connect Stripe"],
							),
						],
					),
				],
			),
		])
	const net = result.mrrMovements.reduce((sum, entry) => sum + entry.net, 0)
	const first = result.mrrMovements[0]
	return card(h, "lg:col-span-2", [
		cardHeader(
			h,
			"MRR movement",
			`${result.bucket === "day" ? "Daily" : result.bucket === "week" ? "Weekly" : "Monthly"} change by type`,
			h.div(
				[h.Class("flex flex-col items-end max-sm:items-start")],
				[
					h.span(
						[
							h.Class(
								twMerge(
									"font-semibold text-sm tabular-nums",
									net >= 0 ? "text-success-subtle-fg" : "text-danger-subtle-fg",
								),
							),
						],
						[`${formatMoney(net, result.currency, { signed: true })} net`],
					),
					...(first === undefined
						? []
						: [
								h.span(
									[h.Class("text-muted-fg text-xs tabular-nums")],
									[
										`${formatMoney(result.kpis.mrrMinor.value - net, result.currency)} → ${formatMoney(result.kpis.mrrMinor.value, result.currency)}`,
									],
								),
							]),
				],
			),
		),
		chartLegend(h, mrrLegend(result.mrrMovements)),
		mrrMovementChart(h, {
			buckets: result.mrrMovements,
			bucket: result.bucket,
			currency: result.currency,
			hoveredIndex: model.hoveredMrr,
			onHover: toHoverMrr,
		}),
	])
}

const activeUsersCard = (h: HtmlBuilder<Message>, model: Model, result: Result): Html => {
	const last = result.activeUsers[result.activeUsers.length - 1]
	const stat = (label: string, value: number, delta: Delta | null, borderClass: string) =>
		h.div(
			[h.Class(twMerge("flex flex-col gap-0.5 border-l-2 pl-3", borderClass))],
			[
				h.span([h.Class("text-muted-fg text-xs")], [label]),
				h.span(
					// A phone's third of the card is narrow: the delta drops under the count.
					[h.Class("flex items-baseline gap-2 max-md:flex-wrap max-md:gap-x-1.5 max-md:gap-y-0")],
					[
						h.span([h.Class("font-semibold text-fg tabular-nums")], [formatCount(value)]),
						...(delta === null ? [] : [deltaPill(h, delta, "text-xs")]),
					],
				),
			],
		)
	return card(h, "", [
		cardHeader(h, "Active users", "Distinct contacts with a sign-in or product event"),
		h.div(
			[h.Class("grid grid-cols-3 gap-3 max-md:gap-2")],
			[
				stat("MAU", result.kpis.mau.value, pctDelta(model, result.kpis.mau), "border-chart-series-3"),
				stat("WAU", result.kpis.wau.value, pctDelta(model, result.kpis.wau), "border-chart-series-2"),
				stat("DAU", last?.dau ?? 0, null, "border-chart-series-1"),
			],
		),
		activeUsersChart(h, {
			points: result.activeUsers,
			bucket: result.bucket,
			hoveredIndex: model.hoveredActiveUsers,
			onHover: toHoverActiveUsers,
		}),
	])
}

// SUGGESTED CHANNEL LINKS

/** Channels that look like a customer's, best first; hidden while there are none. */
const suggestionsCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const shown = shownSuggestions(model.suggestions, model.channelOptions)
	if (shown.length === 0) return h.empty
	const more = shown.length - SUGGESTIONS_SHOWN
	return card(h, "", [
		cardHeader(
			h,
			heading(h, { variant: "section", className: "flex items-baseline gap-2 whitespace-nowrap" }, [
				"Suggested channel links",
				h.span([h.Class("font-normal text-muted-fg text-sm tabular-nums")], [String(shown.length)]),
			]),
			more > 0
				? `Channels that look like a customer's. ${formatCount(more)} more after these.`
				: "Channels that look like a customer's. Linking shows the customer in the channel.",
		),
		h.ul(
			[h.Class("flex flex-col divide-y divide-border"), h.AriaLabel("Suggested channel links")],
			shown.slice(0, SUGGESTIONS_SHOWN).map((entry) =>
				suggestionRow(h, {
					shown: entry,
					showAccount: true,
					accountHref: hrefOf(customerRoute(context.orgSlug, entry.suggestion.accountId)),
					onLink: Message.PressedAcceptSuggestion({ suggestionId: entry.suggestion.id }),
					onDismiss: Message.PressedDismissSuggestion({ suggestionId: entry.suggestion.id }),
				}),
			),
		),
	])
}

// MOVERS AND LISTS

const accountsLabel = (count: number): string => `${formatCount(count)} account${count === 1 ? "" : "s"}`

const moversCard = (h: HtmlBuilder<Message>, result: Result, context: Context): Html => {
	const column = (title: string, movers: ReadonlyArray<Customers.Mover>) =>
		h.div(
			[h.Class("flex min-w-0 flex-col")],
			[
				heading(h, { variant: "subsection", className: "pb-1" }, [title]),
				movers.length === 0
					? h.p([h.Class("py-6 text-muted-fg text-sm")], ["No big moves in this period."])
					: h.ul(
							[h.Class("flex flex-col")],
							movers.map((mover) => {
								const account = context.accountsById.get(mover.accountId)
								const values = mover.series.map((point) => point.value)
								return h.li(
									[],
									[
										h.a(
											[
												h.Href(
													hrefOf(customerRoute(context.orgSlug, mover.accountId)),
												),
												h.Class(
													"-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 outline-hidden transition-colors hover:bg-wash focus-visible:bg-wash",
												),
											],
											[
												companyLogo(h, {
													name: mover.name,
													logoUrl: mover.logoUrl,
													size: "sm",
												}),
												h.div(
													[h.Class("flex min-w-0 flex-1 flex-col")],
													[
														h.span(
															[h.Class("truncate font-medium text-fg text-sm")],
															[mover.name],
														),
														h.span(
															[h.Class("truncate text-muted-fg text-xs")],
															[
																account === undefined
																	? ""
																	: `${account.planName ?? "No plan"} · ${formatMoney(account.mrrMinor, account.currency)}/mo`,
															],
														),
													],
												),
												sparkline(h, {
													values,
													ariaLabel: `${mover.name}: active users`,
													className: "max-sm:hidden",
												}),
												h.span(
													[
														h.Class(
															"w-24 shrink-0 text-right text-muted-fg text-xs tabular-nums max-sm:hidden",
														),
													],
													[
														`${formatMetricValue(mover.previousAvg, null)} → ${formatMetricValue(mover.currentAvg, null)}`,
													],
												),
												deltaPill(
													h,
													{
														value: mover.changePct,
														text: formatDeltaPct(mover.changePct),
													},
													"w-16 shrink-0 justify-end text-sm",
												),
												...(account === undefined
													? []
													: [
															h.span(
																[
																	h.Class(
																		"w-12 shrink-0 text-right max-sm:w-9",
																	),
																],
																[
																	healthDot(h, {
																		status: account.healthStatus,
																		score: account.healthScore,
																	}),
																],
															),
														]),
											],
										),
									],
								)
							}),
						),
			],
		)
	return card(h, "", [
		cardHeader(
			h,
			"Top movers",
			result.range === "12m"
				? "Average daily active users, last 90 days vs the 90 before"
				: "Average daily active users, this period vs the previous one",
		),
		h.div(
			[h.Class("grid gap-6 lg:grid-cols-2")],
			[
				column("Biggest gains", result.topMovers.gainers),
				column("Biggest drops", result.topMovers.decliners),
			],
		),
	])
}

const listRow = (
	h: HtmlBuilder<Message>,
	context: Context,
	entry: Readonly<{
		accountId: AccountRow["id"]
		name: string
		logoUrl: string | null
		detail: string
		date: number
		value: Html | string
	}>,
): Html =>
	h.li(
		[],
		[
			h.a(
				[
					h.Href(hrefOf(customerRoute(context.orgSlug, entry.accountId))),
					h.Class(
						"-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm outline-hidden transition-colors hover:bg-wash focus-visible:bg-wash",
					),
				],
				[
					companyLogo(h, { name: entry.name, logoUrl: entry.logoUrl, size: "xs" }),
					h.span([h.Class("min-w-0 truncate font-medium text-fg")], [entry.name]),
					// A phone keeps the name readable; the plan is on the account.
					h.span(
						[h.Class("min-w-0 shrink-[2] truncate text-muted-fg text-xs max-sm:hidden")],
						[entry.detail],
					),
					h.span(
						[h.Class("ml-auto shrink-0 text-muted-fg text-xs tabular-nums")],
						[formatDate(new Date(entry.date), { now: new Date(context.nowMs) })],
					),
					h.span(
						[h.Class("w-20 shrink-0 text-right tabular-nums max-sm:w-auto max-sm:min-w-12")],
						[entry.value],
					),
				],
			),
		],
	)

// THIS PERIOD

const LIFECYCLE_SHOWN = 4

/** One column of the This period panel: a title, a one-line summary, a few rows and a way to all of them. */
const lifecycleColumn = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		title: string
		summary: string
		aside: Html
		rows: ReadonlyArray<Html>
		empty: string
	}>,
): Html =>
	h.div(
		[h.Class("flex min-w-0 flex-col gap-1 px-4 py-4 sm:px-5")],
		[
			h.div(
				[h.Class("flex items-center justify-between gap-3")],
				[heading(h, { variant: "subsection", level: 3 }, [options.title]), options.aside],
			),
			h.span([h.Class("text-muted-fg text-xs")], [options.summary]),
			options.rows.length === 0
				? h.p([h.Class("py-4 text-muted-fg text-sm")], [options.empty])
				: h.ul([h.Class("flex flex-col pt-1")], options.rows.slice(0, LIFECYCLE_SHOWN)),
		],
	)

/** A trial's subscription that went on to bill (anything but still trialing, paused or canceled). */
const isConverted = (status: Customers.SubscriptionStatus) =>
	status === "active" || status === "past_due" || status === "unpaid"

/** Who arrived, who is trying it and who left in the range: one panel, three columns. */
const lifecycleSection = (h: HtmlBuilder<Message>, model: Model, result: Result, context: Context): Html => {
	const panelOf = (columns: ReadonlyArray<Html>) =>
		h.section(
			[h.AriaLabel("This period"), h.Class("flex min-w-0 flex-col gap-2.5")],
			[
				heading(h, { variant: "section" }, ["This period"]),
				h.div(
					[
						h.Class(
							twMerge(
								panelClass,
								"grid divide-border max-lg:divide-y lg:divide-x",
								columns.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
							),
						),
					],
					[...columns],
				),
			],
		)
	if (!result.hasData.billing) {
		const fresh = newAccounts(model, context.nowMs, LIFECYCLE_SHOWN)
		const quiet = quietAccounts(model, context.nowMs, LIFECYCLE_SHOWN)
		return panelOf([
			lifecycleColumn(h, {
				title: "New accounts",
				summary: "First seen in this period",
				aside: link(h, hrefOf(customersListRoute(context.orgSlug)), "View all"),
				rows: fresh.map((account) =>
					listRow(h, context, {
						accountId: account.id,
						name: account.name,
						logoUrl: account.logoUrl,
						detail: account.domain ?? "",
						date: account.firstSeenAtMs,
						value: `${formatCount(account.activeUsers30d)} of ${formatCount(account.contactCount)}`,
					}),
				),
				empty: "No new accounts in this period.",
			}),
			lifecycleColumn(h, {
				title: "Went quiet",
				summary: `No activity for ${QUIET_AFTER_DAYS}+ days after being active. Churn needs billing data.`,
				aside: link(
					h,
					hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: context.orgSlug })),
					"Connect billing",
				),
				rows: quiet.map((account) =>
					listRow(h, context, {
						accountId: account.id,
						name: account.name,
						logoUrl: account.logoUrl,
						detail: `${formatCount(account.activeUsers30d)} active users`,
						date: account.lastActiveAtMs ?? context.nowMs,
						value: h.span(
							[h.Class("text-warning-subtle-fg")],
							[
								`${Math.floor((context.nowMs - (account.lastActiveAtMs ?? context.nowMs)) / 86_400_000)}d`,
							],
						),
					}),
				),
				empty: "Nobody went quiet.",
			}),
		])
	}
	const brief = (entry: Customers.AccountBrief, value: Html | string) =>
		listRow(h, context, {
			accountId: entry.accountId,
			name: entry.name,
			logoUrl: entry.logoUrl,
			detail: entry.planName ?? "",
			date: msOf(entry.at),
			value,
		})
	const newMrr = result.recentNew.reduce((sum, entry) => sum + entry.mrrMinor, 0)
	const lostMrr = result.recentChurn.reduce((sum, entry) => sum + entry.mrrMinor, 0)
	const converted = result.newTrials.filter((trial) => isConverted(trial.status)).length
	return panelOf([
		lifecycleColumn(h, {
			title: "New customers",
			summary: `${accountsLabel(result.recentNew.length)} · ${formatMoney(newMrr, result.currency, { signed: true })} MRR`,
			aside: link(h, hrefOf(customersListRoute(context.orgSlug, "paying")), "View all"),
			rows: result.recentNew.map((entry) => brief(entry, formatMoney(entry.mrrMinor, result.currency))),
			empty: "No new paying customers.",
		}),
		lifecycleColumn(h, {
			title: "New trials",
			summary: `${accountsLabel(result.newTrials.length)} · ${formatCount(converted)} converted`,
			aside: link(h, hrefOf(customersListRoute(context.orgSlug, "trialing")), "View all"),
			rows: result.newTrials.map((trial) =>
				brief(
					trial,
					trial.status === "trialing"
						? formatMoney(trial.mrrMinor, result.currency)
						: isConverted(trial.status)
							? h.span([h.Class("text-success-subtle-fg")], ["Converted"])
							: h.span([h.Class("text-muted-fg")], ["Ended"]),
				),
			),
			empty: "No trials started.",
		}),
		lifecycleColumn(h, {
			title: "Churned",
			summary: `${accountsLabel(result.recentChurn.length)}${lostMrr > 0 ? ` · ${formatMoney(-lostMrr, result.currency)} MRR` : ""}`,
			aside: link(h, hrefOf(customersListRoute(context.orgSlug, "churned")), "View all"),
			rows: result.recentChurn.map((entry) =>
				brief(
					entry,
					entry.mrrMinor > 0
						? h.span(
								[h.Class("text-danger-subtle-fg")],
								[formatMoney(-entry.mrrMinor, result.currency)],
							)
						: h.span([h.Class("text-muted-fg")], ["—"]),
				),
			),
			empty: "Nobody churned.",
		}),
	])
}

// TRENDS

/** The charts, folded: worth opening on a review, not on every visit. */
const trendsSection = (h: HtmlBuilder<Message>, model: Model, result: Result, context: Context): Html => {
	const bands = model.settings?.bands ?? Customers.DEFAULT_HEALTH_SETTINGS.bands
	return h.section(
		[h.AriaLabel("Charts and trends")],
		[
			disclosure(
				h,
				{
					summaryClassName: "py-1 text-sm",
					summary: [
						h.span([h.Class("font-medium text-fg")], ["Charts and trends"]),
						h.span(
							[h.Class("text-muted-fg text-xs max-sm:hidden")],
							["MRR movement, active users, health distribution, top movers"],
						),
					],
				},
				[
					h.div(
						[h.Class("flex flex-col gap-4 pt-3")],
						[
							mrrCard(h, model, result),
							h.div(
								[h.Class("grid gap-4 lg:grid-cols-2")],
								[
									activeUsersCard(h, model, result),
									healthDistribution(h, {
										rows: result.healthDistribution,
										bands,
										currency: result.currency,
										metric: model.healthMetric,
										onMetric: toHealthMetric,
									}),
								],
							),
							moversCard(h, result, context),
						],
					),
				],
			),
		],
	)
}

// STATES

const PROVIDERS: ReadonlyArray<Customers.CustomerProvider> = ["clerk", "stripe", "autumn", "maple"]

/** What each source brings, in a line: how it matches records is the Sources settings' to explain. */
const SETUP_SUMMARY = {
	clerk: "Your customer list: accounts and their contacts.",
	stripe: "Subscriptions, invoices and MRR.",
	autumn: "Plans, metered features and limits.",
	maple: "Product usage and active users.",
} as const satisfies Record<Customers.CustomerProvider, string>

const setup = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	h.div(
		[h.Class("flex flex-col gap-6")],
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					heading(h, { variant: "title" }, ["Connect a data source"]),
					h.p(
						[h.Class("max-w-2xl text-muted-fg text-sm")],
						["Start with Clerk for your customer list, then add billing and usage."],
					),
				],
			),
			h.div(
				[h.Class("grid gap-4 md:grid-cols-2")],
				PROVIDERS.map((provider) =>
					connectCard(h, {
						provider,
						description: SETUP_SUMMARY[provider],
						now: new Date(nowMs),
						status: { _tag: "NotConnected", onConnect: Message.PressedConnect({ provider }) },
						className: provider === "clerk" ? "border-primary" : undefined,
					}),
				),
			),
		],
	)

const failure = (h: HtmlBuilder<Message>, reason: Parameters<typeof commonMessage>[0]): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Class(twMerge("flex flex-col items-center gap-3 px-6 py-14 text-center", panelClass))],
		[
			h.span([h.Class(titleClass)], [message.title]),
			...(message.description
				? [h.span([h.Class("text-muted-fg text-sm")], [message.description])]
				: []),
			button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetry() }, [
				IconArrowPath(h, { attributes: { "data-slot": "icon" } }),
				"Try again",
			]),
		],
	)
}

const dashboard = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	userId: string | null,
): ReadonlyArray<Html> => {
	const result = Option.getOrUndefined(AsyncData.getData(model.overview))
	const failed = AsyncData.getError(model.overview)
	if (result === undefined && failed._tag === "Some") return [failure(h, failed.value)]
	return [
		h.div(
			[h.Class("flex flex-col gap-3")],
			[headline(h, model, result, context), ...secondaryLine(h, model, result)],
		),
		h.div(
			[h.Class("grid items-start gap-4 lg:grid-cols-3")],
			[
				attentionSection(h, model, context, userId),
				h.div(
					[h.Class("flex min-w-0 flex-col gap-4")],
					[
						...(result === undefined ? [] : [dropsCard(h, result, context)]),
						supportCard(h, model, context),
					],
				),
			],
		),
		suggestionsCard(h, model, context),
		...(result === undefined
			? [h.div([h.Class("h-64 animate-pulse rounded-xl border border-border bg-secondary/30")])]
			: [lifecycleSection(h, model, result, context), trendsSection(h, model, result, context)]),
	]
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const orgSlug = shared.orgSlug ?? ""
	const context: Context = {
		orgSlug,
		nowMs: shared.nowMs,
		accountsById: new Map((model.accounts ?? []).map((account) => [account.id, account])),
		environmentCounts: environmentCounts(model.accounts ?? []),
	}
	const result = Option.getOrUndefined(AsyncData.getData(model.overview))
	return h.div(
		[h.Class("h-full overflow-y-auto")],
		[
			h.div(
				[h.Class("mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-8")],
				[
					// On a phone the top bar names the section; with nothing connected the header holds no
					// controls, only its title and a subtitle the setup below says again.
					...(shared.isMobile && isUnconnected(model)
						? []
						: [header(h, model, result, shared.nowMs)]),
					...(isUnconnected(model)
						? [setup(h, shared.nowMs)]
						: dashboard(h, model, context, shared.currentUser?.id ?? null)),
				],
			),
		],
	)
})
