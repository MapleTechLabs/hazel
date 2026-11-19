import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { accountsStream, createdFeatureFlagsStream } from "../../../../customers/queries"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

/** The created flags and the live accounts (whose `featureFlags` hold the rest). */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	created: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: createdFeatureFlagsStream(organizationId, (keys) => Message.UpdatedCreated({ keys })),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
}))
