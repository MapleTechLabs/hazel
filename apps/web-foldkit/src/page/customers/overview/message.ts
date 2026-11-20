import * as Customers from "@hazel/domain/customers"
import { CustomerChannelSuggestionId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { ChannelOption } from "../../../customers/channels"
import { AccountRow, SettingsSummary, SignalRow } from "../../../customers/queries"
import { SuggestionMessage, SuggestionRow } from "../../../customers/suggestions"
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
	PressedRetrySupport: {},
	SucceededFetchSupport: { range: Customers.CustomersRange, report: Customers.SupportReport },
	FailedFetchSupport: { range: Customers.CustomersRange, reason: CommonReason },

	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedConnectedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
	UpdatedChannelOptions: { channels: Schema.Array(ChannelOption) },

	SucceededFetchSuggestions: { items: Schema.Array(SuggestionRow) },
	FailedFetchSuggestions: {},
	PressedAcceptSuggestion: { suggestionId: CustomerChannelSuggestionId },
	PressedDismissSuggestion: { suggestionId: CustomerChannelSuggestionId },
	/** The shared accept / dismiss Commands' answers (`customers/suggestions.ts`). */
	CompletedSuggestionAction: { message: SuggestionMessage },
})
export type Message = typeof Message.Type
