import { OrganizationId } from "@hazel/schema"
import { inArray } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import { interaction } from "./update"
import type { Model } from "./model"

/** Host organization names (legacy: one `organizationCollection` live query per row). */
const dataSubscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	hostOrganizations: entry(
		{ organizationIds: Schema.Array(OrganizationId) },
		{
			modelToDependencies: ({ model }) => ({
				organizationIds: [
					...new Set(model.invites.map((invite) => invite.hostOrganizationId)),
				].sort(),
			}),
			dependenciesToStream: ({ organizationIds }) =>
				organizationIds.length === 0
					? Stream.empty
					: liveQueryStream<{ readonly id: OrganizationId; readonly name: string }, Message>(
							(q) =>
								q
									.from({ org: organizationCollection })
									.where(({ org }) => inArray(org.id, [...organizationIds]))
									.select(({ org }) => ({ id: org.id, name: org.name })),
							(rows) =>
								Message.UpdatedHostOrganizations({
									organizations: rows.map((row) => ({ id: row.id, name: row.name })),
								}),
						),
		},
	),
}))

export const subscriptions = { ...interaction.subscriptions, ...dataSubscriptions }
