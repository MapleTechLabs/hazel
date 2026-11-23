import { CustomerImpersonatorId, type UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Shared } from "../../../../page/contract"
import { Message } from "../../../../page/customers/settings/sources/message"
import { configRows, Model, settingsFieldsOf } from "../../../../page/customers/settings/sources/model"
import { toConnectionRows, toSyncRunRow } from "../../../../page/customers/settings/sources/queries"
import { init, update } from "../../../../page/customers/settings/sources/update"
import { view } from "../../../../page/customers/settings/sources/view"
import { AppRoute } from "../../../../route"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, NOW, INVOICES_CONNECTION, TEAM } from "../../../fixtures/customers"
import {
	ADMIN_SHARED,
	IMPERSONATIONS,
	IMPERSONATORS,
	MEMBER_SHARED,
	SOURCE_CONNECTIONS,
	SOURCE_SYNC_RUNS,
	UNMATCHED_OPEN_COUNT,
} from "../../../fixtures/customers-sources"
import { ACTIVITY, DIRECTORY, INVOICES, PLANS } from "../../../fixtures/customers-demo-sources"

// `/lab/customers/pages/sources`: the real Data sources page (overview, connect modal, a source's
// detail) over the fixtures. Its update runs; its Commands do not: every pending RPC is answered
// with its success Message from here. `?state=` picks a Wonder artboard.

const DETAIL_STATE = `detail-${DIRECTORY.id}`
const SETTINGS_STATE = `detail-${ACTIVITY.id}-settings`

const STATES: ReadonlyArray<string> = [
	"overview",
	"overview-empty",
	"connect",
	"connect-success",
	"connect-failure",
	"connect-unavailable",
	DETAIL_STATE,
	SETTINGS_STATE,
	"detail-not-connected",
	"read-only",
]
const State = Schema.Literals(STATES)
type State = typeof State.Type

/** One edit of each kind on the activity source's settings: a row, its first cell, a number. */
const settingsEdits: ReadonlyArray<Message> = settingsFieldsOf(ACTIVITY.demo.sampleConfig).flatMap(
	(field): ReadonlyArray<Message> =>
		"columns" in field
			? [
					Message.AddedSettingsRow({ key: field.key }),
					Message.ChangedSettingsCell({
						key: field.key,
						index: configRows(ACTIVITY.demo.sampleConfig, field.key).length,
						column: field.columns[0].key,
						value: "ingest_batch",
					}),
				]
			: "options" in field
				? [Message.ClickedSettingsNumber({ key: field.key, value: 180 })]
				: [],
)

const sharedOf = (state: string): Shared => (state === "read-only" ? MEMBER_SHARED : ADMIN_SHARED)
const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "overview"

const step = (model: Model, message: Message, shared: Shared): Model => update(model, message, shared).model
const steps = (model: Model, messages: ReadonlyArray<Message>, shared: Shared): Model =>
	messages.reduce((current, message) => step(current, message, shared), model)

/** Add member and Remove change the grants at once, as their synced rows would. */
const impersonatorsAnswered = (
	model: Model,
	commands: ReadonlyArray<{ readonly name: string; readonly args?: unknown }>,
	shared: Shared,
): Model => {
	let rows = model.impersonators
	const answers: Array<Message> = []
	for (const command of commands) {
		const args = command.args as { readonly userId: UserId; readonly grantedBy: UserId }
		if (command.name === "GrantCustomerImpersonator") {
			rows = [
				...rows,
				{
					id: Schema.decodeSync(CustomerImpersonatorId)(
						`00000026-0000-4000-8000-${String(100 + rows.length).padStart(12, "0")}`,
					),
					userId: args.userId,
					grantedBy: args.grantedBy,
					grantedAtMs: NOW.getTime(),
				},
			]
		} else if (command.name === "RevokeCustomerImpersonator") {
			rows = rows.filter((row) => row.userId !== args.userId)
		} else continue
		answers.push(Message.SucceededImpersonatorAction({ userId: args.userId }))
	}
	return answers.length === 0
		? model
		: steps(model, [Message.UpdatedImpersonators({ impersonators: rows }), ...answers], shared)
}

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
								connectionId: INVOICES_CONNECTION.id,
								accountName: "Northwind Inc.",
							})
						: Message.SucceededSaveWebhookSecret({ connectionId: form.connected.connectionId }),
				]
			: []),
		...(model.keysForm?.isPending === true ? [Message.SucceededUpdateKeys()] : []),
		...model.syncing.map((connectionId) => Message.SucceededSyncNow({ connectionId })),
		...(model.isDisconnecting
			? [Message.SucceededDisconnect({ provider: model.provider ?? DIRECTORY.id })]
			: []),
		...(model.isSeedingDemo
			? [
					Message.SucceededSeedDemo(),
					Message.UpdatedConnections({ connections: toConnectionRows(SOURCE_CONNECTIONS) }),
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
	state === DETAIL_STATE
		? AppRoute.CustomersSourceDetail({ orgSlug: "lab", provider: DIRECTORY.id })
		: state === SETTINGS_STATE
			? AppRoute.CustomersSourceDetail({ orgSlug: "lab", provider: ACTIVITY.id })
			: state === "detail-not-connected"
				? AppRoute.CustomersSourceDetail({ orgSlug: "lab", provider: PLANS.id })
				: AppRoute.CustomersSettingsSources({ orgSlug: "lab" })

const stateModel = (state: State): Model => {
	const shared = sharedOf(state)
	const isEmpty = state === "overview-empty"
	const base = answered(
		steps(
			init(routeOf(state), shared).model,
			[
				Message.UpdatedConnections({
					connections: isEmpty ? [] : toConnectionRows(SOURCE_CONNECTIONS),
				}),
				Message.UpdatedSyncRuns({ runs: isEmpty ? [] : SOURCE_SYNC_RUNS.map(toSyncRunRow) }),
				Message.UpdatedAccountCount({ count: isEmpty ? 0 : ACCOUNTS.length }),
				Message.UpdatedMembers({ members: TEAM }),
				Message.UpdatedImpersonators({ impersonators: IMPERSONATORS }),
				Message.UpdatedImpersonations({ impersonations: IMPERSONATIONS }),
			],
			shared,
		),
		shared,
	)
	const model = isEmpty ? step(base, Message.SucceededFetchUnmatchedCount({ count: 0 }), shared) : base
	const connect = steps(
		model,
		[
			Message.PressedConnect({ provider: INVOICES.id }),
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
					Message.FailedConnect({ provider: INVOICES.id, reason: "Refused" }),
				],
				shared,
			)
		case "connect-unavailable":
			return steps(
				connect,
				[
					Message.SubmittedConnect(),
					Message.FailedConnect({ provider: INVOICES.id, reason: "ComingSoon" }),
				],
				shared,
			)
		case SETTINGS_STATE:
			return steps(model, settingsEdits, shared)
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
		const result = update(model, message, shared)
		return {
			model: answered(impersonatorsAnswered(result.model, result.commands ?? [], shared), shared),
		}
	},
	view: labView,
})
