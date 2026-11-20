import { Effect, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { toAccountRow } from "../../../../customers/queries"
import { Message } from "../../../../page/customers/inbox/message"
import { Model } from "../../../../page/customers/inbox/model"
import { subscriptions } from "../../../../page/customers/inbox/subscription"
import { init, update } from "../../../../page/customers/inbox/update"
import { view } from "../../../../page/customers/inbox/view"
import { labShared } from "../../../../page/customers/lab-shared"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, TEAM } from "../../../fixtures/customers"
import { ISSUE_CHANNELS, ISSUES } from "../../../fixtures/issues"

// `/lab/customers/pages/inbox`: the real Support inbox over the fixtures. Its update runs; its
// Commands do not (changes apply optimistically). The keyboard works. `?state=` picks a state.

export const INBOX_STATES = [
	"open",
	"selected",
	"filtered",
	"closed",
	"inbox-zero",
	"empty",
	"loading",
] as const
const State = Schema.Literals(INBOX_STATES)
const Flags = Schema.Struct({ state: State })

const loaded = (issues = ISSUES): Model => ({
	...init().model,
	accounts: ACCOUNTS.map(toAccountRow),
	issues,
	channels: ISSUE_CHANNELS,
	members: TEAM,
})

export const inboxStateModel = (state: typeof State.Type): Model => {
	switch (state) {
		case "loading":
			return init().model
		case "empty":
			return loaded([])
		case "inbox-zero":
			return loaded(
				ISSUES.filter(
					(issue) =>
						issue.status === "closed" ||
						(issue.assigneeUserId !== null && issue.assigneeUserId !== labShared.currentUser?.id),
				),
			)
		case "closed":
			return { ...loaded(), tab: "closed" }
		case "filtered":
			return {
				...loaded(),
				filters: {
					assignee: "anyone",
					waitingOnUs: true,
					accountId: null,
					priority: "high",
					status: null,
				},
			}
		case "selected":
			return update(
				update(loaded(), Message.PressedInboxKey({ key: "next" }), labShared).model,
				Message.PressedInboxKey({ key: "next" }),
				labShared,
			).model
		case "open":
			return loaded()
	}
}

const keys = Subscription.lift({ keys: subscriptions.keys })<Model, Message>({
	read: (model) => Option.some({ model, shared: labShared }),
	toParentMessage: (message) => message,
})

const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "open"

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{
			title: "Support inbox",
			switches: [{ name: "state", values: INBOX_STATES, current: currentState() }],
		},
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "inbox",
						model,
						view,
						viewInputs: { shared: labShared },
						toParentMessage: (message: Message) => message,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Support inbox", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", INBOX_STATES, "open") }),
	init: ({ state }) => ({ model: inboxStateModel(state) }),
	update: (model: Model, message: Message) => ({ model: update(model, message, labShared).model }),
	view: labView,
	subscriptions: keys,
})
