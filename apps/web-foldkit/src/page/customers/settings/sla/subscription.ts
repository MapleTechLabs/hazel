import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { accountsStream } from "../../../../customers/queries"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { hoursStream, policiesStream } from "./queries"

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

const live =
	<A>(stream: (organizationId: OrganizationId) => Stream.Stream<A>) =>
	({ organizationId }: { readonly organizationId: OrganizationId | null }) =>
		organizationId === null ? Stream.empty : stream(organizationId)

/** The policies, the business hours, and the accounts (the picker, the list's names). */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	policies: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			policiesStream(id, (policies) => Message.UpdatedPolicies({ policies })),
		),
	}),
	settings: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			hoursStream(id, (settings) => Message.UpdatedSettings({ settings })),
		),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			accountsStream(id, (accounts) =>
				Message.UpdatedAccounts({
					accounts: accounts.map((account) => ({
						id: account.id,
						name: account.name,
						domain: account.domain,
					})),
				}),
			),
		),
	}),
}))
