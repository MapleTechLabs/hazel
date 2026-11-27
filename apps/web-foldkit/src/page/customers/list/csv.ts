import * as Customers from "@hazel/domain/customers"
import { employeeRangeOf, fundingOf, industryOf } from "@hazel/shared-screens/customers/list/filters"
import { COLUMN_LABEL } from "@hazel/shared-screens/customers/list/columns"
import { fundingStageLabel, headquartersLabel } from "../../../customers/company"
import { formatMajor } from "../../../customers/format"
import type { AccountRow, MemberRow } from "../../../customers/queries"
import { STAGE_LABEL } from "../../../customers/ui/badges"

/** The list's CSV export: each shown column's text per account. */

interface CsvContext {
	readonly membersById: ReadonlyMap<string, MemberRow>
	readonly nowMs: number
}

/** A column's text for the CSV export. */
export const csvValue = (column: Customers.ListColumn, account: AccountRow, context: CsvContext): string => {
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
			return new Date(account.firstSeenAtMs).toISOString().slice(0, 10)
		case "tags":
			return account.tags.join("; ")
		case "industry":
			return industryOf(account) ?? ""
		case "company_size": {
			const range = employeeRangeOf(account)
			return range === null ? "" : Customers.EMPLOYEE_RANGE_LABEL[range]
		}
		case "headquarters":
			return account.company === null ? "" : (headquartersLabel(account.company) ?? "")
		case "funding": {
			const stage = fundingOf(account)
			return stage === null ? "" : fundingStageLabel(stage)
		}
	}
}

/** A spreadsheet runs a cell starting with one of these as a formula; plain numbers stay numbers. */
const FORMULA_START = /^[=+\-@\t\r]/
const NUMBER = /^-?\d+(\.\d+)?%?$/

const escapeCsv = (raw: string) => {
	const value = FORMULA_START.test(raw) && !NUMBER.test(raw) ? `'${raw}` : raw
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** The rows as CSV, one column per shown column (plus the domain and environment after the name). */
export const toCsv = (
	accounts: ReadonlyArray<AccountRow>,
	columns: ReadonlyArray<Customers.ListColumn>,
	context: CsvContext,
): string => {
	const header = columns.flatMap((column) =>
		column === "name" ? ["Customer", "Domain", "Environment"] : [COLUMN_LABEL[column]],
	)
	const rows = accounts.map((account) =>
		columns.flatMap((column) =>
			column === "name"
				? [account.name, account.domain ?? "", account.environment ?? ""]
				: [csvValue(column, account, context)],
		),
	)
	return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n")
}
