import { integrationOf } from "@hazel/customer-integrations"
import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { markdownView } from "../../../chat/markdown/markdown-view"
import { stackedBarChart } from "../../../customers/charts/stacked-bar-chart"
import {
	formatCompact,
	formatCount,
	formatDate,
	formatDay,
	formatDayLong,
	formatDeltaPct,
	formatMetricValue,
	formatRelative,
} from "../../../customers/format"
import { accountLabelOf } from "../../../customers/groups"
import { msOf, type SignalRow } from "../../../customers/queries"
import { overdueByMs } from "../../../customers/sla"
import { formatResponse, formatWithin } from "../../../customers/support-report"
import { severityGlyph } from "../../../customers/ui/badges"
import { rangePicker } from "../../../customers/ui/filter-bar"
import { personLabel, sourceMark } from "../../../customers/ui/identity"
import { snoozeMenuContent } from "../../../customers/ui/menus"
import { queueAction } from "../../../customers/ui/queue-row"
import { linkClass } from "../../../customers/ui/surface"
import {
	IconArrowPath,
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconClock,
	IconDots,
	IconPin,
} from "../../../icons"
import { AppRoute, customerRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import { heading } from "../../../ui/heading"
import { menuLabel } from "../../../ui/menu-view"
import { Message } from "./message"
import {
	ASSIGN_ME,
	doneEntries,
	metricEntries,
	type Model,
	OPEN_QUEUE,
	openSignals,
	primaryOf,
	snoozeEntries,
	signalMoreEntries,
	sortedNotes,
	UNASSIGN,
} from "./model"
import { type Context, headerLink, icon, memberOf, menu } from "./parts"

/**
 * The overview tab, read top to bottom as "what needs me, how are they doing, what happened": the
 * open signals with their actions, one strip of numbers, support in a line, usage, then pinned notes
 * and recent activity. Billing facts live in the Billing tab and the side panel, so nothing here
 * repeats them.
 */

const DAY_MS = 86_400_000

const sectionTitle = (h: HtmlBuilder<Message>, title: string, aside?: Html): Html =>
	h.div(
		[h.Class("flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-2")],
		[heading(h, { variant: "subsection", level: 2 }, [title]), ...(aside === undefined ? [] : [aside])],
	)

// PULSE

/** One cell of the pulse strip: a label, a number, and what it is measured against. */
const pulseStat = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		id: string
		label: string
		value: string
		/** Beside the value: `/ 24`. */
		suffix?: string | undefined
		detail?: string | undefined
		valueClass?: string | undefined
	}>,
): Html =>
	h.div(
		[
			h.Id(`customer-kpi-${options.id}`),
			h.Class(
				// Two columns on a phone, the third cell across both under a top rule.
				"flex min-w-0 flex-col gap-0.5 border-border px-4 py-3 md:border-l md:first:border-l-0 max-md:even:border-l max-md:last:col-span-2 max-md:last:border-t",
			),
		],
		[
			h.span([h.Class("truncate text-muted-fg text-xs")], [options.label]),
			h.span(
				[h.Class("flex min-w-0 items-baseline gap-1")],
				[
					h.span(
						[
							h.Class(
								twMerge(
									"whitespace-nowrap font-semibold text-fg text-lg tabular-nums tracking-tight",
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
			...(options.detail === undefined
				? []
				: [
						h.span(
							[h.Class("truncate text-muted-fg text-xs"), h.Title(options.detail)],
							[options.detail],
						),
					]),
		],
	)

const pulse = (h: HtmlBuilder<Message>, context: Context): Html => {
	const { account } = context
	const now = new Date(context.nowMs)
	const trend = account.activeUsersTrendPct
	const lastActiveName =
		context.detail?.contactsToReach.find(
			(row) => row.contact.id === context.detail?.account.lastActiveContactId,
		)?.contact.name ?? null
	const trendTone =
		trend === null || Math.abs(trend) < 5
			? undefined
			: trend < 0
				? "text-danger-subtle-fg"
				: "text-success-subtle-fg"
	return h.div(
		[
			h.AriaLabel("At a glance"),
			h.Role("group"),
			h.Class("grid grid-cols-2 rounded-xl border border-border bg-bg md:grid-cols-3"),
		],
		[
			pulseStat(h, {
				id: "active-users",
				label: "Active users",
				value: formatCount(account.activeUsers30d),
				suffix: `/ ${formatCount(account.contactCount)}`,
				detail: "Last 30 days",
			}),
			pulseStat(h, {
				id: "usage-trend",
				label: "Usage",
				value: trend === null ? "—" : formatDeltaPct(Math.round(trend)),
				valueClass: trendTone,
				detail: "7d vs prior 28d",
			}),
			pulseStat(h, {
				id: "last-active",
				label: "Last active",
				value:
					account.lastActiveAtMs === null
						? "Never"
						: formatRelative(new Date(account.lastActiveAtMs), now),
				detail: lastActiveName ?? undefined,
			}),
		],
	)
}

// USAGE

const usageSection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const series = Option.getOrUndefined(AsyncData.getData(model.usage))?.[0]
	const failed = AsyncData.getError(model.usage)
	const metric = model.metrics.find((row) => row.key === model.usageMetric)
	const metricName = series?.name ?? metric?.name ?? "Active users"
	// Built-ins read plainly by name ("Daily active users"); a source's metric needs its unit.
	const unit = metric?.provider == null ? null : metric.unit
	const unitSource =
		metric?.provider != null &&
		unit === null &&
		integrationOf(metric.provider)?.capabilities.meteredLimits === true
			? metric.provider
			: null
	const points = series?.points ?? []
	const values = points.map((point) => point.value)
	return h.section(
		[h.AriaLabel("Usage"), h.Class("flex min-w-0 flex-col gap-3")],
		[
			sectionTitle(
				h,
				"Usage",
				h.div(
					[h.Class("flex flex-wrap items-center gap-2")],
					[
						menu(h, model.metricMenu, {
							entries: metricEntries(model.metrics),
							trigger: (attributes, overlay) =>
								button(h, { intent: "outline", size: "xs", attributes }, [
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
									model.metrics.find((metric) => metric.key === key)?.name ??
										"Active users",
								),
							],
							toMessage: (message) => Message.GotMetricMenuMessage({ message }),
						}),
						...(unitSource !== null
							? [
									h.a(
										[
											h.Href(
												hrefOf(
													AppRoute.CustomersSourceDetail({
														orgSlug: context.orgSlug,
														provider: unitSource,
													}),
												),
											),
											h.Class(twMerge(linkClass, "text-xs")),
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
			),
			failed._tag === "Some" && series === undefined
				? h.p([h.Class("py-10 text-center text-muted-fg text-sm")], ["Couldn't load usage."])
				: series === undefined
					? h.div([h.Class("h-32 animate-pulse rounded-lg bg-secondary/40")])
					: values.every((value) => value === 0)
						? h.p(
								[h.Class("py-10 text-center text-muted-fg text-sm")],
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
								formatAxis: (value) =>
									Math.abs(value) < 1
										? formatMetricValue(value, null)
										: formatCompact(value),
								integerTicks: values.every(Number.isInteger),
								hoveredIndex: model.hoveredUsage,
								onHover: (index) => Message.HoveredUsage({ index }),
								maxXTicks: 6,
								heightClass: "h-32",
							}),
		],
	)
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

/** On an environment's page: besides its own, the customer-wide signals raised on the primary. */
const primaryNote = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => {
	const primary = primaryOf(model)
	return primary === null
		? []
		: [
				h.p(
					[h.Class("px-4 pb-3 text-muted-fg text-sm sm:px-5")],
					[
						"Customer-wide signals are raised on its primary, ",
						h.a(
							[h.Href(hrefOf(customerRoute(context.orgSlug, primary.id))), h.Class(linkClass)],
							[accountLabelOf(primary)],
						),
						".",
					],
				),
			]
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const satisfies Record<
	Customers.SignalSeverity,
	number
>

/** Open first, then the most severe, then the newest. */
const byUrgency = (left: SignalRow, right: SignalRow): number =>
	(left.status === "snoozed" ? 1 : 0) - (right.status === "snoozed" ? 1 : 0) ||
	SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
	right.openedAtMs - left.openedAtMs

/**
 * What needs someone, first on the page: each open signal says what happened and why, with its
 * actions under it. With nothing open the block is left out; the pulse strip says how they are doing.
 */
const attentionSection = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => {
	const signals = [...openSignals(model)].sort(byUrgency)
	if (signals.length === 0) return []
	const now = new Date(context.nowMs)
	return [
		h.section(
			[
				h.AriaLabel("Needs attention"),
				h.Class("flex min-w-0 flex-col rounded-xl border border-border bg-bg"),
			],
			[
				h.div(
					[h.Class("flex items-center justify-between gap-4 px-4 pt-3")],
					[
						h.span(
							[h.Class("text-muted-fg text-xs")],
							[
								signals.length === 1
									? "Needs attention"
									: `Needs attention · ${formatCount(signals.length)}`,
							],
						),
						h.a(
							[
								h.Href(hrefOf(AppRoute.CustomersAttention({ orgSlug: context.orgSlug }))),
								h.Class(twMerge(linkClass, "inline-flex items-center gap-0.5 text-xs")),
							],
							["Queue", IconChevronRight(h, { className: "size-3" })],
						),
					],
				),
				...primaryNote(h, model, context),
				...signals.map((signal, index) =>
					h.div(
						[
							h.Key(signal.id),
							h.Class(
								twMerge(
									"flex flex-col gap-1.5 px-4 pt-2 pb-3.5",
									index > 0 && "border-border border-t pt-3.5",
								),
							),
						],
						[
							h.div(
								[h.Class("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1")],
								[
									severityGlyph(h, signal.severity),
									h.span([h.Class("font-medium text-fg")], [signal.title]),
									h.span(
										[h.Class("text-muted-fg text-xs")],
										[
											signal.status === "snoozed" && signal.snoozedUntilMs !== null
												? `snoozed until ${formatDate(new Date(signal.snoozedUntilMs), { now })}`
												: formatDate(new Date(signal.openedAtMs), { now }),
										],
									),
								],
							),
							h.p([h.Class("text-fg-2 text-sm")], [signal.reason]),
							h.div(
								[h.Class("flex flex-wrap items-center gap-1.5 pt-1")],
								[
									...signalButtons(h, model, signal, context.nowMs),
									// The owner is in the header; an assignee is worth naming only when it is someone else.
									...(signal.assigneeUserId === null ||
									signal.assigneeUserId === context.account.ownerUserId
										? []
										: [
												h.span(
													[h.Class("ml-auto")],
													[
														personLabel(
															h,
															memberOf(context, signal.assigneeUserId),
														),
													],
												),
											]),
								],
							),
						],
					),
				),
			],
		),
	]
}

// SUPPORT

/**
 * Open issues, how many are overdue (live), and the median first response over 30 days (the
 * Support report's row), in one line. Left out for a customer with no support history.
 */
export const supportCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const issues = model.supportIssues ?? []
	const row = Option.getOrNull(Option.flatMap(AsyncData.getData(model.support), Option.fromNullishOr))
	if (issues.length === 0 && row === null) return h.empty
	const open = issues.filter((issue) => issue.status !== "closed")
	const slasById = new Map(model.supportSlas.map((sla) => [sla.id, sla]))
	const overdue = open.filter((issue) => overdueByMs(slasById.get(issue.id), context.nowMs) !== null).length
	const isLoading = AsyncData.isLoading(model.support) || AsyncData.isIdle(model.support)
	const hasFailed = AsyncData.isFailure(model.support)
	const part = (label: string, value: string, tone?: "danger") =>
		h.span(
			[h.Class("inline-flex items-baseline gap-1.5 whitespace-nowrap")],
			[
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
				h.span([h.Class("text-muted-fg")], [label]),
			],
		)
	return h.section(
		[
			h.AriaLabel("Support"),
			h.Class(
				"flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg px-4 py-3 text-sm",
			),
		],
		[
			h.span([h.Class("font-medium text-fg")], ["Support"]),
			part(open.length === 1 ? "open issue" : "open issues", formatCount(open.length)),
			part("overdue", formatCount(overdue), overdue > 0 ? "danger" : undefined),
			hasFailed
				? button(h, { intent: "plain", size: "xs", onPress: Message.PressedRetrySupport() }, [
						IconArrowPath(h, icon),
						"First response couldn't load · Retry",
					])
				: part(
						row?.firstResponse.withinPct == null
							? "median first response · 30d"
							: `median first response · ${formatWithin(row.firstResponse.withinPct)} in SLA`,
						isLoading ? "…" : formatResponse(row?.firstResponse.medianMs ?? null),
					),
			h.a(
				[
					h.Href(hrefOf(AppRoute.CustomersInbox({ orgSlug: context.orgSlug }))),
					h.Class(twMerge(linkClass, "ml-auto text-xs")),
				],
				["Support inbox"],
			),
		],
	)
}

// NOTES AND ACTIVITY

export const noteBody = (h: HtmlBuilder<Message>, body: string, className?: string): Html =>
	h.div([h.Class(twMerge("text-fg text-sm [&_*]:text-sm", className))], [markdownView(h, body)])

export const eventTime = (event: Customers.Event, nowMs: number): string => {
	const at = msOf(event.occurredAt)
	return nowMs - at < DAY_MS
		? new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
		: formatDate(new Date(at), { now: new Date(nowMs) })
}

const actorOf = (context: Context, event: Customers.Event): string =>
	memberOf(context, event.actorUserId)?.name ??
	(event.provider === "hazel" ? "Hazel" : event.provider[0].toUpperCase() + event.provider.slice(1))

/** Pinned notes, then the latest events: one feed, the way the Activity tab reads in full. */
const activitySection = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const pinned = sortedNotes(model)
		.filter((note) => note.pinned)
		.slice(0, 3)
	const events = context.detail?.recentEvents ?? []
	const now = new Date(context.nowMs)
	return h.section(
		[h.AriaLabel("Activity"), h.Class("flex min-w-0 flex-col gap-2")],
		[
			sectionTitle(
				h,
				"Activity",
				headerLink(h, "Full timeline", Message.ClickedTab({ tab: "activity" })),
			),
			...pinned.map((note) =>
				h.div(
					[
						h.Key(note.id),
						h.Class("flex gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5"),
					],
					[
						IconPin(h, { className: "mt-0.5 size-3.5 shrink-0 text-muted-fg" }),
						h.div(
							[h.Class("flex min-w-0 flex-1 flex-col gap-1")],
							[
								noteBody(h, note.body, "line-clamp-3"),
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[
										`${memberOf(context, note.authorUserId)?.name ?? "Someone"} · ${formatDate(new Date(note.createdAtMs), { now })}`,
									],
								),
							],
						),
					],
				),
			),
			events.length === 0
				? h.p(
						[h.Class("py-2 text-muted-fg text-sm")],
						[context.detail === null ? "Loading…" : "No activity yet."],
					)
				: h.ul(
						[h.Class("flex flex-col")],
						events.map((event) =>
							h.li(
								[h.Key(event.id), h.Class("flex items-center gap-3 py-2")],
								[
									sourceMark(h, event.provider, { size: "xs" }),
									h.span(
										[
											h.Class("min-w-0 flex-1 truncate text-fg text-sm"),
											h.Title(event.title),
										],
										[event.title],
									),
									h.span(
										[h.Class("shrink-0 whitespace-nowrap text-muted-fg text-xs")],
										[`${actorOf(context, event)} · ${eventTime(event, context.nowMs)}`],
									),
								],
							),
						),
					),
		],
	)
}

export const overviewTab = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => [
	h.div(
		[h.Class("flex min-w-0 flex-col gap-6")],
		[
			...attentionSection(h, model, context),
			h.div(
				[h.Class("flex min-w-0 flex-col gap-3")],
				[pulse(h, context), supportCard(h, model, context)],
			),
			usageSection(h, model, context),
			activitySection(h, model, context),
		],
	),
]
