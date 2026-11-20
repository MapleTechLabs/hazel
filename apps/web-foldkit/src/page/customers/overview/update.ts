import { Option, Result } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { AppRoute } from "../../../route"
import type { PageReturn, Shared } from "../../contract"
import { requestedOrgNavigation } from "../../out-message"
import { FetchCustomersOverview, FetchOverviewSupport } from "./commands"
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

export const init = (_route: unknown, shared: Shared): Return =>
	fetchAll(
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
		},
		shared,
	)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.overview) ? fetchAll(model, shared) : { model }

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
	})
