import { Effect, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { msOf, toAccountRow, toSignalRow } from "../../../../customers/queries"
import { Message } from "../../../../page/customers/attention/message"
import { Model } from "../../../../page/customers/attention/model"
import { subscriptions } from "../../../../page/customers/attention/subscription"
import { init, update } from "../../../../page/customers/attention/update"
import { view } from "../../../../page/customers/attention/view"
import { labShared } from "../../../../page/customers/lab-shared"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, ACME_DETAIL, SETTINGS, SIGNALS, TEAM } from "../../../fixtures/customers"

// `/lab/customers/pages/attention`: the real Needs-attention page over the fixtures. Its update runs;
// its Commands do not (actions apply optimistically, the preview gets the fixture detail). The
// keyboard works. `?state=` picks a Wonder artboard.

const STATES = ["open", "grouped", "selected", "snoozed", "done", "all-clear", "loading"] as const
const State = Schema.Literals(STATES)
const Flags = Schema.Struct({ state: State })

const loaded = (all: boolean): Model => {
	const base = init().model
	return {
		...base,
		accounts: ACCOUNTS.map(toAccountRow),
		signals: SIGNALS.map(toSignalRow).filter((signal) => all || signal.status !== "open"),
		members: TEAM,
		lastComputedAtMs: SETTINGS.lastComputedAt === null ? null : msOf(SETTINGS.lastComputedAt),
	}
}

/** The fixture detail stands in for `customers.account.detail`, for whichever account is previewed. */
const withFixtureDetail = (model: Model): Model =>
	model.detail !== null && model.detail.data._tag === "Loading"
		? {
				...model,
				detail: {
					accountId: model.detail.accountId,
					data: AsyncData.Success({
						data: {
							...ACME_DETAIL,
							account:
								ACCOUNTS.find((account) => account.id === model.detail?.accountId) ??
								ACME_DETAIL.account,
						},
					}),
				},
			}
		: model

const stateModel = (state: typeof State.Type): Model => {
	if (state === "loading") return init().model
	if (state === "all-clear") return loaded(false)
	const model = loaded(true)
	if (state === "grouped") return { ...model, grouping: "accounts" }
	if (state === "snoozed") return { ...model, tab: "snoozed" }
	if (state === "done") return { ...model, tab: "done" }
	if (state === "selected") {
		const first = update(model, Message.PressedQueueKey({ key: "preview" }), labShared).model
		return withFixtureDetail(update(first, Message.PressedQueueKey({ key: "next" }), labShared).model)
	}
	return model
}

const keys = Subscription.lift({ keys: subscriptions.keys })<Model, Message>({
	read: (model) => Option.some({ model, shared: labShared }),
	toParentMessage: (message) => message,
})

const toMessage = (message: Message) => message

/** The lab chrome reads its switch from the URL (lab-only, see `frame.ts`). */
const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "open"

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{ title: "Needs attention", switches: [{ name: "state", values: STATES, current: currentState() }] },
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "attention",
						model,
						view,
						viewInputs: { shared: labShared },
						toParentMessage: toMessage,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Needs attention", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "open") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({
		model: withFixtureDetail(update(model, message, labShared).model),
	}),
	view: labView,
	subscriptions: keys,
})
