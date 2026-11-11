import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { toAccountRow } from "../../../../customers/queries"
import type { Shared } from "../../../../page/contract"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/health/message"
import { Model } from "../../../../page/customers/settings/health/model"
import { sliderSubscriptions } from "../../../../page/customers/settings/health/subscription"
import { init, update } from "../../../../page/customers/settings/health/update"
import { view } from "../../../../page/customers/settings/health/view"
import * as Select from "../../../../ui/select"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, SETTINGS } from "../../../fixtures/customers"
import {
	HEALTH_DRAFT,
	HEALTH_DRY_RUN,
	HEALTH_INVALID_DRAFT,
	savedBreakdownOf,
} from "../../../fixtures/customers-health"

// `/lab/customers/pages/health`: the real health settings page over the fixtures (`?state=`). Its
// update runs; its Commands do not: the dry run answers `HEALTH_DRY_RUN`, a picked customer its
// fixture breakdown, and a save lands as if the settings row synced.

const STATES = ["default", "unsaved", "invalid", "check-customer", "read-only", "loading"] as const
const State = Schema.Literals(STATES)
const Flags = Schema.Struct({ state: State })

const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "default"

const adminShared: Shared = {
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000000-0000-4000-8000-000000000901"),
		role: "admin",
	},
}
const sharedOf = (): Shared => (currentState() === "read-only" ? labShared : adminShared)

/** What the Commands would have brought back: the dry run at once (no delay), the picked breakdown. */
const answered = (model: Model): Model => {
	const dryRun = AsyncData.isPending(model.preview.result)
		? update(
				model,
				Message.SucceededFetchHealthDryRun({
					version: model.preview.version,
					result: HEALTH_DRY_RUN,
				}),
				sharedOf(),
			).model
		: model
	return dryRun.check !== null && AsyncData.isLoading(dryRun.check.saved)
		? {
				...dryRun,
				check: {
					...dryRun.check,
					saved: AsyncData.Success({ data: savedBreakdownOf(dryRun.check.accountId) }),
				},
			}
		: dryRun
}

const step = (model: Model, message: Message): Model => {
	const next = answered(update(model, message, sharedOf()).model)
	if (!next.isSaving || next.settings === null || next.draft === null) return next
	const synced = { ...next, settings: { ...next.settings, health: next.draft } }
	return answered(update(synced, Message.SucceededSaveHealthSettings(), sharedOf()).model)
}

const stateModel = (state: typeof State.Type): Model => {
	const base = init().model
	if (state === "loading") return base
	const loaded = [
		Message.UpdatedSettings({
			settings: {
				id: SETTINGS.id,
				health: SETTINGS.health,
				reportingCurrency: SETTINGS.reportingCurrency,
			},
		}),
		Message.UpdatedAccounts({ accounts: ACCOUNTS.map(toAccountRow) }),
	].reduce(step, base)
	if (state === "unsaved" || state === "check-customer") {
		const unsaved = [
			Message.ChangedWeight({ key: "usage", value: HEALTH_DRAFT.weights.usage }),
			Message.ChangedWeight({ key: "engagement", value: HEALTH_DRAFT.weights.engagement }),
		].reduce(step, loaded)
		if (state === "unsaved") return unsaved
		// The second sample, picked as opening the picker and clicking its option would.
		const items = ACCOUNTS.map((account) => Select.item(account.id, account.name))
		const key = HEALTH_DRY_RUN.samples[1]?.accountId ?? ""
		return [
			Select.Message.PressedTrigger({ pointerType: "mouse" }),
			Select.Message.ClickedOption({ key, items }),
		]
			.map((message) => Message.GotCheckAccountMessage({ message }))
			.reduce(step, unsaved)
	}
	if (state === "invalid")
		return step(
			loaded,
			Message.ChangedWeight({ key: "usage", value: HEALTH_INVALID_DRAFT.weights.usage }),
		)
	return loaded
}

const sliders = Subscription.lift(sliderSubscriptions)<Model, Message>({
	read: (model) => Option.some({ model, shared: sharedOf() }),
	toParentMessage: (message) => message,
})

const toMessage = (message: Message) => message

export const lab = defineLabWithFlags("Health score settings", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({ model: step(model, message) }),
	view: (model: Model, h: HtmlBuilder<Message>): Html =>
		labPage(
			h,
			{
				title: "Health score settings",
				switches: [{ name: "state", values: STATES, current: currentState() }],
			},
			[
				h.div(
					[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
					[
						h.submodel({
							slotId: "health",
							model,
							view,
							viewInputs: { shared: sharedOf() },
							toParentMessage: toMessage,
						}),
					],
				),
			],
		),
	subscriptions: sliders,
})
