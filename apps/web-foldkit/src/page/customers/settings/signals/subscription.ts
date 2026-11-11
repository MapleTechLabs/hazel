import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	accountsStream,
	connectedProvidersStream,
	settingsSummaryStream,
	signalsStream,
} from "../../../../customers/queries"
import type { PageSubscriptionInput } from "../../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { metricsStream, rulesStream } from "./queries"

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

const live =
	<A>(stream: (organizationId: OrganizationId) => Stream.Stream<A>) =>
	({ organizationId }: { readonly organizationId: OrganizationId | null }) =>
		organizationId === null ? Stream.empty : stream(organizationId)

/** The rules, their signals, the accounts (scope counts, plan names), sources, settings and metrics. */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	rules: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) => rulesStream(id, (rules) => Message.UpdatedRules({ rules }))),
	}),
	signals: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			signalsStream(id, (signals) => Message.UpdatedSignals({ signals })),
		),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			accountsStream(id, (accounts) => Message.UpdatedAccounts({ accounts })),
		),
	}),
	connections: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			connectedProvidersStream(id, (providers) => Message.UpdatedConnectedProviders({ providers })),
		),
	}),
	settings: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			settingsSummaryStream(id, (settings) => Message.UpdatedSettings({ settings })),
		),
	}),
	metrics: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			metricsStream(id, (metrics) => Message.UpdatedMetrics({ metrics })),
		),
	}),
}))
