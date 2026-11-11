import { CustomersRange } from "@hazel/domain/customers"
import { Effect, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { msOf, toAccountRow, toSignalRow } from "../../../../customers/queries"
import { Message } from "../../../../page/customers/overview/message"
import { Model } from "../../../../page/customers/overview/model"
import { init, update } from "../../../../page/customers/overview/update"
import { view } from "../../../../page/customers/overview/view"
import { labShared } from "../../../../page/customers/lab-shared"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, CONNECTIONS, overviewFixture, SETTINGS, SIGNALS } from "../../../fixtures/customers"

// `/lab/customers/pages/overview`: the real overview over the fixtures (`?state=`, `?range=`). Its
// update runs; `customers.overview` answers from `overviewFixture` instead of the network.

const STATES = ["default", "partial", "empty", "loading"] as const
const State = Schema.Literals(STATES)
const Flags = Schema.Struct({ state: State, range: CustomersRange })

/** Answers a pending fetch from the fixtures, as the RPC would for that range. */
const answered = (model: Model, partial: boolean): Model =>
	AsyncData.isLoading(model.overview) || AsyncData.isRefreshing(model.overview)
		? { ...model, overview: AsyncData.Success({ data: overviewFixture(model.range, { partial }) }) }
		: model

const stateModel = (flags: typeof Flags.Type): Model => {
	const base = { ...init(undefined, labShared).model, range: flags.range }
	if (flags.state === "loading") return { ...base, overview: AsyncData.Loading() }
	const live: Model = {
		...base,
		accounts: flags.state === "empty" ? [] : ACCOUNTS.map(toAccountRow),
		signals: flags.state === "empty" ? [] : SIGNALS.map(toSignalRow),
		connectedProviders:
			flags.state === "empty"
				? []
				: CONNECTIONS.map((connection) => connection.provider).filter(
						(provider) =>
							flags.state !== "partial" || (provider !== "stripe" && provider !== "autumn"),
					),
		settings: {
			lastComputedAtMs: SETTINGS.lastComputedAt === null ? null : msOf(SETTINGS.lastComputedAt),
			bands: SETTINGS.health.bands,
			reportingCurrency: SETTINGS.reportingCurrency,
		},
	}
	return answered(live, flags.state === "partial")
}

const toMessage = (message: Message) => message

export const lab = defineLabWithFlags("Overview", {
	Model,
	Flags,
	flags: Effect.all({
		state: queryParam("state", STATES, "default"),
		range: queryParam("range", CustomersRange.literals, "30d"),
	}),
	init: (flags) => ({ model: stateModel(flags) }),
	update: (model: Model, message: Message) => {
		const isPartial = new URLSearchParams(window.location.search).get("state") === "partial"
		return { model: answered(update(model, message, labShared).model, isPartial) }
	},
	view: (model: Model, h: HtmlBuilder<Message>): Html =>
		labPage(
			h,
			{
				title: "Overview",
				switches: [
					{
						name: "state",
						values: STATES,
						current: new URLSearchParams(window.location.search).get("state") ?? "default",
					},
				],
			},
			[
				h.div(
					[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
					[
						h.submodel({
							slotId: "overview",
							model,
							view,
							viewInputs: { shared: labShared },
							toParentMessage: toMessage,
						}),
					],
				),
			],
		),
})
