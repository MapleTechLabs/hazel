// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$org/customers` (today's `web-foldkit/src/page/customers/overview`, now deleted): the three
 * headline numbers, the queue's top rows, usage drops and support, suggested channel links, who
 * arrived and left in the range, and the folded charts (`docs/customers/spec.md` §1).
 */
import { Command, Component, Subscription } from "@effect/ui"
import type { OrganizationId } from "@hazel/schema"
import { Layer } from "effect"
import { withData } from "../../app/live"
import { Navigate, ShowToast } from "../../app/requests"
import { makeChannelData } from "../data/channels"
import { makeCustomerQueries } from "../data/queries"
import {
	AcceptSuggestion,
	DismissSuggestion,
	GetOverview,
	GetSuggestions,
	SuggestionOutcome,
	suggestionFailureCopy,
} from "./overview/data"
import { OverviewDef, OverviewMessage } from "./overview/model"
import { overviewView } from "./overview/view"
import { customersHref } from "./parts"
import { GetSupportReport } from "./support/report"

export { OverviewMessage, OverviewModel, OverviewProps } from "./overview/model"

const completed = (outcome: SuggestionOutcome) => OverviewMessage.CompletedSuggestion({ outcome })

/** The live halves: the queue preview, accounts, sources, settings and channels, per org. */
const subscriptions = (organizationId: OrganizationId | null) =>
	organizationId === null
		? []
		: [
				Subscription.make("signals", [organizationId], ([org]) =>
					withData((data) =>
						makeCustomerQueries(data).signalsStream(org, (signals) =>
							OverviewMessage.UpdatedSignals({ signals }),
						),
					),
				),
				Subscription.make("accounts", [organizationId], ([org]) =>
					withData((data) =>
						makeCustomerQueries(data).accountsStream(org, (accounts) =>
							OverviewMessage.UpdatedAccounts({ accounts }),
						),
					),
				),
				Subscription.make("providers", [organizationId], ([org]) =>
					withData((data) =>
						makeCustomerQueries(data).connectedProvidersStream(org, (providers) =>
							OverviewMessage.UpdatedProviders({ providers }),
						),
					),
				),
				Subscription.make("settings", [organizationId], ([org]) =>
					withData((data) =>
						makeCustomerQueries(data).settingsSummaryStream(org, (settings) =>
							OverviewMessage.UpdatedSettings({ settings }),
						),
					),
				),
				Subscription.make("channels", [organizationId], ([org]) =>
					withData((data) =>
						makeChannelData(data).channelOptionsStream(org, (channels) =>
							OverviewMessage.UpdatedChannels({ channels }),
						),
					),
				),
			]

export const OverviewPageNoDeps = OverviewDef.make({
	init: () => ({
		range: "30d",
		isComparing: true,
		trendsOpen: false,
		attempt: 0,
		supportAttempt: 0,
		suggestionsRevision: 0,
		hiddenSuggestions: [],
		signals: null,
		accounts: null,
		providers: null,
		settings: null,
		channels: [],
	}),
	update: {
		ClickedRange: ($, { range }) => (range === $.model.range ? $.model : $.evolve({ range })),
		ToggledCompare: ($, { isComparing }) => $.evolve({ isComparing }),
		ToggledTrends: ($, { open }) => $.evolve({ trendsOpen: open }),
		PressedRetry: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		PressedRetrySupport: ($) => $.evolve({ supportAttempt: (attempt) => attempt + 1 }),
		PressedConnect: ($, { provider }) =>
			$.run(
				Navigate.make({
					href: customersHref($.props.session, `/settings/sources/${provider}`),
					replace: false,
				}),
			),
		PressedAcceptSuggestion: ($, { suggestionId }) => {
			const organization = $.props.session.organization
			const { queries } = $
			const items = queries.suggestions._tag === "Success" ? queries.suggestions.value : []
			const suggestion = items.find((item) => item.id === suggestionId)
			// Pressed again while its write runs: already hidden, sent once.
			if (
				organization === null ||
				suggestion === undefined ||
				$.model.hiddenSuggestions.includes(suggestionId)
			)
				return $.model
			return $.evolve({ hiddenSuggestions: (hidden) => [...hidden, suggestionId] }).run(
				AcceptSuggestion.make({ organizationId: organization.id, suggestion }).pipe(
					Command.map(completed),
				),
			)
		},
		PressedDismissSuggestion: ($, { suggestionId }) => {
			const organization = $.props.session.organization
			const { queries } = $
			const items = queries.suggestions._tag === "Success" ? queries.suggestions.value : []
			const suggestion = items.find((item) => item.id === suggestionId)
			if (
				organization === null ||
				suggestion === undefined ||
				$.model.hiddenSuggestions.includes(suggestionId)
			)
				return $.model
			return $.evolve({ hiddenSuggestions: (hidden) => [...hidden, suggestionId] }).run(
				DismissSuggestion.make({ organizationId: organization.id, suggestion }).pipe(
					Command.map(completed),
				),
			)
		},
		// Ask again after each: accepting settles the channel's other suggestions too.
		CompletedSuggestion: ($, { outcome }) =>
			SuggestionOutcome.match(outcome, {
				Succeeded: ({ action, suggestion }) => {
					const asked = $.evolve({ suggestionsRevision: (revision) => revision + 1 })
					if (action === "dismiss") return asked
					const channel = $.model.channels.find((option) => option.id === suggestion.channelId)
					const what = channel === undefined ? "the channel" : `#${channel.name}`
					return asked.run(
						ShowToast.make({
							toast: {
								intent: "success",
								title: `Linked ${what} to ${suggestion.accountName}`,
								description: null,
							},
						}),
					)
				},
				Failed: ({ action, suggestion, reason }) =>
					$.evolve({
						suggestionsRevision: (revision) => revision + 1,
						hiddenSuggestions: (hidden) => hidden.filter((id) => id !== suggestion.id),
					}).run(
						ShowToast.make({
							toast: { intent: "error", ...suggestionFailureCopy(action, reason) },
						}),
					),
			}),
		UpdatedSignals: ($, { signals }) => $.evolve({ signals: () => signals }),
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts: () => accounts }),
		UpdatedProviders: ($, { providers }) => $.evolve({ providers: () => providers }),
		UpdatedSettings: ($, { settings }) => $.evolve({ settings: () => settings }),
		UpdatedChannels: ($, { channels }) => $.evolve({ channels }),
	},
	subscriptions: ({ props }) => subscriptions(props.session.organization?.id ?? null),
	view: (h, model) => overviewView(h, model),
})

/** The page with its queries and suggestion actions, on the host's `HazelRpc`. */
export const OverviewPage = OverviewPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			GetOverview.layer,
			GetSupportReport.layer,
			GetSuggestions.layer,
			AcceptSuggestion.layer,
			DismissSuggestion.layer,
		),
	),
)
