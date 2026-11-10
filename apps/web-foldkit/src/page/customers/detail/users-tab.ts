import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { distributionBar } from "../../../customers/charts/distribution"
import { formatCount, formatDate, formatRelative } from "../../../customers/format"
import { msOf } from "../../../customers/queries"
import { dataTable } from "../../../customers/ui/data-table"
import { searchBox, segmented } from "../../../customers/ui/filter-bar"
import { personAvatar } from "../../../customers/ui/identity"
import { IconCopy, IconStar, IconWarning } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { Message } from "./message"
import { type ContactFilter, contactCounts, type Model, visibleContacts } from "./model"
import { type Context, icon, pageFooter } from "./parts"

/** The users tab: who uses the product, who went quiet, who never started. */

const DAY_MS = 86_400_000

const STATUS = {
	active: ["Active", "success", "seen in the last 30 days", "bg-health-healthy"],
	dormant: ["Dormant", "warning", "not seen for 30+ days", "bg-health-at-risk"],
	never_active: ["Never active", "secondary", "joined, no product activity", "bg-health-unknown"],
} as const satisfies Record<Customers.ContactActivityStatus, readonly [string, string, string, string]>

/** 30 days of activity as cells: brighter is more events that day. */
const heatStrip = (h: HtmlBuilder<Message>, row: Customers.ContactRow): Html => {
	const values = row.activity.map((point) => point.value)
	const max = Math.max(1, ...values)
	return h.span(
		[
			h.Role("img"),
			h.AriaLabel(`Active ${values.filter((value) => value > 0).length} of the last 30 days`),
			h.Class("inline-flex h-4 items-stretch gap-px"),
		],
		values.map((value) =>
			h.span([
				h.Class(
					twMerge("block w-1 rounded-[1px]", value === 0 ? "bg-secondary" : "bg-chart-series-1"),
				),
				...(value === 0 ? [] : [h.Style({ opacity: String(0.35 + (0.65 * value) / max) })]),
			]),
		),
	)
}

const summary = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const counts = contactCounts(model)
	const { account } = context
	return h.div(
		[h.Class("flex flex-wrap items-center gap-6 rounded-xl border border-border bg-bg p-4 sm:px-5")],
		[
			h.div(
				[h.Class("flex flex-col")],
				[
					h.span([h.Class("text-muted-fg text-xs")], ["Users"]),
					h.span(
						[h.Class("font-semibold text-2xl text-fg tabular-nums")],
						[formatCount(account.contactCount)],
					),
				],
			),
			h.div(
				[h.Class("flex min-w-64 flex-1 flex-col gap-2")],
				[
					distributionBar(h, {
						ariaLabel: "Users by activity",
						segments: (["active", "dormant", "never_active"] as const).map((status) => ({
							key: status,
							label: STATUS[status][0],
							value: counts[status],
							fillClass: STATUS[status][3],
						})),
					}),
					h.div(
						[h.Class("flex flex-wrap gap-x-4 gap-y-1 text-xs")],
						(["active", "dormant", "never_active"] as const).map((status) =>
							h.span(
								[h.Class("inline-flex items-center gap-1.5")],
								[
									h.span([h.Class(twMerge("size-1.5 rounded-full", STATUS[status][3]))]),
									h.span(
										[h.Class("font-medium text-fg")],
										[`${counts[status]} ${STATUS[status][0].toLowerCase()}`],
									),
									h.span([h.Class("text-muted-fg")], [STATUS[status][2]]),
								],
							),
						),
					),
				],
			),
			...(account.seatsLimit === null
				? []
				: [
						h.div(
							[h.Class("flex flex-col items-end")],
							[
								h.span([h.Class("text-muted-fg text-xs")], ["Seats"]),
								h.span(
									[h.Class("font-medium text-fg tabular-nums")],
									[
										`${formatCount(account.seatsUsed ?? 0)} of ${formatCount(account.seatsLimit)} used`,
									],
								),
							],
						),
					]),
		],
	)
}

/** The champion went quiet: who, since when, and how to reach them. */
const championCallout = (h: HtmlBuilder<Message>, model: Model, context: Context): Html | null => {
	const account = context.detail?.account
	if (account === undefined || account.championContactId === null || account.championInactiveSince === null)
		return null
	const champion =
		[...model.contacts.items, ...(context.detail?.contactsToReach ?? [])].find(
			(row) => row.contact.id === account.championContactId,
		)?.contact ?? null
	const since = msOf(account.championInactiveSince)
	const days = Math.floor((context.nowMs - since) / DAY_MS)
	const name = champion?.name ?? champion?.email ?? "Your champion"
	return h.div(
		[
			h.Role("status"),
			h.Class(
				"flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-subtle px-4 py-3 sm:px-5",
			),
		],
		[
			h.p(
				[h.Class("flex min-w-0 flex-1 items-start gap-2 text-sm text-warning-subtle-fg")],
				[
					IconWarning(h, { className: "mt-0.5 size-4 shrink-0" }),
					h.span(
						[],
						[
							h.span([h.Class("font-semibold")], ["Your champion went quiet. "]),
							`${name} was the most active user before ${formatDate(new Date(since), { now: new Date(context.nowMs) })} and has not been seen for ${days} day${days === 1 ? "" : "s"}.`,
						],
					),
				],
			),
			...(champion?.email
				? [
						button(
							h,
							{
								intent: "outline",
								size: "xs",
								onPress: Message.PressedCopy({ text: champion.email, label: "Email" }),
							},
							[IconCopy(h, icon), "Copy email"],
						),
					]
				: []),
		],
	)
}

const FILTER_LABEL = {
	all: "All",
	active: "Active",
	dormant: "Dormant",
	never_active: "Never active",
} as const satisfies Record<ContactFilter, string>

const lastSeen = (h: HtmlBuilder<Message>, contact: Customers.Contact, nowMs: number): Html => {
	const now = new Date(nowMs)
	if (contact.lastSeenAt === null)
		return h.div(
			[h.Class("flex flex-col")],
			[
				h.span([h.Class("text-fg")], ["Never"]),
				...(contact.joinedAt === null
					? []
					: [
							h.span(
								[h.Class("text-muted-fg text-xs")],
								[`Joined ${formatDate(contact.joinedAt, { now })}`],
							),
						]),
			],
		)
	return h.div(
		[h.Class("flex flex-col")],
		[
			h.span([h.Class("text-fg")], [formatRelative(contact.lastSeenAt, now)]),
			h.span([h.Class("text-muted-fg text-xs")], [formatDate(contact.lastSeenAt, { now })]),
		],
	)
}

export const usersTab = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => {
	const counts = contactCounts(model)
	const rows = visibleContacts(model)
	const championId = context.detail?.account.championContactId ?? null
	const callout = championCallout(h, model, context)
	const footer = pageFooter(h, {
		status: model.contacts.status,
		hasMore: model.contacts.nextCursor !== null,
		label: "Load more users",
		onMore: Message.PressedMoreContacts(),
		summary: `${formatCount(model.contacts.items.length)} of ${formatCount(context.account.contactCount)} users`,
	})
	return [
		summary(h, model, context),
		...(callout === null ? [] : [callout]),
		h.div(
			[h.Class("flex flex-wrap items-center gap-2")],
			[
				searchBox(h, {
					id: "customer-users-search",
					value: model.contactSearch,
					placeholder: "Search name or email…",
					onInput: (value) => Message.ChangedContactSearch({ value }),
					onClear: Message.ClearedContactSearch(),
				}),
				segmented(h, {
					ariaLabel: "Users by status",
					segments: (["all", "active", "dormant", "never_active"] as const).map((filter) => ({
						key: filter,
						label: `${FILTER_LABEL[filter]} ${counts[filter]}`,
					})),
					selected: model.contactFilter,
					onSelect: (filter) => Message.ClickedContactFilter({ filter }),
				}),
			],
		),
		h.div(
			[h.Class("flex flex-col overflow-hidden rounded-xl border border-border")],
			[
				dataTable(h, {
					ariaLabel: "Users",
					id: "customer-users",
					className: "rounded-none border-0",
					rows,
					rowKey: (row) => row.contact.id,
					...(model.contacts.status === "Loading" && model.contacts.items.length === 0
						? { loadingRows: 8 }
						: {}),
					columns: [
						{
							key: "user",
							label: "User",
							cell: (row) =>
								h.div(
									[h.Class("flex min-w-0 items-center gap-3")],
									[
										personAvatar(
											h,
											{
												name: row.contact.name ?? row.contact.email ?? "?",
												avatarUrl: row.contact.avatarUrl,
											},
											{ size: "md" },
										),
										h.div(
											[h.Class("flex min-w-0 flex-col")],
											[
												h.span(
													[
														h.Class(
															"flex items-center gap-2 truncate font-medium text-fg",
														),
													],
													[
														row.contact.name ?? row.contact.email ?? "Unknown",
														...(row.contact.id === championId
															? [
																	badge(
																		h,
																		{
																			intent: "warning",
																			className: "gap-x-1",
																		},
																		[
																			IconStar(h, {
																				className: "size-3",
																			}),
																			"Champion",
																		],
																	),
																]
															: []),
													],
												),
												...(row.contact.title === null
													? []
													: [
															h.span(
																[h.Class("truncate text-muted-fg text-xs")],
																[row.contact.title],
															),
														]),
											],
										),
									],
								),
						},
						{
							key: "email",
							label: "Email",
							hideClass: "max-md:hidden",
							cell: (row) => row.contact.email ?? "—",
						},
						{
							key: "role",
							label: "Role",
							widthClass: "w-24",
							hideClass: "max-lg:hidden",
							cell: (row) => row.contact.role ?? "—",
						},
						{
							key: "status",
							label: "Status",
							widthClass: "w-32",
							cell: (row) =>
								badge(h, { intent: STATUS[row.status][1] }, [STATUS[row.status][0]]),
						},
						{
							key: "seen",
							label: "Last seen",
							widthClass: "w-32",
							cell: (row) => lastSeen(h, row.contact, context.nowMs),
						},
						{
							key: "signins",
							label: "Sign-ins 30d",
							align: "right",
							widthClass: "w-28",
							cell: (row) => formatCount(row.contact.signInCount30d),
						},
						{
							key: "activity",
							label: "Activity, last 30 days",
							widthClass: "w-48",
							hideClass: "max-xl:hidden",
							cell: (row) => heatStrip(h, row),
						},
					],
				}),
				...(model.contacts.status === "Loaded" && rows.length === 0
					? [h.p([h.Class("py-10 text-center text-muted-fg text-sm")], ["No user matches."])]
					: []),
				...(footer === null ? [] : [footer]),
			],
		),
	]
}
