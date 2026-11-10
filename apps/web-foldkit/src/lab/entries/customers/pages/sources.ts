import { Effect, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Shared } from "../../../../page/contract"
import { Message } from "../../../../page/customers/settings/sources/message"
import { Model } from "../../../../page/customers/settings/sources/model"
import { toConnectionRow, toSyncRunRow } from "../../../../page/customers/settings/sources/queries"
import { init, update } from "../../../../page/customers/settings/sources/update"
import { view } from "../../../../page/customers/settings/sources/view"
import { AppRoute } from "../../../../route"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, STRIPE_CONNECTION, TEAM } from "../../../fixtures/customers"
import {
	ADMIN_SHARED,
	MEMBER_SHARED,
	SOURCE_CONNECTIONS,
	SOURCE_SYNC_RUNS,
	UNMATCHED_OPEN_COUNT,
} from "../../../fixtures/customers-sources"

// `/lab/customers/pages/sources`: the real Data sources page (overview, connect modal, a source's
// detail) over the fixtures. Its update runs; its Commands do not: every pending RPC is answered
// with its success Message from here. `?state=` picks a Wonder artboard.

const STATES = [
	"overview",
	"overview-empty",
	"connect",
	"connect-success",
	"connect-failure",
	"connect-unavailable",
	"detail-clerk",
	"detail-maple-settings",
	"detail-not-connected",
	"read-only",
] as const
const State = Schema.Literals(STATES)
type State = typeof State.Type

const sharedOf = (state: string): Shared => (state === "read-only" ? MEMBER_SHARED : ADMIN_SHARED)
const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "overview"

const step = (model: Model, message: Message, shared: Shared): Model => update(model, message, shared).model
const steps = (model: Model, messages: ReadonlyArray<Message>, shared: Shared): Model =>
	messages.reduce((current, message) => step(current, message, shared), model)

/** Answers whatever the last update left pending, as the RPCs would on success. */
const answered = (model: Model, shared: Shared): Model => {
	const form = model.connectForm
	const pending: ReadonlyArray<Message> = [
		...(AsyncData.isLoading(model.unmatched)
			? [Message.SucceededFetchUnmatchedCount({ count: UNMATCHED_OPEN_COUNT })]
			: []),
		...(form?.isPending === true
			? [
					form.connected === null
						? Message.SucceededConnect({
								provider: form.provider,
								connectionId: STRIPE_CONNECTION.id,
								accountName: "Northwind Inc.",
							})
						: Message.SucceededSaveWebhookSecret({ connectionId: form.connected.connectionId }),
				]
			: []),
		...(model.keysForm?.isPending === true ? [Message.SucceededUpdateKeys()] : []),
		...model.syncing.map((connectionId) => Message.SucceededSyncNow({ connectionId })),
		...(model.isDisconnecting
			? [Message.SucceededDisconnect({ provider: model.provider ?? "clerk" })]
			: []),
		...(model.isSeedingDemo
			? [
					Message.SucceededSeedDemo(),
					Message.UpdatedConnections({ connections: SOURCE_CONNECTIONS.map(toConnectionRow) }),
					Message.UpdatedSyncRuns({ runs: SOURCE_SYNC_RUNS.map(toSyncRunRow) }),
				]
			: []),
		...(model.isSavingSettings && model.settingsDraft !== null
			? [
					Message.SucceededSaveSettings(),
					Message.UpdatedConnections({
						connections: (model.connections ?? []).map((connection) =>
							connection.provider === model.provider && model.settingsDraft !== null
								? { ...connection, config: model.settingsDraft }
								: connection,
						),
					}),
				]
			: []),
	]
	return steps(model, pending, shared)
}

const routeOf = (state: State) =>
	state === "detail-clerk"
		? AppRoute.CustomersSourceDetail({ orgSlug: "lab", provider: "clerk" })
		: state === "detail-maple-settings"
			? AppRoute.CustomersSourceDetail({ orgSlug: "lab", provider: "maple" })
			: state === "detail-not-connected"
				? AppRoute.CustomersSourceDetail({ orgSlug: "lab", provider: "autumn" })
				: AppRoute.CustomersSettingsSources({ orgSlug: "lab" })

const stateModel = (state: State): Model => {
	const shared = sharedOf(state)
	const isEmpty = state === "overview-empty"
	const base = answered(
		steps(
			init(routeOf(state), shared).model,
			[
				Message.UpdatedConnections({
					connections: isEmpty ? [] : SOURCE_CONNECTIONS.map(toConnectionRow),
				}),
				Message.UpdatedSyncRuns({ runs: isEmpty ? [] : SOURCE_SYNC_RUNS.map(toSyncRunRow) }),
				Message.UpdatedAccountCount({ count: isEmpty ? 0 : ACCOUNTS.length }),
				Message.UpdatedMembers({ members: TEAM }),
			],
			shared,
		),
		shared,
	)
	const model = isEmpty ? step(base, Message.SucceededFetchUnmatchedCount({ count: 0 }), shared) : base
	const connect = steps(
		model,
		[
			Message.PressedConnect({ provider: "stripe" }),
			Message.ChangedApiKey({ value: "rk_live_51NqA8f2Lk" }),
		],
		shared,
	)
	switch (state) {
		case "connect":
			return connect
		case "connect-success":
			return answered(step(connect, Message.SubmittedConnect(), shared), shared)
		case "connect-failure":
			return steps(
				connect,
				[
					Message.SubmittedConnect(),
					Message.FailedConnect({ provider: "stripe", reason: "Refused" }),
				],
				shared,
			)
		case "connect-unavailable":
			return steps(
				connect,
				[
					Message.SubmittedConnect(),
					Message.FailedConnect({ provider: "stripe", reason: "ComingSoon" }),
				],
				shared,
			)
		case "detail-maple-settings":
			return steps(
				model,
				[
					Message.AddedMetricMapping(),
					Message.ChangedMetricMapping({ index: 3, field: "event", value: "ingest_batch" }),
					Message.ClickedLookback({ days: 180 }),
				],
				shared,
			)
		default:
			return model
	}
}

const toMessage = (message: Message) => message

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{ title: "Data sources", switches: [{ name: "state", values: STATES, current: currentState() }] },
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "sources",
						model,
						view,
						viewInputs: { shared: sharedOf(currentState()) },
						toParentMessage: toMessage,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Data sources", {
	Model,
	Flags: Schema.Struct({ state: State }),
	flags: Effect.all({ state: queryParam("state", STATES, "overview") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => {
		const shared = sharedOf(currentState())
		return { model: answered(step(model, message, shared), shared) }
	},
	view: labView,
})
