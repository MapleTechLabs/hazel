import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import { type ConnectionRow, connectionsQuery, toConnection } from "../shared/connections"
import { Message } from "./message"
import type { Model } from "./model"

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	connections: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			// Legacy reads `useAuth().user.organizationId` here.
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.currentUser?.organizationId ?? null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<ConnectionRow, Message>(connectionsQuery(organizationId), (rows) =>
							Message.UpdatedConnections({ connections: rows.map(toConnection) }),
						),
		},
	),
}))
