import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Shared } from "../../../../page/contract"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/plans/message"
import { Model } from "../../../../page/customers/settings/plans/model"
import { init, update } from "../../../../page/customers/settings/plans/update"
import { view } from "../../../../page/customers/settings/plans/view"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, SETTINGS } from "../../../fixtures/customers"

// `/lab/customers/pages/plans`: the real plans settings page over the fixtures (`?state=`). Its
// update runs; its Commands do not: `customers.plans.list` answers the fixture accounts' plans at
// once, and a save lands as if the settings row synced.

const STATES = ["default", "long-names", "empty", "read-only", "loading", "failed"] as const
type State = (typeof STATES)[number]
const Flags = Schema.Struct({ state: Schema.Literals(STATES) })

const currentState = (): State => {
	const value = new URLSearchParams(window.location.search).get("state")
	return STATES.find((state) => state === value) ?? "default"
}

const admin: Shared = {
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000000-0000-4000-8000-000000000911"),
		role: "admin",
	},
}
const sharedOf = (): Shared => (currentState() === "read-only" ? labShared : admin)

const FIXTURE_PLANS = [
	...new Set(ACCOUNTS.flatMap((account) => (account.planName === null ? [] : [account.planName]))),
]
const LONG_PLANS = [
	...FIXTURE_PLANS,
	"Enterprise Platinum Annual Plus Unlimited Seats and Priority Support (2026 pricing)",
	"Extra_seat_pack_monthly_billed_in_arrears_v3_legacy_grandfathered_customers_only",
]
const ADD_ONS = ["Extra_seat_pack_monthly_billed_in_arrears_v3_legacy_grandfathered_customers_only"]

const settingsOf = (state: State) => ({
	id: SETTINGS.id,
	addOnPlans: state === "long-names" ? ADD_ONS : [...SETTINGS.addOnPlans],
	overageInMrr: SETTINGS.overageInMrr,
})

/** A save lands at once: the row syncs with the change, then the RPC answers. */
const step = (model: Model, message: Message): Model => {
	const next = update(model, message, sharedOf()).model
	return next.isSaving ? update(next, Message.SucceededSaveSettings(), sharedOf()).model : next
}

const stateModel = (state: State): Model => {
	const opened = init(null, sharedOf()).model
	if (state === "loading") return opened
	const synced = step(opened, Message.UpdatedSettings({ settings: settingsOf(state) }))
	if (state === "failed") return step(synced, Message.FailedFetchPlans({ reason: "Unavailable" }))
	const plans = state === "empty" ? [] : state === "long-names" ? LONG_PLANS : FIXTURE_PLANS
	return step(synced, Message.SucceededFetchPlans({ plans }))
}

const toMessage = (message: Message) => message

export const lab = defineLabWithFlags("Plans settings", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({
		// Retry answers like the first fetch did.
		model:
			message._tag === "PressedRetry"
				? step(step(model, message), Message.SucceededFetchPlans({ plans: FIXTURE_PLANS }))
				: step(model, message),
	}),
	view: (model: Model, h: HtmlBuilder<Message>): Html =>
		labPage(
			h,
			{
				title: "Plans settings",
				switches: [{ name: "state", values: STATES, current: currentState() }],
			},
			[
				h.div(
					[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
					[
						h.submodel({
							slotId: "plans",
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
