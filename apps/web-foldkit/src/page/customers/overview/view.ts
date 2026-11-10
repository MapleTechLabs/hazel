import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { activeUsersChart } from "../../../customers/charts/line-chart"
import { chartLegend } from "../../../customers/charts/frame"
import { healthDistribution } from "../../../customers/charts/distribution"
import { sparkline } from "../../../customers/charts/sparkline"
import { mrrLegend, mrrMovementChart } from "../../../customers/charts/stacked-bar-chart"
import {
	formatCount,
	formatDate,
	formatDeltaCount,
	formatDeltaPct,
	formatDeltaPoints,
	formatMoney,
	formatPct,
	formatRelative,
} from "../../../customers/format"
import { type AccountRow, msOf, type SignalRow } from "../../../customers/queries"
import { healthDot, severityGlyph } from "../../../customers/ui/badges"
import { connectCard } from "../../../customers/ui/connect-card"
import { companyLogo } from "../../../customers/ui/identity"
import { deltaPill, type Delta, kpiTile } from "../../../customers/ui/kpi-tile"
import { rangePicker } from "../../../customers/ui/filter-bar"
import { IconArrowPath, IconChevronRight } from "../../../icons"
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
	topOpenSignals,
} from "./model"

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
}

const link = (h: HtmlBuilder<Message>, href: string, label: string): Html =>
	h.a(
		[
			h.Href(href),
			h.Class(
				"inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-primary text-sm hover:underline",
			),
		],
		[label, IconChevronRight(h, { className: "size-3.5" })],
	)

const card = (h: HtmlBuilder<Message>, className: string, children: ReadonlyArray<Html>): Html =>
	h.section(
		[
			h.Class(
				twMerge(
					"flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5",
					className,
				),
			),
		],
		[...children],
	)

const cardHeader = (h: HtmlBuilder<Message>, title: Html | string, description: string, aside?: Html): Html =>
	h.header(
		[h.Class("flex items-start justify-between gap-4")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					typeof title === "string"
						? h.h2([h.Class("font-semibold text-base/6 text-fg")], [title])
						: title,
					h.p([h.Class("text-muted-fg text-sm")], [description]),
				],
			),
			...(aside ? [aside] : []),
		],
	)

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
	return h.div(
		[h.Class("flex flex-wrap items-start justify-between gap-4")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col gap-1")],
				[
					h.h1([h.Class("font-semibold text-2xl text-fg")], ["Overview"]),
					h.p([h.Class("text-muted-fg text-sm")], [subtitle]),
				],
			),
			...(isUnconnected(model)
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
					]),
		],
	)
}

// KPIS

const kpiDelta = (
	model: Model,
	kpi: Customers.Kpi,
	format: (value: number) => string,
	goodWhen: "up" | "down" = "up",
): Delta | null =>
	!model.isComparing || kpi.previous === null
		? null
		: { value: kpi.value - kpi.previous, text: format(kpi.value - kpi.previous), goodWhen }

const pctDelta = (model: Model, kpi: Customers.Kpi, goodWhen: "up" | "down" = "up"): Delta | null =>
	!model.isComparing || kpi.deltaPct === null
		? null
		: { value: kpi.deltaPct, text: formatDeltaPct(kpi.deltaPct), goodWhen }

const loadingTiles = (h: HtmlBuilder<Message>, labels: ReadonlyArray<string>): ReadonlyArray<Html> =>
	labels.map((label) => kpiTile(h, { id: `kpi-${label}`, label, state: "loading" }))

const kpiRow = (
	h: HtmlBuilder<Message>,
	model: Model,
	result: Result | undefined,
	context: Context,
): Html => {
	const grid = (tiles: ReadonlyArray<Html>) =>
		h.div([h.Class("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6")], [...tiles])
	if (result === undefined)
		return grid(
			loadingTiles(h, [
				"MRR",
				"Paying customers",
				"Logo churn",
				"At-risk MRR",
				"Active customers",
				"Stickiness",
			]),
		)
	const { kpis, currency } = result
	const comparison = model.isComparing ? "vs prev" : undefined
	const total = model.accounts?.length ?? 0
	const usage = [
		kpiTile(h, {
			id: "kpi-active",
			label: "Active customers",
			definition: "Customers with at least one active user in the last 30 days.",
			value: formatCount(kpis.activeCustomers.value),
			detail: `of ${formatCount(total)}`,
			delta: pctDelta(model, kpis.activeCustomers),
			comparison,
		}),
		kpiTile(h, {
			id: "kpi-stickiness",
			label: "Stickiness",
			definition: "Weekly active users divided by monthly active users.",
			value: formatPct(kpis.stickinessPct.value, { digits: 0 }),
			detail: `${formatCount(kpis.wau.value)} / ${formatCount(kpis.mau.value)}`,
			delta: kpiDelta(model, kpis.stickinessPct, (value) => formatDeltaPoints(value)),
			comparison: "WAU ÷ MAU",
		}),
	]
	if (!result.hasData.billing)
		return grid([
			h.div(
				[
					h.Class(
						"col-span-2 flex items-center justify-between gap-4 rounded-xl border border-border p-4 md:col-span-3 xl:col-span-4",
					),
				],
				[
					h.div(
						[h.Class("flex flex-col gap-0.5")],
						[
							h.span(
								[h.Class("text-muted-fg text-xs")],
								["MRR · Paying customers · Logo churn · At-risk MRR"],
							),
							h.span(
								[h.Class("font-medium text-fg text-sm")],
								["Connect Stripe or Autumn to see revenue"],
							),
							h.span(
								[h.Class("text-muted-fg text-xs")],
								[
									`Subscriptions are matched to your ${formatCount(total)} customers automatically.`,
								],
							),
						],
					),
					link(
						h,
						hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: context.orgSlug })),
						"Connect billing",
					),
				],
			),
			...usage,
		])
	const churnBase = kpis.payingCustomers.previous ?? kpis.payingCustomers.value
	const churnPct = churnBase === 0 ? 0 : (kpis.logoChurn.value / churnBase) * 100
	const atRiskPct = kpis.mrrMinor.value === 0 ? 0 : (kpis.atRiskMrrMinor.value / kpis.mrrMinor.value) * 100
	return grid([
		kpiTile(h, {
			id: "kpi-mrr",
			label: "MRR",
			definition: "Monthly recurring revenue of every active subscription, in the reporting currency.",
			value: formatMoney(kpis.mrrMinor.value, currency),
			delta: pctDelta(model, kpis.mrrMinor),
			comparison,
		}),
		kpiTile(h, {
			id: "kpi-paying",
			label: "Paying customers",
			definition: "Customers with MRR above zero.",
			value: formatCount(kpis.payingCustomers.value),
			detail: `of ${formatCount(total)}`,
			delta: kpiDelta(model, kpis.payingCustomers, formatDeltaCount),
			comparison,
		}),
		kpiTile(h, {
			id: "kpi-churn",
			label: "Logo churn",
			definition: "Paying customers lost in the period, as a share of those paying at its start.",
			value: formatPct(churnPct),
			detail: `${formatCount(kpis.logoChurn.value)} of ${formatCount(churnBase)}`,
			delta: kpiDelta(model, kpis.logoChurn, formatDeltaCount, "down"),
			comparison,
		}),
		kpiTile(h, {
			id: "kpi-at-risk",
			label: "At-risk MRR",
			definition: "MRR of customers with an open high-severity risk signal.",
			value: formatMoney(kpis.atRiskMrrMinor.value, currency),
			detail: formatPct(atRiskPct, { digits: 0 }),
			delta: kpiDelta(
				model,
				kpis.atRiskMrrMinor,
				(value) => formatMoney(value, currency, { signed: true }),
				"down",
			),
			comparison,
		}),
		...usage,
	])
}

// CHARTS

const mrrCard = (h: HtmlBuilder<Message>, model: Model, result: Result): Html => {
	if (!result.hasData.billing)
		return card(h, "lg:col-span-2", [
			cardHeader(h, "MRR movement", `New, expansion, contraction and churn by ${result.bucket}`),
			h.div(
				[
					h.Class(
						"flex h-56 flex-col items-center justify-center gap-3 rounded-lg border border-border border-dashed px-6 text-center",
					),
				],
				[
					h.span([h.Class("font-medium text-fg")], ["Connect Stripe or Autumn to see revenue"]),
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
				[h.Class("flex flex-col items-end")],
				[
					h.span(
						[
							h.Class(
								twMerge(
									"font-semibold text-sm tabular-nums",
									net >= 0 ? "text-success" : "text-danger",
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
					[h.Class("flex items-baseline gap-2")],
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
			[h.Class("grid grid-cols-3 gap-3")],
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

// QUEUE PREVIEW

const attentionCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	userId: string | null,
): Html => {
	const open = (model.signals ?? []).filter((signal) => signal.status === "open")
	const top = topOpenSignals(model, 5)
	const risks = open.filter((signal) => signal.kind === "risk").length
	// "Mine" as the queue and the sidebar badge count it: signals on accounts I own.
	const mine = open.filter(
		(signal) => userId !== null && context.accountsById.get(signal.accountId)?.ownerUserId === userId,
	).length
	const row = (signal: SignalRow) => {
		const account = context.accountsById.get(signal.accountId)
		if (account === undefined) return h.empty
		return h.li(
			[],
			[
				h.a(
					[
						h.Href(hrefOf(customerRoute(context.orgSlug, account.id))),
						h.Class("flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-wash"),
					],
					[
						companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
						h.div(
							[h.Class("flex min-w-0 flex-1 flex-col")],
							[
								h.span(
									[h.Class("flex items-center justify-between gap-2")],
									[
										h.span(
											[h.Class("truncate font-medium text-fg text-sm")],
											[account.name],
										),
										h.span(
											[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
											[`${formatMoney(account.mrrMinor, account.currency)}/mo`],
										),
									],
								),
								h.span(
									[h.Class("flex items-center gap-1.5 text-muted-fg text-xs")],
									[
										severityGlyph(h, signal.severity),
										h.span([h.Class("truncate")], [`${signal.title} · ${signal.reason}`]),
									],
								),
							],
						),
					],
				),
			],
		)
	}
	return card(h, "", [
		cardHeader(
			h,
			h.h2(
				[h.Class("flex items-center gap-2 font-semibold text-base/6 text-fg")],
				[
					"Needs attention",
					h.span(
						[h.Class("rounded-full bg-primary-subtle px-2 text-primary-subtle-fg text-xs")],
						[`${open.length} open`],
					),
				],
			),
			"Top 5 by priority",
			link(h, hrefOf(AppRoute.CustomersAttention({ orgSlug: context.orgSlug })), "View queue"),
		),
		model.signals === null
			? h.div([h.Class("h-48 animate-pulse rounded-lg bg-secondary/40")])
			: top.length === 0
				? h.p([h.Class("py-8 text-center text-muted-fg text-sm")], ["All clear: no open signals."])
				: h.ul([h.Class("flex flex-col")], top.map(row)),
		h.footer(
			[
				h.Class(
					"mt-auto flex items-center justify-between border-border border-t pt-3 text-muted-fg text-xs",
				),
			],
			[
				h.span(
					[],
					[
						`${risks} risk${risks === 1 ? "" : "s"} · ${open.length - risks} opportunit${open.length - risks === 1 ? "y" : "ies"}`,
					],
				),
				h.span([], [`${mine} on your accounts`]),
			],
		),
	])
}

// MOVERS AND LISTS

const moversCard = (h: HtmlBuilder<Message>, result: Result, context: Context): Html => {
	const column = (title: string, movers: ReadonlyArray<Customers.Mover>) =>
		h.div(
			[h.Class("flex min-w-0 flex-col")],
			[
				h.h3([h.Class("pb-2 text-muted-fg text-sm")], [title]),
				movers.length === 0
					? h.p([h.Class("py-6 text-muted-fg text-sm")], ["No big moves in this period."])
					: h.ul(
							[h.Class("divide-y divide-border")],
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
												h.Class("flex items-center gap-3 py-2.5 hover:bg-wash"),
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
															"w-20 text-right text-muted-fg text-xs tabular-nums",
														),
													],
													[
														`${formatCount(values[0] ?? 0)} → ${formatCount(values[values.length - 1] ?? 0)}`,
													],
												),
												deltaPill(
													h,
													{
														value: mover.changePct,
														text: formatDeltaPct(mover.changePct),
													},
													"w-16 justify-end text-sm",
												),
												...(account === undefined
													? []
													: [
															h.span(
																[h.Class("w-12 text-right")],
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
		cardHeader(h, "Top movers", "Active users, this period vs the previous one"),
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
					h.Class("flex items-center gap-3 py-2.5 text-sm hover:bg-wash"),
				],
				[
					companyLogo(h, { name: entry.name, logoUrl: entry.logoUrl, size: "xs" }),
					h.span([h.Class("truncate font-medium text-fg")], [entry.name]),
					h.span([h.Class("truncate text-muted-fg text-xs")], [entry.detail]),
					h.span(
						[h.Class("ml-auto shrink-0 text-muted-fg text-xs tabular-nums")],
						[formatDate(new Date(entry.date), { now: new Date(context.nowMs) })],
					),
					h.span([h.Class("w-20 shrink-0 text-right tabular-nums")], [entry.value]),
				],
			),
		],
	)

const listCard = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		title: string
		description: string
		aside: Html
		rows: ReadonlyArray<Html>
		empty: string
	}>,
): Html =>
	card(h, "", [
		cardHeader(h, options.title, options.description, options.aside),
		options.rows.length === 0
			? h.p([h.Class("py-6 text-center text-muted-fg text-sm")], [options.empty])
			: h.ul([h.Class("divide-y divide-border")], [...options.rows]),
	])

const lifecycleRow = (h: HtmlBuilder<Message>, model: Model, result: Result, context: Context): Html => {
	if (!result.hasData.billing) {
		const fresh = newAccounts(model, context.nowMs, 5)
		const quiet = quietAccounts(model, context.nowMs, 5)
		return h.div(
			[h.Class("grid gap-4 lg:grid-cols-2")],
			[
				listCard(h, {
					title: "New accounts",
					description: "First seen in this period",
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
				listCard(h, {
					title: "Went quiet",
					description: `No activity for ${QUIET_AFTER_DAYS}+ days after being active. Churn needs billing data.`,
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
								[h.Class("text-warning")],
								[
									`${Math.floor((context.nowMs - (account.lastActiveAtMs ?? context.nowMs)) / 86_400_000)}d`,
								],
							),
						}),
					),
					empty: "Nobody went quiet.",
				}),
			],
		)
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
	return h.div(
		[h.Class("grid gap-4 lg:grid-cols-2")],
		[
			listCard(h, {
				title: "New customers",
				description: `${formatCount(result.recentNew.length)} accounts · ${formatMoney(newMrr, result.currency, { signed: true })} MRR · first paid invoice in period`,
				aside: link(h, hrefOf(customersListRoute(context.orgSlug, "paying")), "View all"),
				rows: result.recentNew.map((entry) =>
					brief(entry, formatMoney(entry.mrrMinor, result.currency)),
				),
				empty: "No new paying customers in this period.",
			}),
			listCard(h, {
				title: "Recent churn",
				description: `${formatCount(result.recentChurn.length)} accounts${lostMrr > 0 ? ` · ${formatMoney(-lostMrr, result.currency)} MRR` : ""}`,
				aside: link(h, hrefOf(customersListRoute(context.orgSlug, "churned")), "View churned"),
				rows: result.recentChurn.map((entry) =>
					brief(
						entry,
						entry.mrrMinor > 0
							? h.span(
									[h.Class("text-danger")],
									[formatMoney(-entry.mrrMinor, result.currency)],
								)
							: h.span([h.Class("text-muted-fg")], ["—"]),
					),
				),
				empty: "Nobody churned in this period.",
			}),
		],
	)
}

// STATES

const PROVIDERS: ReadonlyArray<Customers.CustomerProvider> = ["clerk", "stripe", "autumn", "maple"]

const setup = (h: HtmlBuilder<Message>, nowMs: number): Html =>
	h.div(
		[h.Class("flex flex-col gap-6")],
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.span(
						[h.Class("font-medium text-primary text-xs uppercase tracking-wider")],
						["Set up customers"],
					),
					h.h2(
						[h.Class("font-semibold text-fg text-lg")],
						["Connect a source to see how your customers are doing"],
					),
					h.p(
						[h.Class("max-w-2xl text-muted-fg text-sm")],
						[
							"Hazel merges records from every source into one customer per company. Start with Clerk to create your customer list, then add billing and product usage.",
						],
					),
				],
			),
			h.div(
				[h.Class("grid gap-4 md:grid-cols-2")],
				PROVIDERS.map((provider) =>
					connectCard(h, {
						provider,
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
		[h.Class("flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-14 text-center")],
		[
			h.span([h.Class("font-medium text-fg")], [message.title]),
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
	const bands = model.settings?.bands ?? Customers.DEFAULT_HEALTH_SETTINGS.bands
	return [
		kpiRow(h, model, result, context),
		...(result === undefined
			? [h.div([h.Class("h-96 animate-pulse rounded-xl border border-border bg-secondary/30")])]
			: [
					h.div(
						[h.Class("grid gap-4 lg:grid-cols-3")],
						[mrrCard(h, model, result), attentionCard(h, model, context, userId)],
					),
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
					lifecycleRow(h, model, result, context),
				]),
	]
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const orgSlug = shared.orgSlug ?? ""
	const context: Context = {
		orgSlug,
		nowMs: shared.nowMs,
		accountsById: new Map((model.accounts ?? []).map((account) => [account.id, account])),
	}
	const result = Option.getOrUndefined(AsyncData.getData(model.overview))
	return h.div(
		[h.Class("h-full overflow-y-auto")],
		[
			h.div(
				[h.Class("mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8")],
				[
					header(h, model, result, shared.nowMs),
					...(isUnconnected(model)
						? [setup(h, shared.nowMs)]
						: dashboard(h, model, context, shared.currentUser?.id ?? null)),
				],
			),
		],
	)
})
