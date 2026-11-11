import { OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

/** `organization.isPublic` (the shared Organization doesn't carry it), as `useOrganization` reads it. */
export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	isPublic: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<{ readonly isPublic?: boolean | null }, Message>(
							(q) =>
								q
									.from({ org: organizationCollection })
									.where(({ org }) => eq(org.id, organizationId))
									.findOne(),
							(rows) => Message.UpdatedIsPublic({ isPublic: rows[0]?.isPublic ?? false }),
						),
		},
	),
}))
