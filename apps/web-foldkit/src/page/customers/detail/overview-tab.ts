import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { RANGE_COMPARISON, rangePicker } from "../../../customers/ui/filter-bar"
import { meter } from "../../../customers/charts/sparkline"
import { chartCard } from "../../../customers/charts/frame"
import { stackedBarChart } from "../../../customers/charts/stacked-bar-chart"
import {
	formatCompact,
	formatCount,
	formatDate,
	formatDay,
	formatDayLong,
	formatDeltaPct,
	formatMetricValue,
	formatMoney,
	formatRelative,
} from "../../../customers/format"
import { msOf, type SignalRow } from "../../../customers/queries"
import { severityChip } from "../../../customers/ui/badges"
import { evidenceViz } from "../../../customers/ui/evidence"
import { healthBreakdown } from "../../../customers/ui/health-breakdown"
import { personLabel, sourceMark } from "../../../customers/ui/identity"
import { snoozeMenuContent } from "../../../customers/ui/menus"
import { queueAction } from "../../../customers/ui/queue-row"
import { markdownView } from "../../../chat/markdown/markdown-view"
import { IconCheck, IconChevronDown, IconChevronRight, IconClock, IconDots } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import { menuLabel } from "../../../ui/menu-view"
import { Message } from "./message"
import {
	ASSIGN_ME,
	DISMISS,
	doneEntries,
	metricEntries,
	type Model,
	OPEN_QUEUE,
	openSignals,
	snoozeEntries,
	signalMoreEntries,
	sortedNotes,
	UNASSIGN,
} from "./model"
import { card, type Context, headerLink, icon, memberOf, menu } from "./parts"

/** The overview tab: KPIs, usage, why the health score, open signals, subscription, pinned notes, activity. */

const DAY_MS = 86_400_000

// KPIS

const kpis = (h: HtmlBuilder<Message>, context: Context): Html => {
	const { account } = context
	const trend = account.activeUsersTrendPct
	const lastActiveName =
		context.detail?.contactsToReach.find(
			(row) => row.contact.id === context.detail?.account.lastActiveContactId,
		)?.contact.name ?? null
	return h.div(
		[h.Class("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5")],
		[
			kpiTile(
				{ h, id: "active-users", label: "Active users, 30d" },
				{
					value: formatCount(account.activeUsers30d),
					detail: `of ${formatCount(account.contactCount)}`,
				},
			),
			kpiTile(
				{ h, id: "usage-trend", label: "Usage trend" },
				{
					value: trend === null ? "—" : formatDeltaPct(Math.round(trend)),
					detail: "7d vs prior 28d",
					valueClass:
						trend === null || Math.abs(trend) < 5
							? undefined
							: trend < 0
								? "text-danger-subtle-fg"
								: "text-success-subtle-fg",
				},
			),
			kpiTile(
				{ h, id: "mrr", label: "MRR" },
				{
					value: formatMoney(account.mrrMinor, account.currency),
					detail: account.planName ?? undefined,
				},
			),
			kpiTile(
				{ h, id: "seats", label: "Seats used" },
				{
					value: account.seatsUsed === null ? "—" : formatCount(account.seatsUsed),
					detail: account.seatsLimit === null ? undefined : `/ ${formatCount(account.seatsLimit)}`,
					footer:
						account.seatsUsed === null || account.seatsLimit === null
							? undefined
							: meter(h, {
									value: account.seatsUsed,
									limit: account.seatsLimit,
									ariaLabel: "Seats used of the plan's seats",
								}),
				},
			),
			kpiTile(
				{ h, id: "last-active", label: "Last active" },
				{
					value:
						account.lastActiveAtMs === null
							? "Never"
							: formatRelative(new Date(account.lastActiveAtMs), new Date(context.nowMs)),
					detail: lastActiveName ?? undefined,
				},
			),
		],
	)
}

/** A compact tile (the kit's `kpiTile` is sized for the overview's KPI row). */
const kpiTile = (
	base: Readonly<{ h: HtmlBuilder<Message>; id: string; label: string }>,
	options: Readonly<{
		value: string
		detail?: string | undefined
		valueClass?: string | undefined
		footer?: Html | undefined
	}>,
): Html =>
	base.h.div(
		[
			base.h.Id(`customer-kpi-${base.id}`),
			base.h.Class("flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-bg p-4"),
		],
		[
			base.h.span([base.h.Class("text-muted-fg text-sm")], [base.label]),
			base.h.div(
				[base.h.Class("flex min-w-0 items-baseline gap-1.5")],
				[
					base.h.span(
						[
							base.h.Class(
								twMerge(
									"font-semibold text-2xl text-fg tabular-nums tracking-tight",
									options.valueClass,
								),
							),
						],
						[options.value],
					),
					...(options.detail === undefined
						? []
						: [base.h.span([base.h.Class("truncate text-muted-fg text-sm")], [options.detail])]),
				],
			),
			...(options.footer === undefined ? [] : [options.footer]),
		],
	)

// USAGE

const usageCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const series = Option.getOrUndefined(AsyncData.getData(model.usage))?.[0]
	const failed = AsyncData.getError(model.usage)
	const metric = model.metrics.find((row) => row.key === model.usageMetric)
	const metricName = series?.name ?? metric?.name ?? "Active users"
	// Built-ins read plainly by name ("Daily active users"); a source's metric needs its unit.
	const unit = metric?.provider == null ? null : metric.unit
	const isUnitMissing = metric?.provider === "autumn" && unit === null
	const points = series?.points ?? []
	const values = points.map((point) => point.value)
	const recent = values.slice(-7)
	const prior = values.slice(-35, -7)
	const average = (list: ReadonlyArray<number>) =>
		list.length === 0 ? 0 : list.reduce((sum, value) => sum + value, 0) / list.length
	const change = average(prior) === 0 ? null : ((average(recent) - average(prior)) / average(prior)) * 100
	const description =
		points.length === 0
			? `Daily ${metricName.toLowerCase()}.`
			: change === null
				? `Daily ${metricName.toLowerCase()}, ${RANGE_COMPARISON[model.usageRange].replace("vs ", "")}.`
				: `7-day average ${change < 0 ? "down" : "up"} ${formatDeltaPct(Math.abs(Math.round(change))).replace("+", "")} vs the prior 28 days.`
	return chartCard(
		h,
		{
			title: "Usage",
			description,
			aside: h.div(
				[h.Class("flex flex-wrap items-center gap-2")],
				[
					menu(h, model.metricMenu, {
						entries: metricEntries(model.metrics),
						trigger: (attributes, overlay) =>
							button(h, { intent: "outline", size: "sm", attributes }, [
								h.span([h.Class("text-muted-fg")], ["Metric"]),
								metricName,
								...(unit === null ? [] : [h.span([h.Class("text-muted-fg")], [unit])]),
								IconChevronDown(h, { className: "size-3" }),
								overlay,
							]),
						content: (key) => [
							menuLabel(
								h,
								model.metricMenu.id,
								key,
								model.metrics.find((metric) => metric.key === key)?.name ?? "Active users",
							),
						],
						toMessage: (message) => Message.GotMetricMenuMessage({ message }),
					}),
					...(isUnitMissing
						? [
								h.a(
									[
										h.Href(
											hrefOf(
												AppRoute.CustomersSourceDetail({
													orgSlug: context.orgSlug,
													provider: "autumn",
												}),
											),
										),
										h.Class("text-primary text-sm hover:underline"),
									],
									["Set unit"],
								),
							]
						: []),
					rangePicker(h, {
						selected: model.usageRange,
						onSelect: (range) => Message.ClickedUsageRange({ range }),
						caption: null,
					}),
				],
			),
		},
		[
			failed._tag === "Some" && series === undefined
				? h.p([h.Class("py-12 text-center text-muted-fg text-sm")], ["Couldn't load usage."])
				: series === undefined
					? h.div([h.Class("h-52 animate-pulse rounded-lg bg-secondary/40")])
					: values.every((value) => value === 0)
						? h.p(
								[h.Class("py-12 text-center text-muted-fg text-sm")],
								["No usage recorded in this range."],
							)
						: stackedBarChart(h, {
								ariaLabel: `${metricName}${unit === null ? "" : ` (${unit})`}, daily`,
								stacks: [{ key: "value", label: metricName, color: "series-1" }],
								bars: points.map((point) => ({
									tick: formatDay(point.day),
									heading: formatDayLong(point.day),
									values: { value: point.value },
									net: point.value,
								})),
								formatValue: (value) => formatMetricValue(value, unit),
								formatAxis: formatCompact,
								integerTicks: values.every(Number.isInteger),
								hoveredIndex: model.hoveredUsage,
								onHover: (index) => Message.HoveredUsage({ index }),
								maxXTicks: 6,
								heightClass: "h-48",
							}),
		],
	)
}

// HEALTH

const healthCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	bands: Customers.HealthBands,
): Html => {
	const breakdown = context.detail?.health ?? null
	if (breakdown === null)
		return card(h, { title: "Health" }, [
			h.p(
				[h.Class("text-muted-fg text-sm")],
				[
					context.detail === null
						? "Loading…"
						: "Not scored yet: the score appears after the next compute.",
				],
			),
		])
	const history = context.detail?.healthSeries ?? []
	const weekAgo = history.at(-8)?.value
	const subtitle = [
		weekAgo === undefined || breakdown.score === null || weekAgo === breakdown.score
			? null
			: `${breakdown.score < weekAgo ? "Down" : "Up"} ${Math.abs(breakdown.score - weekAgo)} points in 7 days.`,
		`At risk is ${bands.atRiskMin}–${bands.healthyMin - 1}.`,
	]
		.filter((part) => part !== null)
		.join(" ")
	return healthBreakdown(h, {
		breakdown,
		bands,
		subtitle,
		action: h.a(
			[
				h.Href(hrefOf(AppRoute.CustomersSettingsHealth({ orgSlug: context.orgSlug }))),
				h.Class("shrink-0 text-primary text-sm hover:underline"),
			],
			["Edit weights"],
		),
		excludedAction: (key) =>
			key === "billing"
				? h.a(
						[
							h.Href(hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: context.orgSlug }))),
							h.Class("text-primary text-sm hover:underline"),
						],
						["Connect a billing source"],
					)
				: null,
	})
}

// SIGNALS

const OUTCOME_LABEL = {
	contacted: "Contacted",
	fixed: "Fixed",
	not_an_issue: "Not an issue",
	other: "Other",
} as const
const MORE_LABEL = {
	[ASSIGN_ME]: "Assign to me",
	[UNASSIGN]: "Unassign",
	[OPEN_QUEUE]: "Open in Needs attention",
	[DISMISS]: "Dismiss (not useful)",
} as const

const labelOf = (labels: Readonly<Record<string, string>>, key: string) => labels[key] ?? key

const signalButtons = (
	h: HtmlBuilder<Message>,
	model: Model,
	signal: SignalRow,
	nowMs: number,
): ReadonlyArray<Html> => {
	const isActive = model.activeSignalId === signal.id
	const labeled = (menuId: string, labels: Readonly<Record<string, string>>) => (key: string) => [
		menuLabel(h, menuId, key, labelOf(labels, key)),
	]
	/** The active signal's buttons are the menus' triggers; the others open them for their signal. */
	const action = (
		which: "snooze" | "done" | "more",
		label: string,
		glyph: Html,
		menuModel: Model["snoozeMenu"],
		entries: ReadonlyArray<Parameters<typeof menu>[2]["entries"][number]>,
		content: (key: string) => ReadonlyArray<Html | string>,
		toMessage: Parameters<typeof menu>[2]["toMessage"],
	): Html =>
		isActive
			? menu(h, menuModel, {
					entries,
					trigger: (attributes, overlay) =>
						queueAction(h, {
							label,
							icon: glyph,
							iconOnly: which === "more",
							attributes,
							overlay,
						}),
					content,
					toMessage,
				})
			: queueAction(h, {
					label,
					icon: glyph,
					iconOnly: which === "more",
					onPress: Message.PressedSignalMenu({ signalId: signal.id, menu: which }),
				})
	return [
		action(
			"snooze",
			signal.status === "snoozed" ? "Change snooze" : "Snooze",
			IconClock(h, icon),
			model.snoozeMenu,
			snoozeEntries,
			snoozeMenuContent(h, model.snoozeMenu.id, new Date(nowMs)),
			(message) => Message.GotSnoozeMenuMessage({ message }),
		),
		action(
			"done",
			"Done",
			IconCheck(h, icon),
			model.doneMenu,
			doneEntries,
			labeled(model.doneMenu.id, OUTCOME_LABEL),
			(message) => Message.GotDoneMenuMessage({ message }),
		),
		action(
			"more",
			"More actions",
			IconDots(h, icon),
			model.signalMoreMenu,
			signalMoreEntries,
			labeled(model.signalMoreMenu.id, MORE_LABEL),
			(message) => Message.GotSignalMoreMenuMessage({ message }),
		),
	]
}

const signalsCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const signals = openSignals(model)
	return card(
		h,
		{
			title: "Open signals",
			count: signals.length,
			aside: h.a(
				[
					h.Href(hrefOf(AppRoute.CustomersAttention({ orgSlug: context.orgSlug }))),
					h.Class("inline-flex items-center gap-1 text-primary text-sm hover:underline"),
				],
				["Open in Needs attention", IconChevronRight(h, { className: "size-3" })],
			),
			bodyClassName: "p-0 sm:px-0",
		},
		signals.length === 0
			? [
					h.p(
						[h.Class("px-4 pb-4 text-muted-fg text-sm sm:px-5")],
						["Nothing needs attention on this account."],
					),
				]
			: signals.map((signal) =>
					h.div(
						[
							h.Key(signal.id),
							h.Class("flex gap-4 border-border border-t px-4 py-4 first:border-t-0 sm:px-5"),
						],
						[
							h.div(
								[h.Class("flex min-w-0 flex-1 flex-col gap-2")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											severityChip(h, signal.severity),
											h.span([h.Class("font-medium text-fg")], [signal.title]),
											h.span(
												[h.Class("text-muted-fg text-xs")],
												[
													signal.status === "snoozed" &&
													signal.snoozedUntilMs !== null
														? `snoozed until ${formatDate(new Date(signal.snoozedUntilMs), { now: new Date(context.nowMs) })}`
														: `· opened ${formatDate(new Date(signal.openedAtMs), { now: new Date(context.nowMs) })}`,
												],
											),
										],
									),
									h.p([h.Class("text-fg-2 text-sm")], [signal.reason]),
									h.div(
										[h.Class("flex flex-wrap items-center gap-1.5")],
										signalButtons(h, model, signal, context.nowMs),
									),
								],
							),
							h.div(
								[h.Class("flex shrink-0 flex-col items-end gap-2 max-sm:hidden")],
								[
									evidenceViz(h, signal.evidence),
									personLabel(h, memberOf(context, signal.assigneeUserId)),
								],
							),
						],
					),
				),
	)
}

// SUBSCRIPTION, NOTES, ACTIVITY

const factRow = (h: HtmlBuilder<Message>, label: string, value: string) =>
	h.div(
		[h.Class("flex items-baseline justify-between gap-4 py-1 text-sm")],
		[
			h.span([h.Class("text-muted-fg")], [label]),
			h.span([h.Class("text-right text-fg tabular-nums")], [value]),
		],
	)

const INTERVAL_LABEL = { month: "Monthly", year: "Yearly", other: "Custom" } as const

const subscriptionCard = (h: HtmlBuilder<Message>, context: Context): Html => {
	const subscriptions = context.detail?.subscriptions ?? []
	const subscription = subscriptions.find((entry) => entry.status !== "canceled") ?? subscriptions[0]
	const now = new Date(context.nowMs)
	return card(
		h,
		{
			title: "Subscription",
			aside: headerLink(h, "View billing", Message.ClickedTab({ tab: "billing" })),
		},
		subscription === undefined
			? [
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[context.detail === null ? "Loading…" : "No subscription from a billing source."],
					),
				]
			: [
					h.div(
						[h.Class("flex items-end justify-between gap-4 pb-3")],
						[
							h.div(
								[h.Class("flex flex-col gap-0.5")],
								[
									h.span(
										[h.Class("font-semibold text-fg text-lg")],
										[subscription.planName ?? "Unnamed plan"],
									),
									h.span(
										[h.Class("text-muted-fg text-xs")],
										[
											`${INTERVAL_LABEL[subscription.interval]} · ${subscription.quantity} seat${subscription.quantity === 1 ? "" : "s"} · ${subscription.status.replace("_", " ")}`,
										],
									),
								],
							),
							h.span(
								[h.Class("font-semibold text-fg text-xl tabular-nums")],
								[
									formatMoney(subscription.mrrMinor, subscription.currency),
									h.span([h.Class("font-normal text-muted-fg text-sm")], [" / mo"]),
								],
							),
						],
					),
					...(subscription.currentPeriodEnd === null
						? []
						: [
								factRow(
									h,
									subscription.cancelAtPeriodEnd ? "Cancels" : "Next renewal",
									formatDate(subscription.currentPeriodEnd, { now, withYear: true }),
								),
							]),
					...(subscription.startedAt === null
						? []
						: [
								factRow(
									h,
									"Started",
									formatDate(subscription.startedAt, { now, withYear: true }),
								),
							]),
					...(subscription.paymentMethod?.last4
						? [
								factRow(
									h,
									"Payment method",
									`${subscription.paymentMethod.brand ?? "Card"} •••• ${subscription.paymentMethod.last4}`,
								),
							]
						: []),
				],
	)
}

export const noteBody = (h: HtmlBuilder<Message>, body: string, className?: string): Html =>
	h.div([h.Class(twMerge("text-fg text-sm [&_*]:text-sm", className))], [markdownView(h, body)])

const pinnedNotesCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const pinned = sortedNotes(model).filter((note) => note.pinned)
	return card(
		h,
		{
			title: "Pinned notes",
			count: pinned.length,
			aside: headerLink(h, "All notes", Message.ClickedTab({ tab: "notes" })),
		},
		pinned.length === 0
			? [h.p([h.Class("text-muted-fg text-sm")], ["Pin a note to keep it here."])]
			: pinned
					.slice(0, 3)
					.map((note) =>
						h.div(
							[
								h.Key(note.id),
								h.Class(
									"mb-2 flex flex-col gap-1 rounded-lg border border-border p-3 last:mb-0",
								),
							],
							[
								noteBody(h, note.body, "line-clamp-4"),
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[
										`${memberOf(context, note.authorUserId)?.name ?? "Someone"} · ${formatDate(new Date(note.createdAtMs), { now: new Date(context.nowMs) })}`,
									],
								),
							],
						),
					),
	)
}

export const eventTime = (event: Customers.Event, nowMs: number): string => {
	const at = msOf(event.occurredAt)
	return nowMs - at < DAY_MS
		? new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
		: formatDate(new Date(at), { now: new Date(nowMs) })
}

const activityCard = (h: HtmlBuilder<Message>, context: Context): Html => {
	const events = context.detail?.recentEvents ?? []
	return card(
		h,
		{
			title: "Recent activity",
			aside: headerLink(h, "Full timeline", Message.ClickedTab({ tab: "activity" })),
			bodyClassName: "p-0 sm:px-0",
		},
		events.length === 0
			? [
					h.p(
						[h.Class("px-4 pb-4 text-muted-fg text-sm sm:px-5")],
						[context.detail === null ? "Loading…" : "No activity yet."],
					),
				]
			: events.map((event) =>
					h.div(
						[
							h.Key(event.id),
							h.Class(
								"flex items-start gap-3 border-border border-t px-4 py-3 first:border-t-0 sm:px-5",
							),
						],
						[
							sourceMark(h, event.provider, { className: "size-7" }),
							h.div(
								[h.Class("flex min-w-0 flex-1 flex-col")],
								[
									h.span([h.Class("truncate font-medium text-fg text-sm")], [event.title]),
									h.span([h.Class("text-muted-fg text-xs")], [event.type]),
								],
							),
							h.span(
								[h.Class("shrink-0 text-muted-fg text-xs")],
								[
									`${memberOf(context, event.actorUserId)?.name ?? (event.provider === "hazel" ? "Hazel" : event.provider[0].toUpperCase() + event.provider.slice(1))} · ${eventTime(event, context.nowMs)}`,
								],
							),
						],
					),
				),
	)
}

export const overviewTab = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	bands: Customers.HealthBands,
): ReadonlyArray<Html> => [
	kpis(h, context),
	usageCard(h, model, context),
	healthCard(h, model, context, bands),
	signalsCard(h, model, context),
	h.div(
		[h.Class("grid gap-4 lg:grid-cols-2")],
		[subscriptionCard(h, context), pinnedNotesCard(h, model, context)],
	),
	activityCard(h, context),
]
