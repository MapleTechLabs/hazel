import { Option, Result } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { AppRoute } from "../../../route"
import type { PageReturn, Shared } from "../../contract"
import { requestedOrgNavigation } from "../../out-message"
import { FetchCustomersOverview } from "./commands"
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

export const init = (_route: unknown, shared: Shared): Return =>
	fetch(
		{
			range: "30d",
			isComparing: true,
			overview: AsyncData.Idle(),
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
	AsyncData.isIdle(model.overview) ? fetch(model, shared) : { model }

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ClickedRange: ({ range }) =>
			range === model.range
				? { model }
				: fetch(
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
		FailedFetchOverview: ({ range, reason }) =>
			range === model.range
				? {
						model: modifyFields(model, {
							overview: (current) => AsyncData.settle(current, Result.fail(reason)),
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
