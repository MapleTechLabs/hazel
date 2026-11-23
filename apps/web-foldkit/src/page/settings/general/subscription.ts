import { OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import type { OrganizationExport } from "@hazel/domain/models"
import { organizationCollection, organizationExportCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { isAdminOf } from "./update"

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
	/** The org's data exports, for owners and admins (the only ones they sync to). */
	exports: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId:
					shared.organization !== null && isAdminOf(shared) ? shared.organization.id : null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<OrganizationExport.Type, Message>(
							(q) =>
								q
									.from({ exp: organizationExportCollection })
									.where(({ exp }) => eq(exp.organizationId, organizationId))
									.orderBy(({ exp }) => exp.createdAt, "desc"),
							(rows) => Message.UpdatedExports({ exports: rows.slice(0, 10) }),
						),
		},
	),
}))
