import type * as Customers from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { markdownView } from "../../chat/markdown/markdown-view"
import { IconChevronRight } from "../../icons"
import { AppRoute, type CustomerTab, customerRoute, hrefOf } from "../../route"
import { heading } from "../../ui/heading"
import { formatDate, formatMoney, formatRelative } from "../format"
import { accountLabelOf } from "../groups"
import { type AccountRow, type MemberRow, msOf, type SignalRow } from "../queries"
import { severityChip } from "../ui/badges"
import { evidenceViz } from "../ui/evidence"
import { healthBreakdown } from "../ui/health-breakdown"
import { personLabel, sourceMark } from "../ui/identity"
import { linkClass } from "../ui/surface"

/**
 * The customer page's own sections, placed in a layout like any widget (`BuiltInWidget`): the health
 * breakdown, open signals, support, subscription, pinned notes, recent activity and last active. The Overview
 * tab and the layout editor's canvas both draw them from a `BuiltInContext`.
 */

const DAY_MS = 86_400_000

/** A pinned note as the section shows it. */
export interface PinnedNote {
	readonly id: string
	readonly body: string
	readonly authorUserId: UserId
	readonly createdAtMs: number
}

export interface BuiltInContext {
	readonly orgSlug: string
	readonly nowMs: number
	readonly account: AccountRow
	/** `customers.account.detail`, once it answers. */
	readonly detail: Customers.AccountDetail | null
	readonly bands: Customers.HealthBands
	/** The customer's open and snoozed signals (an environment's are its primary's). */
	readonly signals: ReadonlyArray<SignalRow>
	/** The primary this account is an environment of, else null. */
	readonly primary: AccountRow | null
	/** Pinned first, newest first. */
	readonly pinnedNotes: ReadonlyArray<PinnedNote>
	readonly membersById: ReadonlyMap<string, MemberRow>
	/** A card header's link to another tab of the customer (`View billing`, `All notes`). */
	readonly tabLink: (tab: CustomerTab, label: string) => Html
	/** A signal's actions (snooze, done, more); none in the editor's preview. */
	readonly signalActions?: (signal: SignalRow) => ReadonlyArray<Html>
	/** The Support block (open issues, overdue, first response), drawn by the customer page. */
	readonly support?: () => Html
}

const memberOf = (context: BuiltInContext, id: UserId | null): MemberRow | null =>
	id === null ? null : (context.membersById.get(id) ?? null)

/** A bordered section with a title row. */
export const sectionCard = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		count?: number
		aside?: Html
		className?: string
		bodyClassName?: string
	}>,
	children: ReadonlyArray<Html>,
): Html =>
	h.section(
		[h.Class(twMerge("flex min-w-0 flex-col rounded-xl border border-border bg-bg", options.className))],
		[
			h.header(
				[h.Class("flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-5")],
				[
					heading(
						h,
						{ variant: "section", className: "flex items-baseline gap-2 whitespace-nowrap" },
						[
							options.title,
							...(options.count === undefined
								? []
								: [
										h.span(
											[h.Class("font-normal text-muted-fg text-sm tabular-nums")],
											[String(options.count)],
										),
									]),
						],
					),
					...(options.aside ? [options.aside] : []),
				],
			),
			h.div([h.Class(twMerge("flex flex-col p-4 sm:px-5", options.bodyClassName))], [...children]),
		],
	)

const muted = <M>(h: HtmlBuilder<M>, text: string, className = "text-muted-fg text-sm") =>
	h.p([h.Class(className)], [text])

// HEALTH

const healthCard = <M>(h: HtmlBuilder<M>, context: BuiltInContext): Html => {
	const breakdown = context.detail?.health ?? null
	if (breakdown === null)
		return sectionCard(h, { title: "Health" }, [
			muted(
				h,
				context.detail === null
					? "Loading…"
					: "Not scored yet: the score appears after the next compute.",
			),
		])
	const { bands } = context
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

/** On an environment's page: its signals are the customer's, raised on the primary. */
const primaryNote = <M>(h: HtmlBuilder<M>, context: BuiltInContext): ReadonlyArray<Html> => {
	const { primary } = context
	return primary === null
		? []
		: [
				h.p(
					[h.Class("px-4 pb-3 text-muted-fg text-sm sm:px-5")],
					[
						"Signals are raised for the whole customer, on its primary, ",
						h.a(
							[h.Href(hrefOf(customerRoute(context.orgSlug, primary.id))), h.Class(linkClass)],
							[accountLabelOf(primary)],
						),
						".",
					],
				),
			]
}

const signalsCard = <M>(h: HtmlBuilder<M>, context: BuiltInContext): Html => {
	const { signals } = context
	const now = new Date(context.nowMs)
	return sectionCard(
		h,
		{
			title: "Open signals",
			count: signals.length,
			aside: h.a(
				[
					h.Href(hrefOf(AppRoute.CustomersAttention({ orgSlug: context.orgSlug }))),
					h.Class(
						"inline-flex items-center gap-1 whitespace-nowrap text-primary text-sm hover:underline",
					),
				],
				["Open in Needs attention", IconChevronRight(h, { className: "size-3" })],
			),
			bodyClassName: "p-0 sm:px-0",
		},
		[
			...primaryNote(h, context),
			...(signals.length === 0
				? [
						muted(
							h,
							"Nothing needs attention on this account.",
							"px-4 pb-4 text-muted-fg text-sm sm:px-5",
						),
					]
				: signals.map((signal) =>
						h.div(
							[
								h.Key(signal.id),
								h.Class(
									"flex gap-4 border-border border-t px-4 py-4 first:border-t-0 sm:px-5",
								),
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
															? `snoozed until ${formatDate(new Date(signal.snoozedUntilMs), { now })}`
															: `· opened ${formatDate(new Date(signal.openedAtMs), { now })}`,
													],
												),
											],
										),
										h.p([h.Class("text-fg-2 text-sm")], [signal.reason]),
										...(context.signalActions === undefined
											? []
											: [
													h.div(
														[h.Class("flex flex-wrap items-center gap-1.5")],
														context.signalActions(signal),
													),
												]),
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
					)),
		],
	)
}

// SUBSCRIPTION

const factRow = <M>(h: HtmlBuilder<M>, label: string, value: string) =>
	h.div(
		[h.Class("flex items-baseline justify-between gap-4 py-1 text-sm")],
		[
			h.span([h.Class("text-muted-fg")], [label]),
			h.span([h.Class("text-right text-fg tabular-nums")], [value]),
		],
	)

const INTERVAL_LABEL = { month: "Monthly", year: "Yearly", other: "Custom" } as const

const subscriptionCard = <M>(h: HtmlBuilder<M>, context: BuiltInContext): Html => {
	const subscriptions = context.detail?.subscriptions ?? []
	const subscription = subscriptions.find((entry) => entry.status !== "canceled") ?? subscriptions[0]
	const now = new Date(context.nowMs)
	return sectionCard(
		h,
		{ title: "Subscription", aside: context.tabLink("billing", "View billing") },
		subscription === undefined
			? [muted(h, context.detail === null ? "Loading…" : "No subscription from a billing source.")]
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

// NOTES

export const noteBody = <M>(h: HtmlBuilder<M>, body: string, className?: string): Html =>
	h.div([h.Class(twMerge("text-fg text-sm [&_*]:text-sm", className))], [markdownView(h, body)])

const pinnedNotesCard = <M>(h: HtmlBuilder<M>, context: BuiltInContext): Html => {
	const pinned = context.pinnedNotes
	return sectionCard(
		h,
		{ title: "Pinned notes", count: pinned.length, aside: context.tabLink("notes", "All notes") },
		pinned.length === 0
			? [muted(h, "Pin a note to keep it here.")]
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

// ACTIVITY

export const eventTime = (event: Customers.Event, nowMs: number): string => {
	const at = msOf(event.occurredAt)
	return nowMs - at < DAY_MS
		? new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
		: formatDate(new Date(at), { now: new Date(nowMs) })
}

const activityCard = <M>(h: HtmlBuilder<M>, context: BuiltInContext): Html => {
	const events = context.detail?.recentEvents ?? []
	return sectionCard(
		h,
		{
			title: "Recent activity",
			aside: context.tabLink("activity", "Full timeline"),
			bodyClassName: "p-0 sm:px-0",
		},
		events.length === 0
			? [
					muted(
						h,
						context.detail === null ? "Loading…" : "No activity yet.",
						"px-4 pb-4 text-muted-fg text-sm sm:px-5",
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

// LAST ACTIVE

/** A stat-sized tile, like the stat widgets beside it. */
export const statTile = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		id: string
		label: string
		value: Html | string
		/** Under the value: the change, or who or what it is. */
		detail?: Html | string | undefined
		valueClass?: string
	}>,
): Html =>
	h.div(
		[
			h.Id(`customer-kpi-${options.id}`),
			h.Class(
				"flex h-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-bg p-4 max-md:p-3",
			),
		],
		[
			h.span([h.Class("truncate font-medium text-muted-fg text-xs/5")], [options.label]),
			h.div(
				[
					h.Class(
						twMerge(
							"flex min-w-0 items-baseline gap-x-1.5 whitespace-nowrap font-semibold text-2xl/8 text-fg tabular-nums tracking-tight max-md:text-xl/7",
							options.valueClass,
						),
					),
				],
				[options.value],
			),
			...(options.detail === undefined
				? []
				: [
						h.div(
							[h.Class("flex min-w-0 items-center gap-1 truncate text-muted-fg text-xs/5")],
							[options.detail],
						),
					]),
		],
	)

const lastActiveTile = <M>(h: HtmlBuilder<M>, context: BuiltInContext, id: string): Html => {
	const { account, detail } = context
	const name =
		detail?.contactsToReach.find((row) => row.contact.id === detail.account.lastActiveContactId)?.contact
			.name ?? null
	return statTile(h, {
		id,
		label: "Last active",
		value:
			account.lastActiveAtMs === null
				? "Never"
				: formatRelative(new Date(account.lastActiveAtMs), new Date(context.nowMs)),
		detail: name ?? undefined,
	})
}

// SUPPORT

/** The editor's stand-in: the block needs the customer page's live issues. */
const supportPlaceholder = <M>(h: HtmlBuilder<M>): Html =>
	sectionCard(h, { title: "Support" }, [
		h.p(
			[h.Class("px-4 pt-2 pb-4 text-muted-fg text-sm sm:px-5")],
			["Open issues, overdue issues and median first response. Shown on the customer page."],
		),
	])

// DISPATCH

export const BUILT_IN_LABEL = {
	health: "Health breakdown",
	signals: "Open signals",
	support: "Support",
	subscription: "Subscription",
	notes: "Pinned notes",
	activity: "Recent activity",
	last_active: "Last active",
} as const satisfies Record<Customers.BuiltInWidgetKind, string>

export const builtInView = <M>(
	h: HtmlBuilder<M>,
	widget: Customers.BuiltInWidget,
	context: BuiltInContext,
): Html => {
	switch (widget.kind) {
		case "health":
			return healthCard(h, context)
		case "signals":
			return signalsCard(h, context)
		case "support":
			return context.support?.() ?? supportPlaceholder(h)
		case "subscription":
			return subscriptionCard(h, context)
		case "notes":
			return pinnedNotesCard(h, context)
		case "activity":
			return activityCard(h, context)
		case "last_active":
			return lastActiveTile(h, context, widget.id)
	}
}
