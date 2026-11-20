import * as Customers from "@hazel/domain/customers"
import { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { fetchSupportReport } from "../../../customers/support-report"
import { catchCommon } from "../../../data/actions"
import { Message } from "./message"

/** The report for one range. */
export const FetchSupportReport = Command.define("FetchSupportReport", {
	args: { organizationId: OrganizationId, range: Customers.CustomersRange },
	messages: [Message.SucceededFetchReport, Message.FailedFetchReport],
	execute: ({ organizationId, range }) =>
		fetchSupportReport(organizationId, range).pipe(
			Effect.map((report) => Message.SucceededFetchReport({ range, report })),
			catchCommon((reason) => Message.FailedFetchReport({ range, reason })),
		),
})
