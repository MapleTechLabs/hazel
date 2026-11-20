import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { DailyChart } from "./model"

export const Message = defineMessageUnion({
	ClickedRange: { range: Customers.CustomersRange },
	ClickedChart: { chart: DailyChart },
	HoveredDay: { index: Schema.NullOr(Schema.Int) },
	PressedRetry: {},

	SucceededFetchReport: { range: Customers.CustomersRange, report: Customers.SupportReport },
	FailedFetchReport: { range: Customers.CustomersRange, reason: CommonReason },
})
export type Message = typeof Message.Type
