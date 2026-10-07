import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import { type ConnectionRow, connectionsQuery, toConnection } from "../shared/connections"
import { isProvider } from "./command"
import { Message } from "./message"
import type { Model } from "./model"

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	connection: entry(
		{ organizationId: Schema.NullOr(OrganizationId), provider: Schema.String },
		{
			// Legacy reads `useOrganization().organizationId` here.
			modelToDependencies: ({ model, shared }) => ({
				organizationId: shared.organization?.id ?? null,
				provider: model.integrationId,
			}),
			dependenciesToStream: ({ organizationId, provider }) =>
				organizationId === null || !isProvider(provider)
					? Stream.empty
					: liveQueryStream<ConnectionRow, Message>(connectionsQuery(organizationId, provider), (rows) =>
							Message.UpdatedConnection({ connection: rows[0] ? toConnection(rows[0]) : null }),
						),
		},
	),
}))
