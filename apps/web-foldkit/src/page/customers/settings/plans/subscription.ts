import type * as Customers from "@hazel/domain/customers"
import { OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { customerSettingsCollection } from "~/db/collections"
import { withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"

/** The org's add-on plans; null until the object has seeded its settings row. */
export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	settings: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: withCustomersSource(
							organizationId,
							liveQueryStream<Customers.Settings, Message>(
								(q) =>
									q
										.from({ settings: customerSettingsCollection })
										.where(({ settings }) => eq(settings.organizationId, organizationId))
										.findOne(),
								(rows) => {
									const row = rows[0]
									return Message.UpdatedSettings({
										settings:
											row === undefined
												? null
												: { id: row.id, addOnPlans: row.addOnPlans },
									})
								},
							),
						),
		},
	),
}))
