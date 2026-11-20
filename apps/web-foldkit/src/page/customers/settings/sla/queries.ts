import type * as Customers from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import type { Stream } from "effect"
import { customerSettingsCollection, customerSlaPolicyCollection } from "~/db/collections"
import { withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"
import type { PolicyRow, SavedHours } from "./model"

/** The page's own live queries over the `customers:<org>` collections: the policies and the business hours. */

const toPolicyRow = (policy: Customers.SlaPolicy): PolicyRow => ({
	id: policy.id,
	name: policy.name,
	position: policy.position,
	enabled: policy.enabled,
	appliesTo: policy.appliesTo,
	targets: policy.targets,
	hours: policy.hours,
	warnBeforePct: policy.warnBeforePct,
})

/** The org's live (not deleted) policies, first match first. */
export const policiesStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (policies: ReadonlyArray<PolicyRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.SlaPolicy, Message>(
			(q) =>
				q
					.from({ policy: customerSlaPolicyCollection })
					.where(({ policy }) =>
						and(eq(policy.organizationId, organizationId), isNull(policy.deletedAt)),
					)
					.orderBy(({ policy }) => policy.position, "asc"),
			(rows) => toMessage(rows.map(toPolicyRow)),
		),
	)

/** The business hours; null until the object has seeded its settings row. */
export const hoursStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (settings: SavedHours | null) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Settings, Message>(
			(q) =>
				q
					.from({ settings: customerSettingsCollection })
					.where(({ settings }) => eq(settings.organizationId, organizationId))
					.findOne(),
			(rows) => {
				const row = rows[0]
				return toMessage(
					row === undefined ? null : { settingsId: row.id, businessHours: row.businessHours },
				)
			},
		),
	)
