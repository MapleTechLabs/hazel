import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { stackedBarChart } from "../../../customers/charts/stacked-bar-chart"
import {
	formatDate,
	formatMoney,
	formatMoneyCompact,
	formatMonthLong,
	formatMonthShort,
} from "../../../customers/format"
import { safeSourceUrl } from "../../../customers/providers"
import { stageBadge } from "../../../customers/ui/badges"
import { dataTable } from "../../../customers/ui/data-table"
import { IconCopy, IconExternalLink, IconWarning } from "../../../icons"
import { badge } from "../../../ui/badge"
import { buttonClassName, button } from "../../../ui/button"
import { Message } from "./message"
import { type Model, paymentIssue } from "./model"
import { card, type Context, icon, pageFooter } from "./parts"

/** The billing tab: a payment issue, the subscriptions, MRR history and the invoices. */

const INTERVAL_LABEL = { month: "Monthly", year: "Yearly", other: "Custom" } as const

const SUBSCRIPTION_STATUS = {
	trialing: ["Trialing", "info"],
	active: ["Active", "success"],
	past_due: ["Past due", "warning"],
	unpaid: ["Unpaid", "danger"],
	paused: ["Paused", "secondary"],
	canceled: ["Canceled", "outline"],
} as const satisfies Record<Customers.SubscriptionStatus, readonly [string, string]>

const INVOICE_STATUS = {
	draft: ["Draft", "outline"],
	open: ["Open", "danger"],
	paid: ["Paid", "success"],
	uncollectible: ["Uncollectible", "danger"],
	void: ["Void", "secondary"],
	upcoming: ["Upcoming", "outline"],
} as const satisfies Record<Customers.InvoiceStatus, readonly [string, string]>

const externalLink = (h: HtmlBuilder<Message>, href: string, label: string): Html =>
	h.a(
		[
			h.Href(href),
			h.Attribute("target", "_blank"),
			h.Attribute("rel", "noreferrer"),
			h.Class(buttonClassName({ intent: "outline", size: "xs" })),
		],
		[label, IconExternalLink(h, icon)],
	)

const banner = (h: HtmlBuilder<Message>, context: Context, detail: Customers.AccountDetail): Html | null => {
	const issue = paymentIssue(detail, context.nowMs)
	if (issue === null) return null
	const now = new Date(context.nowMs)
	const { invoice } = issue
	const billingEmail =
		detail.contactsToReach.find((row) => row.contact.isBillingContact)?.contact.email ??
		(typeof detail.account.attributes.billingEmail === "string"
			? detail.account.attributes.billingEmail
			: null)
	const stripeUrl =
		(invoice === null ? null : safeSourceUrl(invoice.provider, invoice.hostedUrl)) ??
		safeSourceUrl("stripe", detail.refs.find((ref) => ref.provider === "stripe")?.externalUrl ?? null)
	const title =
		invoice === null
			? `The subscription is ${issue.subscription?.status.replace("_", " ")}`
			: `Invoice ${invoice.number ?? ""} for ${formatMoney(invoice.amountDueMinor, invoice.currency, { cents: true })} failed ${invoice.attemptCount} time${invoice.attemptCount === 1 ? "" : "s"} and is ${issue.daysOverdue} day${issue.daysOverdue === 1 ? "" : "s"} overdue`
	const details = [
		invoice?.declineReason ?? null,
		invoice?.nextRetryAt == null
			? null
			: `The provider tries again on ${formatDate(invoice.nextRetryAt, { now })}.`,
	].filter((part) => part !== null)
	return h.div(
		[
			h.Role("alert"),
			h.Class(
				"flex flex-wrap items-start justify-between gap-4 rounded-xl border border-danger-subtle-fg/30 bg-danger-subtle p-4 sm:px-5",
			),
		],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 gap-3")],
				[
					IconWarning(h, { className: "mt-0.5 size-4 shrink-0 text-danger-subtle-fg" }),
					h.div(
						[h.Class("flex min-w-0 flex-col gap-1")],
						[
							h.span([h.Class("font-semibold text-fg")], [title.replace("  ", " ")]),
							...(details.length === 0
								? []
								: [h.p([h.Class("text-fg-2 text-sm")], [details.join(" ")])]),
						],
					),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-2")],
				[
					...(billingEmail === null
						? []
						: [
								button(
									h,
									{
										intent: "outline",
										size: "xs",
										onPress: Message.PressedCopy({
											text: billingEmail,
											label: "Billing email",
										}),
									},
									[IconCopy(h, icon), "Copy billing email"],
								),
							]),
					...(stripeUrl === null ? [] : [externalLink(h, stripeUrl, "Open in Stripe")]),
				],
			),
		],
	)
}

const fact = (h: HtmlBuilder<Message>, label: string, value: Html | string) =>
	h.div(
		[h.Class("flex min-w-0 flex-col gap-0.5 px-4 py-3 sm:px-5")],
		[
			h.span([h.Class("text-muted-fg text-xs")], [label]),
			h.span([h.Class("truncate text-fg text-sm")], [value]),
		],
	)

const subscriptionCard = (
	h: HtmlBuilder<Message>,
	context: Context,
	subscription: Customers.Subscription,
	overdue: Customers.Invoice | null,
): Html => {
	const now = new Date(context.nowMs)
	const [statusLabel, statusIntent] = SUBSCRIPTION_STATUS[subscription.status]
	const date = (value: Customers.Subscription["startedAt"]) =>
		value === null ? "—" : formatDate(value, { now, withYear: true })
	return h.section(
		[
			h.Key(subscription.id),
			h.Class("flex flex-col overflow-hidden rounded-xl border border-border bg-bg"),
		],
		[
			h.header(
				[h.Class("flex items-start justify-between gap-4 p-4 sm:px-5")],
				[
					h.div(
						[h.Class("flex flex-col gap-1")],
						[
							h.span([h.Class("text-muted-fg text-xs")], ["Subscription"]),
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									h.span(
										[h.Class("font-semibold text-fg text-lg")],
										[subscription.planName ?? "Unnamed plan"],
									),
									badge(h, { intent: statusIntent }, [statusLabel]),
								],
							),
						],
					),
					h.div(
						[h.Class("flex flex-col items-end gap-0.5")],
						[
							h.span(
								[h.Class("font-semibold text-fg text-xl tabular-nums")],
								[
									formatMoney(subscription.mrrMinor, subscription.currency),
									h.span([h.Class("font-normal text-muted-fg text-xs")], [" MRR"]),
								],
							),
							h.span([h.Class("font-mono text-muted-fg text-xs")], [subscription.externalId]),
						],
					),
				],
			),
			h.div(
				[
					h.Class(
						"grid grid-cols-2 divide-border border-border border-t md:grid-cols-4 [&>*]:border-border [&>*]:border-b",
					),
				],
				[
					fact(h, "Interval", INTERVAL_LABEL[subscription.interval]),
					fact(h, "Seats", String(subscription.quantity)),
					fact(h, "Current period ends", date(subscription.currentPeriodEnd)),
					fact(
						h,
						overdue === null ? "Started" : "Amount overdue",
						overdue === null
							? date(subscription.startedAt)
							: h.span(
									[h.Class("text-danger-subtle-fg")],
									[
										formatMoney(
											overdue.amountDueMinor - overdue.amountPaidMinor,
											overdue.currency,
											{ cents: true },
										),
									],
								),
					),
					fact(h, "Cancel at period end", subscription.cancelAtPeriodEnd ? "Yes" : "No"),
					fact(
						h,
						"Payment method",
						subscription.paymentMethod?.last4
							? `${subscription.paymentMethod.brand ?? "Card"} •••• ${subscription.paymentMethod.last4}`
							: "—",
					),
					fact(h, "Trial ends", date(subscription.trialEndsAt)),
					fact(
						h,
						"Canceled",
						subscription.canceledAt === null
							? "—"
							: `${date(subscription.canceledAt)}${subscription.cancellationReason ? ` · ${subscription.cancellationReason}` : ""}`,
					),
				],
			),
		],
	)
}

/** The last value of each month (MRR is a level, not a flow). */
const monthly = (points: ReadonlyArray<Customers.SeriesPoint>): ReadonlyArray<Customers.SeriesPoint> => {
	const byMonth = new Map<string, Customers.SeriesPoint>()
	for (const point of points) byMonth.set(point.day.slice(0, 7), point)
	return [...byMonth.values()]
}

const mrrHistoryCard = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const series = Option.getOrUndefined(AsyncData.getData(model.mrrHistory))?.[0]
	const months = monthly(series?.points ?? [])
	const currency = context.account.currency
	const first = months[0]?.value ?? 0
	const last = months.at(-1)?.value ?? 0
	const change = last - first
	return card(
		h,
		{ title: "MRR history", aside: h.span([h.Class("text-muted-fg text-xs")], ["Last 12 months"]) },
		[
			AsyncData.isFailure(model.mrrHistory)
				? h.p(
						[h.Class("py-10 text-center text-muted-fg text-sm")],
						["Couldn't load the MRR history."],
					)
				: series === undefined
					? h.div([h.Class("h-48 animate-pulse rounded-lg bg-secondary/40")])
					: h.div(
							[h.Class("flex flex-wrap gap-6")],
							[
								h.div(
									[h.Class("flex w-40 flex-col gap-3")],
									[
										h.div(
											[h.Class("flex flex-col")],
											[
												h.span(
													[h.Class("text-muted-fg text-xs")],
													["Net change, 12 months"],
												),
												h.span(
													[
														h.Class(
															twMerge(
																"font-semibold text-lg tabular-nums",
																change > 0
																	? "text-success-subtle-fg"
																	: change < 0
																		? "text-danger-subtle-fg"
																		: "text-fg",
															),
														),
													],
													[
														formatMoney(change, currency, { signed: true }),
														...(first === 0
															? []
															: [` (${Math.round((change / first) * 100)}%)`]),
													],
												),
											],
										),
									],
								),
								h.div(
									[h.Class("min-w-0 flex-1")],
									[
										stackedBarChart(h, {
											ariaLabel: "MRR at the end of each month, last 12 months",
											stacks: [{ key: "mrr", label: "MRR", color: "series-1" }],
											bars: months.map((point) => ({
												tick: formatMonthShort(point.day),
												heading: formatMonthLong(point.day),
												values: { mrr: point.value },
												net: point.value,
											})),
											formatValue: (value) => formatMoney(value, currency),
											formatAxis: (value) => formatMoneyCompact(value, currency),
											hoveredIndex: model.hoveredMrr,
											onHover: (index) => Message.HoveredMrr({ index }),
											heightClass: "h-44",
										}),
									],
								),
							],
						),
		],
	)
}

const invoicesCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	detail: Customers.AccountDetail,
): Html => {
	const now = new Date(context.nowMs)
	const upcoming = detail.upcomingInvoice
	const rows = [
		...(upcoming === null ? [] : [upcoming]),
		...model.invoices.items.filter((invoice) => invoice.id !== upcoming?.id),
	]
	const date = (value: Customers.Invoice["dueAt"]) =>
		value === null ? "—" : formatDate(value, { now, withYear: true })
	const footer = pageFooter(h, {
		status: model.invoices.status,
		hasMore: model.invoices.nextCursor !== null,
		label: "Show more",
		onMore: Message.PressedMoreInvoices(),
	})
	return card(h, { title: "Invoices", count: rows.length, bodyClassName: "p-0 sm:px-0 pt-3" }, [
		dataTable(h, {
			ariaLabel: "Invoices",
			id: "customer-invoices",
			className: "rounded-none border-x-0 border-b-0",
			rows,
			rowKey: (invoice) => invoice.id,
			loadingRows:
				model.invoices.status === "Loading" && model.invoices.items.length === 0 ? 5 : undefined,
			columns: [
				{
					key: "number",
					label: "Invoice",
					widthClass: "w-32",
					cell: (invoice) =>
						invoice.status === "upcoming"
							? h.span([h.Class("text-muted-fg")], ["Upcoming"])
							: (invoice.number ?? "—"),
				},
				{
					key: "status",
					label: "Status",
					widthClass: "w-32",
					cell: (invoice) =>
						badge(h, { intent: INVOICE_STATUS[invoice.status][1] }, [
							INVOICE_STATUS[invoice.status][0],
						]),
				},
				{
					key: "amount",
					label: "Amount",
					align: "right",
					widthClass: "w-28",
					cell: (invoice) => formatMoney(invoice.amountDueMinor, invoice.currency, { cents: true }),
				},
				{
					key: "issued",
					label: "Issued",
					widthClass: "w-32",
					hideClass: "max-md:hidden",
					cell: (invoice) => date(invoice.issuedAt),
				},
				{ key: "due", label: "Due", widthClass: "w-28", cell: (invoice) => date(invoice.dueAt) },
				{
					key: "paid",
					label: "Paid",
					cell: (invoice) =>
						invoice.paidAt !== null
							? `${date(invoice.paidAt)}${invoice.attemptCount > 1 ? ` · attempt ${invoice.attemptCount}` : ""}`
							: invoice.status === "open"
								? h.span(
										[h.Class("text-danger-subtle-fg")],
										[
											`Unpaid · ${invoice.attemptCount} failed attempt${invoice.attemptCount === 1 ? "" : "s"}`,
										],
									)
								: h.span([h.Class("text-muted-fg")], ["—"]),
				},
				{
					key: "link",
					label: "",
					align: "right",
					widthClass: "w-12",
					cell: (invoice) => {
						const href = safeSourceUrl(invoice.provider, invoice.hostedUrl)
						return href === null
							? ""
							: h.a(
									[
										h.Href(href),
										h.Attribute("target", "_blank"),
										h.Attribute("rel", "noreferrer"),
										h.AriaLabel(`Open invoice ${invoice.number ?? ""}`),
										h.Class("inline-flex text-muted-fg hover:text-fg"),
									],
									[IconExternalLink(h, { className: "size-4" })],
								)
					},
				},
			],
		}),
		...(model.invoices.status === "Loaded" && rows.length === 0
			? [h.p([h.Class("py-8 text-center text-muted-fg text-sm")], ["No invoices yet."])]
			: []),
		...(footer === null ? [] : [footer]),
	])
}

export const billingTab = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => {
	const { detail } = context
	if (detail === null)
		return [h.div([h.Class("h-64 animate-pulse rounded-xl border border-border bg-secondary/30")])]
	const issue = paymentIssue(detail, context.nowMs)
	const alert = banner(h, context, detail)
	return [
		...(alert === null ? [] : [alert]),
		...(detail.subscriptions.length === 0
			? [
					h.div(
						[
							h.Class(
								"flex items-center gap-3 rounded-xl border border-border border-dashed p-4 text-muted-fg text-sm",
							),
						],
						[
							stageBadge(h, context.account.lifecycleStage),
							"No subscription from Stripe or Autumn for this customer.",
						],
					),
				]
			: detail.subscriptions.map((subscription) =>
					subscriptionCard(
						h,
						context,
						subscription,
						issue?.invoice?.subscriptionId === subscription.id ? issue.invoice : null,
					),
				)),
		mrrHistoryCard(h, model, context),
		invoicesCard(h, model, context, detail),
	]
}
