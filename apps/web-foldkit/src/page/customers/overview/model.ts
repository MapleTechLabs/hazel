import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, SettingsSummary, SignalRow } from "../../../customers/queries"

/** The Customers overview (`docs/customers/spec.md` §1): KPIs, charts and lists over a range. */

export const Overview = AsyncData.Schema(Customers.OverviewResult, CommonReason)
export type Overview = typeof Overview.schema.Type

export const HealthMetric = Schema.Literals(["customers", "mrr"])
export const Chart = Schema.Literals(["mrr", "activeUsers"])
export type Chart = typeof Chart.Type

export const Model = Schema.Struct({
	range: Customers.CustomersRange,
	/** Show each KPI's change against the previous period of the same length. */
	isComparing: Schema.Boolean,
	/** `customers.overview` for `range`; kept while another range loads. */
	overview: Overview.schema,
	healthMetric: HealthMetric,
	hoveredMrr: Schema.NullOr(Schema.Int),
	hoveredActiveUsers: Schema.NullOr(Schema.Int),
	/** Live rows; null until each query answers. */
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	connectedProviders: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	settings: Schema.NullOr(SettingsSummary),
})
export type Model = typeof Model.Type

/** No source connected yet: the setup cards instead of the dashboard. */
export const isUnconnected = (model: Model): boolean =>
	model.connectedProviders !== null && model.connectedProviders.length === 0

const RANGE_DAYS = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"12m": 365,
} as const satisfies Record<Customers.CustomersRange, number>
export const rangeDaysOf = (range: Customers.CustomersRange): number => RANGE_DAYS[range]

/** The previous period of the same length, ending where the range starts. */
export const previousPeriodOf = (
	range: Customers.CustomersRange,
	nowMs: number,
): Readonly<{ startMs: number; endMs: number }> => {
	const days = RANGE_DAYS[range] * 86_400_000
	return { startMs: nowMs - 2 * days, endMs: nowMs - days }
}

/** The queue preview: open signals, highest priority first. */
export const topOpenSignals = (model: Model, count: number): ReadonlyArray<typeof SignalRow.Type> =>
	(model.signals ?? []).filter((signal) => signal.status === "open").slice(0, count)

/** Accounts first seen in the range (partial state: no billing to say who started paying). */
export const newAccounts = (
	model: Model,
	nowMs: number,
	count: number,
): ReadonlyArray<typeof AccountRow.Type> =>
	(model.accounts ?? [])
		.filter((account) => account.firstSeenAtMs >= nowMs - rangeDaysOf(model.range) * 86_400_000)
		.sort((left, right) => right.firstSeenAtMs - left.firstSeenAtMs)
		.slice(0, count)

/** Accounts that were active and have gone quiet for two weeks (partial state's churn proxy). */
export const QUIET_AFTER_DAYS = 14
export const quietAccounts = (
	model: Model,
	nowMs: number,
	count: number,
): ReadonlyArray<typeof AccountRow.Type> =>
	(model.accounts ?? [])
		.filter(
			(account) =>
				account.lastActiveAtMs !== null &&
				account.lastActiveAtMs <= nowMs - QUIET_AFTER_DAYS * 86_400_000 &&
				account.lifecycleStage !== "churned",
		)
		.sort((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0))
		.slice(0, count)
