import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"

/**
 * The Support report (`docs/customers/sla.md` §4): first response and resolution times, % within
 * SLA and breaches for the issues opened in a range, by day, by account and by policy.
 */

export const Report = AsyncData.Schema(Customers.SupportReport, CommonReason)
export type Report = typeof Report.schema.Type

/** What the daily chart plots: the median first response, or the share answered within target. */
export const DailyChart = Schema.Literals(["median", "within"])
export type DailyChart = typeof DailyChart.Type

export const Model = Schema.Struct({
	range: Customers.CustomersRange,
	/** `customers.support.report` for `range`; kept while another range loads. */
	report: Report.schema,
	chart: DailyChart,
	hoveredDay: Schema.NullOr(Schema.Int),
})
export type Model = typeof Model.Type

/** Nothing opened under an SLA in the range, and nothing overdue from before it. */
export const isEmptyReport = (report: Customers.SupportReport): boolean =>
	report.issues === 0 && report.overdueNow === 0
