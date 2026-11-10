import { DEFAULT_HEALTH_SETTINGS } from "@hazel/domain/customers"
import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	accountsStream,
	connectedProvidersStream,
	orgMembersStream,
	settingsSummaryStream,
	signalsStream,
} from "../../../customers/queries"
import type { PageSubscriptionInput } from "../../contract"
import { metricsStream, notesStream } from "./data"
import { Message } from "./message"
import { type Model, NoteDrafts } from "./model"
import { writeNoteDrafts } from "./note-drafts"

/** The customer page's live rows: every account (prev/next and this one), signals, notes, people. */

type Input = PageSubscriptionInput<Model>

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
	signals: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: signalsStream(organizationId, (signals) => Message.UpdatedSignals({ signals })),
	}),
	notes: entry(
		{ organizationId: Schema.NullOr(OrganizationId), accountId: CustomerAccountId },
		{
			modelToDependencies: ({ model, shared }) => ({
				organizationId: shared.organization?.id ?? null,
				accountId: model.accountId,
			}),
			dependenciesToStream: ({ organizationId, accountId }) =>
				organizationId === null
					? Stream.empty
					: notesStream(organizationId, accountId, (notes) => Message.UpdatedNotes({ notes })),
		},
	),
	// Keeps the unsent text for the customer's next page instance, once this one has read it back.
	noteDrafts: entry(
		{ accountId: Schema.NullOr(CustomerAccountId), drafts: NoteDrafts },
		{
			modelToDependencies: ({ model }) => ({
				accountId: model.hasLoadedDrafts ? model.accountId : null,
				drafts: { composer: model.composer, editingNote: model.editingNote },
			}),
			dependenciesToStream: ({ accountId, drafts }) =>
				accountId === null
					? Stream.empty
					: Stream.drain(Stream.fromEffect(writeNoteDrafts(accountId, drafts))),
		},
	),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: orgMembersStream(organizationId, (members) => Message.UpdatedMembers({ members })),
	}),
	metrics: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: metricsStream(organizationId, (metrics) => Message.UpdatedMetrics({ metrics })),
	}),
	bands: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: settingsSummaryStream(organizationId, (settings) =>
						Message.UpdatedBands({ bands: settings?.bands ?? DEFAULT_HEALTH_SETTINGS.bands }),
					),
	}),
	connections: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: connectedProvidersStream(organizationId, (providers) =>
						Message.UpdatedConnectedProviders({ providers }),
					),
	}),
}))
