import { Option, Result } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { Command } from "foldkit"
import {
	AcceptSuggestion,
	DismissSuggestion,
	EMPTY_SUGGESTIONS,
	hideSuggestion,
	receivedSuggestions,
	SuggestionMessage,
	suggestionFailureToast,
	unhideSuggestion,
} from "../../../customers/suggestions"
import { successToast } from "../../../data/actions"
import { AppRoute } from "../../../route"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import { FetchCustomersOverview, FetchOverviewSupport, FetchSuggestedChannelLinks } from "./commands"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

/** Loads `model.range` (keeping what shows while it loads); nothing until the organization is known. */
const fetch = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined) return { model }
	return {
		model: modifyFields(model, {
			overview: (overview) => Option.getOrElse(AsyncData.revalidateOrLoad(overview), () => overview),
		}),
		commands: [FetchCustomersOverview({ organizationId, range: model.range })],
	}
}

/** The suggested channel links, asked once the organization is known (`force`: again). */
const fetchSuggestions = (model: Model, shared: Shared, force = false): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined || (model.hasRequestedSuggestions && !force)) return { model }
	return {
		model: modifyFields(model, { hasRequestedSuggestions: () => true }),
		commands: [FetchSuggestedChannelLinks({ organizationId })],
	}
}

/** Loads the support tiles for `model.range`, keeping what shows while it loads. */
const fetchSupport = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined) return { model }
	return {
		model: modifyFields(model, {
			support: (support) => Option.getOrElse(AsyncData.revalidateOrLoad(support), () => support),
		}),
		commands: [FetchOverviewSupport({ organizationId, range: model.range })],
	}
}

/** The overview and its support tiles. */
const fetchAll = (model: Model, shared: Shared): Return => {
	const overview = fetch(model, shared)
	const support = fetchSupport(overview.model, shared)
	return { model: support.model, commands: [...(overview.commands ?? []), ...(support.commands ?? [])] }
}

/** The overview and its support tiles (once), and the suggested channel links. */
const both = (model: Model, shared: Shared): Return => {
	const overview = AsyncData.isIdle(model.overview) ? fetchAll(model, shared) : { model }
	const suggestions = fetchSuggestions(overview.model, shared)
	return {
		model: suggestions.model,
		commands: [...(overview.commands ?? []), ...(suggestions.commands ?? [])],
	}
}

const toSuggestionMessage = (message: SuggestionMessage) => Message.CompletedSuggestionAction({ message })

export const init = (_route: unknown, shared: Shared): Return =>
	both(
		{
			range: "30d",
			isComparing: true,
			overview: AsyncData.Idle(),
			support: AsyncData.Idle(),
			healthMetric: "customers",
			hoveredMrr: null,
			hoveredActiveUsers: null,
			signals: null,
			accounts: null,
			connectedProviders: null,
			settings: null,
			suggestions: EMPTY_SUGGESTIONS,
			hasRequestedSuggestions: false,
			channelOptions: [],
		},
		shared,
	)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return => both(model, shared)

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ClickedRange: ({ range }) =>
			range === model.range
				? { model }
				: fetchAll(
						modifyFields(model, {
							range: () => range,
							hoveredMrr: () => null,
							hoveredActiveUsers: () => null,
						}),
						shared,
					),
		ToggledCompare: ({ isComparing }) => ({
			model: modifyFields(model, { isComparing: () => isComparing }),
		}),
		ClickedHealthMetric: ({ metric }) => ({ model: modifyFields(model, { healthMetric: () => metric }) }),
		HoveredChart: ({ chart, index }) => ({
			model:
				chart === "mrr"
					? modifyFields(model, { hoveredMrr: () => index })
					: modifyFields(model, { hoveredActiveUsers: () => index }),
		}),
		PressedRetry: () => fetch(model, shared),
		PressedRetrySupport: () => fetchSupport(model, shared),
		SucceededFetchSupport: ({ range, report }) =>
			range === model.range
				? {
						model: modifyFields(model, {
							support: (current) => AsyncData.settle(current, Result.succeed(report)),
						}),
					}
				: { model },
		FailedFetchSupport: ({ range, reason }) =>
			range === model.range
				? { model: modifyFields(model, { support: () => AsyncData.Failure({ error: reason }) }) }
				: { model },
		PressedConnect: ({ provider }) => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.CustomersSourceDetail({ orgSlug, provider }),
			),
		}),

		// A slower answer for a range the user already left is dropped.
		SucceededFetchOverview: ({ range, overview }) =>
			range === model.range
				? {
						model: modifyFields(model, {
							overview: (current) => AsyncData.settle(current, Result.succeed(overview)),
						}),
					}
				: { model },
		// Numbers held for another range are dropped, so the failure (and its retry) shows.
		FailedFetchOverview: ({ range, reason }) =>
			range === model.range
				? {
						model: modifyFields(model, {
							overview: (current) =>
								Option.exists(AsyncData.getData(current), (data) => data.range === range)
									? AsyncData.settle(current, Result.fail(reason))
									: AsyncData.Failure({ error: reason }),
						}),
					}
				: { model },

		UpdatedSignals: ({ signals }) => ({ model: modifyFields(model, { signals: () => signals }) }),
		UpdatedAccounts: ({ accounts }) => ({ model: modifyFields(model, { accounts: () => accounts }) }),
		UpdatedConnectedProviders: ({ providers }) => ({
			model: modifyFields(model, { connectedProviders: () => providers }),
		}),
		UpdatedSettings: ({ settings }) => ({ model: modifyFields(model, { settings: () => settings }) }),
		UpdatedChannelOptions: ({ channels }) => ({
			model: modifyFields(model, { channelOptions: () => channels }),
		}),

		SucceededFetchSuggestions: ({ items }) => ({
			model: modifyFields(model, { suggestions: (list) => receivedSuggestions(list, items) }),
		}),
		// Asked again on the next change of the shared state (a failed fetch is not "none").
		FailedFetchSuggestions: () => ({
			model: modifyFields(model, { hasRequestedSuggestions: () => false }),
		}),
		PressedAcceptSuggestion: ({ suggestionId }) => {
			const organizationId = shared.organization?.id
			const userId = shared.currentUser?.id
			const suggestion = model.suggestions.items?.find((item) => item.id === suggestionId)
			// Pressed again while its write runs: already hidden, sent once.
			if (
				organizationId === undefined ||
				userId === undefined ||
				suggestion === undefined ||
				model.suggestions.hidden.includes(suggestionId)
			)
				return { model }
			return {
				// The row leaves at once; the channel's customer shows wherever links show.
				model: modifyFields(model, { suggestions: (list) => hideSuggestion(list, suggestionId) }),
				commands: [
					Command.mapMessage(
						AcceptSuggestion({ organizationId, suggestion, linkedBy: userId }),
						toSuggestionMessage,
					),
				],
			}
		},
		PressedDismissSuggestion: ({ suggestionId }) => {
			const organizationId = shared.organization?.id
			const suggestion = model.suggestions.items?.find((item) => item.id === suggestionId)
			if (
				organizationId === undefined ||
				suggestion === undefined ||
				model.suggestions.hidden.includes(suggestionId)
			)
				return { model }
			return {
				model: modifyFields(model, { suggestions: (list) => hideSuggestion(list, suggestionId) }),
				commands: [
					Command.mapMessage(
						DismissSuggestion({ organizationId, suggestion }),
						toSuggestionMessage,
					),
				],
			}
		},
		// Ask again after each: accepting settles the channel's other suggestions too.
		CompletedSuggestionAction: ({ message: action }) =>
			SuggestionMessage.match<Return>(action, {
				SucceededAccept: ({ suggestion }) => {
					const channel = model.channelOptions.find((option) => option.id === suggestion.channelId)
					const what = channel === undefined ? "the channel" : `#${channel.name}`
					return {
						...fetchSuggestions(model, shared, true),
						outMessage: PageOutMessage.RequestedToast({
							toast: successToast(`Linked ${what} to ${suggestion.accountName}`),
						}),
					}
				},
				SucceededDismiss: () => fetchSuggestions(model, shared, true),
				FailedSuggestionAction: ({ suggestion, action: failed, reason }) => ({
					...fetchSuggestions(
						modifyFields(model, { suggestions: (list) => unhideSuggestion(list, suggestion.id) }),
						shared,
						true,
					),
					outMessage: PageOutMessage.RequestedToast({
						toast: suggestionFailureToast(failed, reason),
					}),
				}),
			}),
	})
