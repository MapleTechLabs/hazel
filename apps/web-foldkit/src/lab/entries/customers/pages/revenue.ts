import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Shared } from "../../../../page/contract"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/revenue/message"
import { isDirty, Model, toRules } from "../../../../page/customers/settings/revenue/model"
import { init, update } from "../../../../page/customers/settings/revenue/update"
import { view } from "../../../../page/customers/settings/revenue/view"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { SETTINGS } from "../../../fixtures/customers"
import {
	REVENUE_CATALOG,
	REVENUE_DRAFT_PREVIEW,
	REVENUE_PREVIEW,
	REVENUE_RULES,
} from "../../../fixtures/customers-revenue"

// `/lab/customers/pages/revenue`: the real revenue settings page over the fixtures (`?state=`). Its
// update runs; its Commands do not: the catalog and the preview answer at once, and a save lands as
// if the settings row synced.

const STATES = ["default", "no-rules", "unsaved", "incomplete", "read-only", "loading"] as const
type State = (typeof STATES)[number]
const Flags = Schema.Struct({ state: Schema.Literals(STATES) })

const currentState = (): State => {
	const value = new URLSearchParams(window.location.search).get("state")
	return STATES.find((state) => state === value) ?? "default"
}

const admin: Shared = {
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000000-0000-4000-8000-000000000921"),
		role: "admin",
	},
}
const sharedOf = (): Shared => (currentState() === "read-only" ? labShared : admin)

/** What the preview Command would have brought back, at once. */
const answered = (model: Model): Model =>
	AsyncData.isPending(model.preview.result)
		? update(
				model,
				Message.SucceededFetchRevenuePreview({
					version: model.preview.version,
					result: isDirty(model) ? REVENUE_DRAFT_PREVIEW : REVENUE_PREVIEW,
				}),
				sharedOf(),
			).model
		: model

const step = (model: Model, message: Message): Model => {
	const next = answered(update(model, message, sharedOf()).model)
	if (!next.isSaving || next.settings === null || next.draft === null) return next
	const synced = update(
		next,
		Message.UpdatedSettings({
			settings: {
				...next.settings,
				revenueRules: toRules(next.draft),
				variableMrrMonths: next.draft.variableMrrMonths,
			},
		}),
		sharedOf(),
	).model
	return answered(update(synced, Message.SucceededSaveRevenueSettings(), sharedOf()).model)
}

const stateModel = (state: State): Model => {
	const opened = init(null, sharedOf()).model
	if (state === "loading") return opened
	const loaded = [
		Message.SucceededFetchRevenueCatalog({ catalog: REVENUE_CATALOG }),
		Message.UpdatedSettings({
			settings: {
				id: SETTINGS.id,
				revenueRules: state === "no-rules" ? [] : REVENUE_RULES,
				variableMrrMonths: SETTINGS.variableMrrMonths,
				reportingCurrency: SETTINGS.reportingCurrency,
			},
		}),
	].reduce(step, opened)
	if (state === "unsaved") return step(loaded, Message.PressedDeleteRule({ ruleId: "rule-1" }))
	if (state === "incomplete") return step(loaded, Message.PressedAddRule())
	return loaded
}

const toMessage = (message: Message) => message

export const lab = defineLabWithFlags("Revenue settings", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({ model: step(model, message) }),
	view: (model: Model, h: HtmlBuilder<Message>): Html =>
		labPage(
			h,
			{
				title: "Revenue settings",
				switches: [{ name: "state", values: STATES, current: currentState() }],
			},
			[
				h.div(
					[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
					[
						h.submodel({
							slotId: "revenue",
							model,
							view,
							viewInputs: { shared: sharedOf() },
							toParentMessage: toMessage,
						}),
					],
				),
			],
		),
})
