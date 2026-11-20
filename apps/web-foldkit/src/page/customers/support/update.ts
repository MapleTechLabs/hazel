import { Option, Result } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import type { PageReturn, Shared } from "../../contract"
import { FetchSupportReport } from "./commands"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

/** Loads `model.range`, keeping what shows while it loads; nothing until the organization is known. */
const fetch = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined) return { model }
	return {
		model: modifyFields(model, {
			report: (report) => Option.getOrElse(AsyncData.revalidateOrLoad(report), () => report),
		}),
		commands: [FetchSupportReport({ organizationId, range: model.range })],
	}
}

export const init = (_route: unknown, shared: Shared): Return =>
	fetch({ range: "30d", report: AsyncData.Idle(), chart: "median", hoveredDay: null }, shared)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.report) ? fetch(model, shared) : { model }

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ClickedRange: ({ range }) =>
			range === model.range
				? { model }
				: fetch(modifyFields(model, { range: () => range, hoveredDay: () => null }), shared),
		ClickedChart: ({ chart }) => ({ model: modifyFields(model, { chart: () => chart }) }),
		HoveredDay: ({ index }) => ({ model: modifyFields(model, { hoveredDay: () => index }) }),
		PressedRetry: () => fetch(model, shared),

		// A slower answer for a range the user already left is dropped.
		SucceededFetchReport: ({ range, report }) =>
			range === model.range
				? {
						model: modifyFields(model, {
							report: (current) => AsyncData.settle(current, Result.succeed(report)),
						}),
					}
				: { model },
		// Numbers held for another range are dropped, so the failure (and its retry) shows.
		FailedFetchReport: ({ range, reason }) =>
			range === model.range
				? { model: modifyFields(model, { report: () => AsyncData.Failure({ error: reason }) }) }
				: { model },
	})
