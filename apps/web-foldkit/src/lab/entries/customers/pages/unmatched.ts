import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { toAccountRow } from "../../../../customers/queries"
import type { Shared } from "../../../../page/contract"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/unmatched/message"
import { Model, toIgnoreRuleRow, toRecordRow } from "../../../../page/customers/settings/unmatched/model"
import { initialModel, update } from "../../../../page/customers/settings/unmatched/update"
import { view } from "../../../../page/customers/settings/unmatched/view"
import * as Menu from "../../../../ui/menu"
import * as Popover from "../../../../ui/popover"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS } from "../../../fixtures/customers"
import { IGNORE_RULES, IGNORED_UNMATCHED, OPEN_UNMATCHED } from "../../../fixtures/customers-unmatched"

// `/lab/customers/pages/unmatched`: the real resolver over the fixtures. Its update runs; its Commands
// do not (links and ignores apply optimistically and stay). `?state=` picks a Wonder state.

const STATES = [
	"default",
	"link-menu-open",
	"more-menu-open",
	"ignored",
	"empty",
	"loading",
	"read-only",
] as const
const State = Schema.Literals(STATES)
const Flags = Schema.Struct({ state: State })

const memberId = Schema.decodeSync(OrganizationMemberId)("00000042-0000-4000-8000-000000000001")
const adminShared: Shared = { ...labShared, member: { id: memberId, role: "admin" } }
const memberShared: Shared = { ...labShared, member: { id: memberId, role: "member" } }

const loaded = (open: typeof OPEN_UNMATCHED): Model => ({
	...initialModel,
	open: AsyncData.Success({ data: { items: open.map(toRecordRow), nextCursor: null } }),
	ignored: AsyncData.Success({ data: { items: IGNORED_UNMATCHED.map(toRecordRow), nextCursor: null } }),
	rules: AsyncData.Success({ data: IGNORE_RULES.map(toIgnoreRuleRow) }),
	openCount: open.length,
	accounts: ACCOUNTS.map(toAccountRow),
})

const recordIdOf = (externalId: string) => {
	const record = OPEN_UNMATCHED.find((row) => row.externalId === externalId)
	if (record === undefined) throw new Error(`No unmatched fixture ${externalId}`)
	return record.id
}

const send = (model: Model, ...messages: ReadonlyArray<Message>): Model =>
	messages.reduce((current, message) => update(current, message, adminShared).model, model)

const stateModel = (state: typeof State.Type): Model => {
	switch (state) {
		case "loading":
			return {
				...initialModel,
				open: AsyncData.Loading(),
				ignored: AsyncData.Loading(),
				rules: AsyncData.Loading(),
			}
		case "empty":
			return loaded([])
		case "ignored":
			return { ...loaded(OPEN_UNMATCHED), tab: "ignored" }
		case "link-menu-open": {
			const recordId = recordIdOf("cus_S7hL2q")
			return send(
				loaded(OPEN_UNMATCHED),
				Message.GotLinkPopoverMessage({ recordId, message: Popover.Message.RequestedOpen() }),
				Message.ChangedLinkQuery({ value: "bright" }),
			)
		}
		case "more-menu-open":
			return send(
				loaded(OPEN_UNMATCHED),
				Message.GotRowMenuMessage({
					recordId: recordIdOf("staging-acme"),
					message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
				}),
			)
		case "default":
		case "read-only":
			return loaded(OPEN_UNMATCHED)
	}
}

/** The lab chrome reads its switch from the URL (lab-only, see `frame.ts`). */
const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "default"
const sharedOf = () => (currentState() === "read-only" ? memberShared : adminShared)

const toMessage = (message: Message) => message

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{
			title: "Unmatched records",
			switches: [{ name: "state", values: STATES, current: currentState() }],
		},
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "unmatched",
						model,
						view,
						viewInputs: { shared: sharedOf() },
						toParentMessage: toMessage,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Unmatched records", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({ model: update(model, message, sharedOf()).model }),
	view: labView,
})
