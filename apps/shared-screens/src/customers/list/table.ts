// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customers list's table (today's `web-foldkit/src/page/customers/list/table.ts` over
 * `ui/data-table.ts`): one row per account in the page's order, the picked columns, totals under
 * them and "Show more" past the page's row limit. Plain props in, the page's messages out.
 */
import * as Customers from "@hazel/domain/customers"
import type { Content, Hazel, TextTone } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { countryFlag, countryName, fundingStageLabel } from "../data/company"
import { deltaTone, formatCount, formatDeltaPct, formatMoney, formatRelative } from "../data/format"
import { accountLabelOf, nestedIdsOf } from "../data/groups"
import { AccountRow, MemberRow } from "../data/queries"
import { environmentBadge, NO_VALUE, signalCounts, stageBadge } from "../ui/badges"
import { companyLogo, personAvatar } from "../ui/identity"
import { COLUMN_LABEL, shownColumns } from "./columns"
import { countryOf, employeeRangeOf, fundingOf, industryOf } from "./filters"

/** Rows drawn at a time: thousands of rows make every keystroke slow. */
export const ROW_PAGE = 200

/** What the table draws: the page's rows and state. */
export const ListTableData = Schema.Struct({
	/** Every row the filters keep, in order; the table draws the first `rowLimit`. */
	accounts: Schema.Array(AccountRow),
	/** The accounts have not loaded yet: skeleton rows. */
	loading: Schema.Boolean,
	rowLimit: Schema.Int,
	columns: Schema.Array(Customers.ListColumn),
	sort: Customers.ViewSort,
	selected: Schema.Array(Schema.String),
	/** The keyboard row (j/k). */
	focusedId: Schema.NullOr(Schema.String),
	/** The org's reporting currency: the MRR total's. */
	currency: Schema.String,
	nowMs: Schema.Finite,
	members: Schema.Array(MemberRow),
	/** 30 days of daily active users per account id; an account without one draws no line. */
	sparklines: Schema.Record(Schema.String, Schema.Array(Schema.Finite)),
	/** The table's own width in px when the parent measures it: columns drop as today's do. */
	width: Schema.NullOr(Schema.Finite),
})
export type ListTableData = typeof ListTableData.Type

/** What a press asks the page for. */
export type ListTableHandlers<Msg> = Readonly<{
	onSort: (column: Customers.ListColumn) => Msg
	onToggleRow: (accountId: AccountRow["id"], selected: boolean) => Msg
	onToggleAll: (selected: boolean) => Msg
	onPressRow: (accountId: AccountRow["id"]) => Msg
	onShowMore: Msg
}>

export type ListTableProps<Msg> = ListTableData & ListTableHandlers<Msg>

const isColumn = (key: string): key is Customers.ListColumn =>
	Customers.ListColumn.literals.some((column) => column === key)

/** A phone keeps the name and MRR (today's container query at the table's narrowest). */
const ALWAYS_SHOWN: ReadonlyArray<Customers.ListColumn> = ["name", "mrr"]

/** Today's right-aligned columns. */
const END_ALIGNED: ReadonlyArray<Customers.ListColumn> = [
	"mrr",
	"active_users_30d",
	"usage_trend",
	"last_active",
	"customer_since",
	"company_size",
]

/**
 * Today's container queries (`COLUMN_LAYOUT`): below this table width a column drops, so the
 * table never runs off its frame until every picked column fits; a phone keeps name and MRR.
 */
const DROP_BELOW_PX: Readonly<Partial<Record<Customers.ListColumn, number>>> = {
	owner: 1024,
	stage: 672,
	plan: 768,
	active_users_30d: 1280,
	usage_trend: 1024,
	last_active: 896,
	open_signals: 1152,
	customer_since: 1376,
	tags: 1536,
	industry: 1152,
	company_size: 1024,
	headquarters: 1152,
	funding: 1152,
}

// HAZEL-GAP(pk4a-table-column-drop): today each column drops by the table's own width (a container query); `table` has no such option, so the parent measures the width and the dropped columns are left out.
/** The shown columns that fit `width` (all of them while it is unknown). */
export const fittingColumns = (
	columns: ReadonlyArray<Customers.ListColumn>,
	width: number | null,
): ReadonlyArray<Customers.ListColumn> =>
	shownColumns(columns).filter((column) => width === null || width >= (DROP_BELOW_PX[column] ?? 0))

export const tableColumnsOf = (
	columns: ReadonlyArray<Customers.ListColumn>,
): ReadonlyArray<Content.TableColumn> =>
	columns.map((column) => ({
		key: column,
		label: COLUMN_LABEL[column],
		sortable: true,
		align: END_ALIGNED.includes(column) ? "end" : "start",
		// Beside the `fill` name every other column takes its content's width, as today's `w-*` do.
		width: column === "name" ? "fill" : "auto",
		optional: !ALWAYS_SHOWN.includes(column),
	}))

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })

/** `Jonas O.` */
export const shortName = (name: string): string => {
	const [first = name, ...rest] = name.split(" ")
	const last = rest.at(-1)
	return last === undefined ? first : `${first} ${last[0]}.`
}

type H<Msg> = Hazel.H<Msg>

/** Today's cells are `text-sm` at every size: the `label` step, not `body`. */
const cellText = <Msg>(h: H<Msg>) => h.text.role("label")
const muted = <Msg>(h: H<Msg>, text: string) => cellText(h).tone("muted").children(text)
const none = <Msg>(h: H<Msg>) => muted(h, NO_VALUE)
// HAZEL-GAP(pk4a-cell-max-width): today owner, plan, industry, HQ and funding truncate at 160px (`max-w-40`); an `auto` column takes a truncating text's ellipsis width, so they show in full.
const plain = <Msg>(h: H<Msg>, text: string | null) => (text === null ? none(h) : cellText(h).children(text))

const TREND_TONE = { positive: "success", negative: "danger", neutral: "muted" } as const satisfies Record<
	string,
	TextTone
>

/** The name, its environment and domain, after its logo; an environment sits under its primary. */
const nameCell = <Msg>(h: H<Msg>, account: AccountRow, isNested: boolean) =>
	// HAZEL-GAP(pk4a-nested-row): today an environment row is indented behind an elbow line and its name is regular weight; a table cell has no nesting, so it only takes the smaller logo.
	// HAZEL-GAP(pk4a-name-link): today the name is a link (hover underline, Cmd-click opens a tab); a cell link is accent-coloured, so the name is text and the row press opens the customer.
	h.stack
		.axis("horizontal")
		// Today's `gap-3` (`gap-2.5` for an environment).
		.density("cozy")
		.align("center")
		.children(
			companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: isNested ? "xs" : "sm" }),
			h.stack.density("none").children(
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.children(
						cellText(h).strong(!isNested).truncate().children(account.name),
						account.environment === null ? null : environmentBadge(h, account.environment),
					),
				account.domain === null
					? null
					: h.text.role("caption").tone("muted").truncate().children(account.domain),
			),
		)

const headquartersCell = <Msg>(h: H<Msg>, account: AccountRow) => {
	const company = account.company
	const place = company === null ? null : (company.headquarters?.city ?? countryName(company))
	if (company === null || place === null) return none(h)
	const flag = countryFlag(countryOf(account))
	return cellText(h).children(flag === "" ? place : `${flag} ${place}`)
}

const cellOf = <Msg>(
	h: H<Msg>,
	column: Customers.ListColumn,
	account: AccountRow,
	props: ListTableData,
	context: Readonly<{ membersById: ReadonlyMap<string, MemberRow>; nestedIds: ReadonlySet<string> }>,
) => {
	switch (column) {
		case "name":
			return nameCell(h, account, context.nestedIds.has(account.id))
		case "owner": {
			const owner =
				account.ownerUserId === null ? null : (context.membersById.get(account.ownerUserId) ?? null)
			return h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					personAvatar(h, owner),
					cellText(h)
						.tone(owner === null ? "muted" : "default")
						.children(owner === null ? "Unassigned" : shortName(owner.name)),
				)
		}
		case "stage":
			// A horizontal stack keeps the badge at its own width (a cell stretches its child).
			return h.stack.axis("horizontal").children(stageBadge(h, account.lifecycleStage))
		case "plan":
			return plain(h, account.planName)
		case "mrr":
			return account.mrrMinor === 0 && account.lifecycleStage === "lead"
				? none(h)
				: cellText(h)
						.numeric()
						.strong(account.mrrMinor !== 0)
						.tone(account.mrrMinor === 0 ? "muted" : "default")
						.children(formatMoney(account.mrrMinor, account.currency))
		case "active_users_30d": {
			const values = props.sparklines[account.id]
			// HAZEL-GAP(sparkline-marks): today's cell line is 48px wide (`w-12`); `small` is the bare line at its own width.
			return h.stack
				.axis("horizontal")
				.density("relaxed")
				.align("center")
				.children(
					values === undefined
						? null
						: h.chart
								.kind("sparkline")
								.size("small")
								.label(`${accountLabelOf(account)}: daily active users, last 30 days`)
								.series([{ key: "active", label: "Active users", tone: "neutral", values }]),
					cellText(h).numeric().children(formatCount(account.activeUsers30d)),
				)
		}
		case "usage_trend": {
			const trend = account.activeUsersTrendPct
			if (trend === null) return none(h)
			const rounded = Math.round(trend)
			return cellText(h)
				.numeric()
				.tone(TREND_TONE[Math.abs(rounded) < 5 ? "neutral" : deltaTone(rounded)])
				.children(formatDeltaPct(rounded))
		}
		case "last_active":
			return muted(
				h,
				account.lastActiveAtMs === null
					? "Never"
					: formatRelative(new Date(account.lastActiveAtMs), new Date(props.nowMs)),
			)
		case "open_signals":
			return signalCounts(h, {
				high: account.openRiskHigh,
				medium: account.openRiskMedium,
				low: account.openRiskLow,
				opportunities: account.openOpportunities,
			})
		case "customer_since":
			return muted(h, monthYear.format(account.firstSeenAtMs))
		case "tags":
			return account.tags.length === 0
				? none(h)
				: h.stack
						.axis("horizontal")
						.density("tight")
						.wrap()
						.children(...account.tags.map((tag) => h.badge.style("quiet").label(tag)))
		case "industry":
			return plain(h, industryOf(account))
		case "company_size": {
			const range = employeeRangeOf(account)
			return range === null ? none(h) : cellText(h).children(Customers.EMPLOYEE_RANGE_LABEL[range])
		}
		case "headquarters":
			return headquartersCell(h, account)
		case "funding": {
			const stage = fundingOf(account)
			return plain(h, stage === null ? null : fundingStageLabel(stage))
		}
	}
}

/** Totals over every kept row (not only the drawn ones); none under an empty table. */
const footerCell = <Msg>(h: H<Msg>, column: Customers.ListColumn, props: ListTableData) => {
	const { accounts } = props
	switch (column) {
		case "name":
			// HAZEL-GAP(p4-inline-text): today the count is bold inside "12 customers"; the footer row is strong throughout.
			return cellText(h)
				.numeric()
				.children(`${formatCount(accounts.length)} customers`)
		case "mrr":
			return cellText(h)
				.numeric()
				.children(
					formatMoney(
						accounts.reduce((sum, account) => sum + account.mrrMinor, 0),
						props.currency,
					),
				)
		case "active_users_30d":
			return cellText(h)
				.numeric()
				.children(formatCount(accounts.reduce((sum, account) => sum + account.activeUsers30d, 0)))
		default:
			return null
	}
}

/** The table, its footer, and "Showing 200 of 950 · Show 200 more" past the row limit. */
export const listTable = <Msg>(h: H<Msg>, props: ListTableProps<Msg>) => {
	const columns = fittingColumns(props.columns, props.width)
	const selected = new Set(props.selected)
	const membersById = new Map(props.members.map((member) => [member.id as string, member]))
	const drawn = props.accounts.slice(0, props.rowLimit)
	const context = { membersById, nestedIds: nestedIdsOf(drawn) }
	const rows = drawn.map((account) =>
		h.tableRow
			.key(account.id)
			.title(accountLabelOf(account))
			.selected(selected.has(account.id))
			.current(props.focusedId === account.id)
			.on("press", () => props.onPressRow(account.id))
			.on("select", ({ selected: isSelected }) => props.onToggleRow(account.id, isSelected))
			.children(
				...columns.map((column) =>
					h.tableCell.column(column).children(cellOf(h, column, account, props, context)),
				),
			),
	)
	const footer =
		props.loading || props.accounts.length === 0
			? null
			: h.tableRow
					.key("footer")
					.footer()
					.children(
						...columns.map((column) =>
							h.tableCell.column(column).children(footerCell(h, column, props)),
						),
					)
	const table = h.table
		.label("Customers")
		// Today's frame drops its side edges and corners: the hairlines above and below (`table-frame`).
		.frame("band")
		.columns(tableColumnsOf(columns))
		.sort({
			column: props.sort.column,
			direction: props.sort.direction === "asc" ? "ascending" : "descending",
		})
		.selectable()
		.stickyHeader()
		.loading(props.loading)
		.loadingRows(12)
		.on("sort", ({ column }) => props.onSort(isColumn(column) ? column : props.sort.column))
		.on("selectAll", ({ selected: isSelected }) => props.onToggleAll(isSelected))
		.children(...rows, footer)
	const hiddenRows = props.accounts.length - props.rowLimit
	return hiddenRows <= 0
		? table
		: h.stack.children(
				table,
				h.stack
					.axis("horizontal")
					.align("center")
					.density("relaxed")
					.children(
						h.spacer,
						muted(
							h,
							`Showing ${formatCount(props.rowLimit)} of ${formatCount(props.accounts.length)}`,
						),
						h.button
							.label(`Show ${formatCount(Math.min(ROW_PAGE, hiddenRows))} more`)
							.variant("outline")
							.size("small")
							.on("press", props.onShowMore),
						h.spacer,
					),
			)
}
