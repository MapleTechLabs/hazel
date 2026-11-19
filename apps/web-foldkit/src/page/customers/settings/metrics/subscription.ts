import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { layoutsStream, metricsStream } from "./queries"

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

/** The metric definitions and the layouts (for "used in"). */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	metrics: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: metricsStream(organizationId, (metrics) => Message.UpdatedMetrics({ metrics })),
	}),
	layouts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: layoutsStream(organizationId, (layouts) => Message.UpdatedLayouts({ layouts })),
	}),
}))
