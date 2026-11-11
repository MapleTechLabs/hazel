import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, SettingsSummary, SignalRow } from "../../../customers/queries"
import { Chart, HealthMetric } from "./model"

export const Message = defineMessageUnion({
	ClickedRange: { range: Customers.CustomersRange },
	ToggledCompare: { isComparing: Schema.Boolean },
	ClickedHealthMetric: { metric: HealthMetric },
	HoveredChart: { chart: Chart, index: Schema.NullOr(Schema.Int) },
	PressedRetry: {},
	/** A setup card's Connect: the data source's page, where connecting happens. */
	PressedConnect: { provider: Customers.CustomerProvider },

	SucceededFetchOverview: { range: Customers.CustomersRange, overview: Customers.OverviewResult },
	FailedFetchOverview: { range: Customers.CustomersRange, reason: CommonReason },

	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedConnectedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
})
export type Message = typeof Message.Type
