import * as Customers from "@hazel/domain/customers"
import { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { fetchSuggestions } from "../../../customers/suggestions"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { Message } from "./message"

/** KPIs, movements, active users, distribution, movers, new and churned for one range. */
export const FetchCustomersOverview = Command.define("FetchCustomersOverview", {
	args: { organizationId: OrganizationId, range: Customers.CustomersRange },
	messages: [Message.SucceededFetchOverview, Message.FailedFetchOverview],
	execute: ({ organizationId, range }) =>
		HazelRpc.use((rpc) => rpc("customers.overview", { organizationId, range })).pipe(
			Effect.map((overview) => Message.SucceededFetchOverview({ range, overview })),
			catchCommon((reason) => Message.FailedFetchOverview({ range, reason })),
		),
})

/** The org's open suggested channel links. */
export const FetchSuggestedChannelLinks = Command.define("FetchSuggestedChannelLinks", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchSuggestions, Message.FailedFetchSuggestions],
	execute: ({ organizationId }) =>
		fetchSuggestions(organizationId, {}).pipe(
			Effect.map((items) => Message.SucceededFetchSuggestions({ items })),
			catchCommon(() => Message.FailedFetchSuggestions()),
		),
})
