import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { layoutsStream, metricDefsStream } from "../../../../customers/overview/rows"
import {
	accountsStream,
	orgMembersStream,
	settingsSummaryStream,
	signalsStream,
} from "../../../../customers/queries"
import type { PageSubscriptionInput } from "../../../contract"
import { notesStream } from "../../detail/data"
import { Message } from "./message"
import type { Model } from "./model"

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

const live =
	<A>(stream: (organizationId: OrganizationId) => Stream.Stream<A>) =>
	({ organizationId }: { readonly organizationId: OrganizationId | null }) =>
		organizationId === null ? Stream.empty : stream(organizationId)

/**
 * The layouts, metrics and customers (rule chips, the preview picker), plus what the built-in
 * sections draw for the previewed customer: signals, people, health bands, its notes.
 */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	layouts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			layoutsStream(id, (layouts) => Message.UpdatedLayouts({ layouts })),
		),
	}),
	metrics: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			metricDefsStream(id, (metrics) => Message.UpdatedMetrics({ metrics })),
		),
	}),
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			accountsStream(id, (accounts) => Message.UpdatedAccounts({ accounts })),
		),
	}),
	signals: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			signalsStream(id, (signals) => Message.UpdatedSignals({ signals })),
		),
	}),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			orgMembersStream(id, (members) => Message.UpdatedMembers({ members })),
		),
	}),
	settings: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: live((id) =>
			settingsSummaryStream(id, (settings) => Message.UpdatedSettings({ settings })),
		),
	}),
	previewNotes: entry(
		{ organizationId: Schema.NullOr(OrganizationId), accountId: Schema.NullOr(CustomerAccountId) },
		{
			modelToDependencies: ({ model, shared }) => ({
				organizationId: shared.organization?.id ?? null,
				accountId: model.editor?.previewId ?? null,
			}),
			dependenciesToStream: ({ organizationId, accountId }) =>
				organizationId === null || accountId === null
					? Stream.empty
					: notesStream(organizationId, accountId, (notes) =>
							Message.UpdatedPreviewNotes({ accountId, notes }),
						),
		},
	),
}))
