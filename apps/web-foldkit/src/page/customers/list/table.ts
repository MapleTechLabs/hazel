import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { sparkline } from "../../../customers/charts/sparkline"
import {
	deltaTone,
	formatCount,
	formatDeltaPct,
	formatMajor,
	formatMoney,
	formatRelative,
} from "../../../customers/format"
import type { AccountRow, MemberRow } from "../../../customers/queries"
import {
	HEALTH_LABEL,
	healthBadge,
	STAGE_LABEL,
	signalCounts,
	stageBadge,
} from "../../../customers/ui/badges"
import type { Column } from "../../../customers/ui/data-table"
import { primaryCell } from "../../../customers/ui/data-table"
import { companyLogo, personAvatar } from "../../../customers/ui/identity"
import { customerRoute, hrefOf } from "../../../route"
import { COLUMN_LABEL } from "./model"

/** The table's columns: each one's cell, footer and CSV value. */

export interface TableContext {
	readonly orgSlug: string
	/** The org's reporting currency: the MRR total's. */
	readonly currency: string
	readonly nowMs: number
	readonly membersById: ReadonlyMap<string, MemberRow>
	readonly sparklines: Readonly<Record<string, ReadonlyArray<number>>>
	/** Wraps the name cell: the hover card's anchor. */
	readonly nameCell: (account: AccountRow, cell: Html) => Html
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })

/** `Jonas O.` */
export const shortName = (name: string): string => {
	const [first = name, ...rest] = name.split(" ")
	const last = rest.at(-1)
	return last === undefined ? first : `${first} ${last[0]}.`
}

const muted = <M>(h: HtmlBuilder<M>, text: string) => h.span([h.Class("text-muted-fg")], [text])

const TREND_CLASS = {
	positive: "text-success-subtle-fg",
	negative: "text-danger-subtle-fg",
	neutral: "text-muted-fg",
} as const

const lastActive = (account: AccountRow, nowMs: number) =>
	account.lastActiveAtMs === null
		? "Never"
		: formatRelative(new Date(account.lastActiveAtMs), new Date(nowMs))

/** A column's text for the CSV export. */
export const csvValue = (
	column: Customers.ListColumn,
	account: AccountRow,
	context: Pick<TableContext, "membersById" | "nowMs">,
): string => {
	switch (column) {
		case "name":
			return account.name
		case "owner":
			return account.ownerUserId === null
				? ""
				: (context.membersById.get(account.ownerUserId)?.name ?? "")
		case "stage":
			return STAGE_LABEL[account.lifecycleStage]
		case "plan":
			return account.planName ?? ""
		case "mrr":
			return formatMajor(account.mrrMinor, account.currency)
		case "health":
			return account.healthStatus === "unknown"
				? HEALTH_LABEL.unknown
				: `${HEALTH_LABEL[account.healthStatus]} ${account.healthScore ?? ""}`.trim()
		case "active_users_30d":
			return String(account.activeUsers30d)
		case "usage_trend":
			return account.activeUsersTrendPct === null ? "" : `${Math.round(account.activeUsersTrendPct)}%`
		case "last_active":
			return account.lastActiveAtMs === null ? "" : new Date(account.lastActiveAtMs).toISOString()
		case "open_signals":
			return String(
				account.openRiskHigh +
					account.openRiskMedium +
					account.openRiskLow +
					account.openOpportunities,
			)
		case "customer_since":
			return account.customerSinceMs === null
				? ""
				: new Date(account.customerSinceMs).toISOString().slice(0, 10)
		case "tags":
			return account.tags.join("; ")
	}
}

/** A spreadsheet runs a cell starting with one of these as a formula; plain numbers stay numbers. */
const FORMULA_START = /^[=+\-@\t\r]/
const NUMBER = /^-?\d+(\.\d+)?%?$/

const escapeCsv = (raw: string) => {
	const value = FORMULA_START.test(raw) && !NUMBER.test(raw) ? `'${raw}` : raw
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** The rows as CSV, one column per shown column (plus the domain after the name). */
export const toCsv = (
	accounts: ReadonlyArray<AccountRow>,
	columns: ReadonlyArray<Customers.ListColumn>,
	context: Pick<TableContext, "membersById" | "nowMs">,
): string => {
	const header = columns.flatMap((column) =>
		column === "name" ? ["Customer", "Domain"] : [COLUMN_LABEL[column]],
	)
	const rows = accounts.map((account) =>
		columns.flatMap((column) =>
			column === "name" ? [account.name, account.domain ?? ""] : [csvValue(column, account, context)],
		),
	)
	return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n")
}

/** Footer totals over the filtered rows. */
const footerOf = <M>(
	h: HtmlBuilder<M>,
	column: Customers.ListColumn,
	accounts: ReadonlyArray<AccountRow>,
	currency: string,
): Html | string | undefined => {
	switch (column) {
		case "name":
			return h.span(
				[],
				[h.span([h.Class("font-semibold")], [formatCount(accounts.length)]), muted(h, " customers")],
			)
		case "mrr":
			return formatMoney(
				accounts.reduce((sum, account) => sum + account.mrrMinor, 0),
				currency,
			)
		case "health": {
			const scored = accounts.filter(
				(account) => account.healthStatus !== "unknown" && account.healthScore !== null,
			)
			return scored.length === 0
				? undefined
				: h.span(
						[],
						[
							muted(h, "Avg "),
							String(
								Math.round(
									scored.reduce((sum, account) => sum + (account.healthScore ?? 0), 0) /
										scored.length,
								),
							),
						],
					)
		}
		case "active_users_30d":
			return formatCount(accounts.reduce((sum, account) => sum + account.activeUsers30d, 0))
		default:
			return undefined
	}
}

const cellOf = <M>(
	h: HtmlBuilder<M>,
	column: Customers.ListColumn,
	account: AccountRow,
	context: TableContext,
): Html | string => {
	switch (column) {
		case "name":
			return context.nameCell(
				account,
				primaryCell(h, {
					leading: companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
					title: account.name,
					subtitle: account.domain,
					href: hrefOf(customerRoute(context.orgSlug, account.id)),
				}),
			)
		case "owner": {
			const owner =
				account.ownerUserId === null ? null : (context.membersById.get(account.ownerUserId) ?? null)
			return h.span(
				[h.Class("inline-flex min-w-0 items-center gap-2")],
				[
					personAvatar(h, owner),
					h.span(
						[h.Class(twMerge("truncate", owner === null && "text-muted-fg"))],
						[owner === null ? "Unassigned" : shortName(owner.name)],
					),
				],
			)
		}
		case "stage":
			return stageBadge(h, account.lifecycleStage, { className: "whitespace-nowrap" })
		case "plan":
			return account.planName ?? muted(h, "—")
		case "mrr":
			return account.mrrMinor === 0 && account.lifecycleStage === "lead"
				? muted(h, "—")
				: h.span(
						[h.Class(account.mrrMinor === 0 ? "text-muted-fg" : "font-medium")],
						[formatMoney(account.mrrMinor, account.currency)],
					)
		case "health":
			return account.lifecycleStage === "churned"
				? muted(h, "—")
				: healthBadge(h, { status: account.healthStatus, score: account.healthScore })
		case "active_users_30d": {
			const values = context.sparklines[account.id]
			return h.span(
				[h.Class("inline-flex items-center justify-end gap-3")],
				[
					values === undefined
						? h.span([h.Class("h-6 w-12")])
						: sparkline(h, {
								values,
								className: "w-12",
								ariaLabel: `${account.name}: daily active users, last 30 days`,
							}),
					h.span([h.Class("w-8 text-right")], [formatCount(account.activeUsers30d)]),
				],
			)
		}
		case "usage_trend": {
			const trend = account.activeUsersTrendPct
			if (trend === null) return muted(h, "—")
			const rounded = Math.round(trend)
			return h.span(
				[h.Class(TREND_CLASS[Math.abs(rounded) < 5 ? "neutral" : deltaTone(rounded)])],
				[formatDeltaPct(rounded)],
			)
		}
		case "last_active":
			return h.span([h.Class("text-muted-fg")], [lastActive(account, context.nowMs)])
		case "open_signals":
			return signalCounts(h, {
				high: account.openRiskHigh,
				medium: account.openRiskMedium,
				low: account.openRiskLow,
				opportunities: account.openOpportunities,
			})
		case "customer_since":
			return account.customerSinceMs === null
				? muted(h, "—")
				: h.span([h.Class("text-muted-fg")], [monthYear.format(account.customerSinceMs)])
		case "tags":
			return account.tags.length === 0
				? muted(h, "—")
				: h.span(
						[h.Class("flex flex-wrap gap-1")],
						account.tags.map((tag) =>
							h.span(
								[h.Class("rounded bg-secondary px-1.5 py-0.5 text-secondary-fg text-xs")],
								[tag],
							),
						),
					)
	}
}

/** A phone keeps name, MRR and health (and whatever wide-only column was picked scrolls sideways). */
const COLUMN_LAYOUT = {
	name: { widthClass: "min-w-44 max-md:min-w-36" },
	owner: { widthClass: "w-28", hideClass: "max-lg:hidden" },
	stage: { widthClass: "w-24", hideClass: "max-md:hidden" },
	plan: { widthClass: "w-18", hideClass: "max-md:hidden" },
	mrr: { align: "right", widthClass: "w-20" },
	health: { widthClass: "w-28" },
	active_users_30d: { align: "right", widthClass: "w-28", hideClass: "max-xl:hidden" },
	usage_trend: { align: "right", widthClass: "w-16", hideClass: "max-lg:hidden" },
	last_active: { align: "right", widthClass: "w-22", hideClass: "max-md:hidden" },
	open_signals: { widthClass: "w-22", hideClass: "max-lg:hidden" },
	customer_since: { align: "right", widthClass: "w-22", hideClass: "max-xl:hidden" },
	tags: { widthClass: "w-40", hideClass: "max-xl:hidden" },
} satisfies Record<
	Customers.ListColumn,
	Readonly<{ align?: "right"; widthClass?: string; hideClass?: string }>
>

export const tableColumns = <M>(
	h: HtmlBuilder<M>,
	columns: ReadonlyArray<Customers.ListColumn>,
	accounts: ReadonlyArray<AccountRow>,
	context: TableContext,
): ReadonlyArray<Column<AccountRow, Customers.ListColumn>> =>
	columns.map((column) => ({
		key: column,
		label: COLUMN_LABEL[column],
		sortable: true,
		...COLUMN_LAYOUT[column],
		cell: (account) => cellOf(h, column, account, context),
		footer: footerOf(h, column, accounts, context.currency),
	}))
