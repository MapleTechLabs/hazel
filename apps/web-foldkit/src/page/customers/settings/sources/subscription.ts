import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { accountsStream, orgMembersStream } from "../../../../customers/queries"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { connectionsStream, syncRunsStream, unitMetricsStream } from "./queries"

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

/**
 * Connections, their runs, the account count (identity coverage), the people who connected them
 * and the sources' metrics (for their units).
 */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	connections: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: connectionsStream(organizationId, (connections) =>
						Message.UpdatedConnections({ connections }),
					),
	}),
	syncRuns: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: syncRunsStream(organizationId, (runs) => Message.UpdatedSyncRuns({ runs })),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) =>
						Message.UpdatedAccountCount({ count: accounts.length }),
					),
	}),
	metrics: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: unitMetricsStream(organizationId, (metrics) => Message.UpdatedUnitMetrics({ metrics })),
	}),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: orgMembersStream(organizationId, (members) => Message.UpdatedMembers({ members })),
	}),
}))
