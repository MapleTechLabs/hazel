import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { accountsStream } from "../../../../customers/queries"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"

/** Live accounts: the suggestions' names and logos, and what "Link to…" searches. */
export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	accounts: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
		},
	),
}))
