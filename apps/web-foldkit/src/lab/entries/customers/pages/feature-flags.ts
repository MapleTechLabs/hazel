import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { type AccountRow, toAccountRow } from "../../../../customers/queries"
import type { Shared } from "../../../../page/contract"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/feature-flags/message"
import { Model } from "../../../../page/customers/settings/feature-flags/model"
import { init, update } from "../../../../page/customers/settings/feature-flags/update"
import { view } from "../../../../page/customers/settings/feature-flags/view"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS } from "../../../fixtures/customers"

// `/lab/customers/pages/feature-flags`: the real feature flags settings page over the fixture
// accounts, with Clerk flags set here (`?state=`). Its update runs; the Clerk writes are dropped, the
// popover's and the dialog's own Commands run.

const STATES = ["default", "open", "long-names", "invalid-key", "empty", "read-only", "loading"] as const
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

const LONG_KEY = "enable_experimental_realtime_collaborative_dashboard_editor_v2:beta"
const LONG_NAME = "Consolidated International Widget Manufacturing Holdings GmbH & Co. KG"

/** An account's Clerk flags: every third has `new_dashboards`, every fifth `ai_assistant` off, the first two `beta_exports`. */
const flagsOf = (state: State, index: number): Record<string, boolean> => {
	const flags: Array<readonly [string, boolean]> = []
	if (state === "empty") return {}
	if (index % 3 === 0) flags.push(["new_dashboards", true])
	if (index % 5 === 0) flags.push(["ai_assistant", false])
	if (index < 2) flags.push(["beta_exports", true])
	if (state === "long-names" && index < 4) flags.push([LONG_KEY, true])
	return Object.fromEntries(flags)
}

const accountsOf = (state: State): ReadonlyArray<AccountRow> =>
	ACCOUNTS.map(toAccountRow).map((account, index) => ({
		...account,
		name: state === "long-names" && index === 0 ? LONG_NAME : account.name,
		featureFlags: flagsOf(state, index),
	}))

const NETWORK = new Set(["CreateFeatureFlag", "DeleteFeatureFlag", "SetFeatureFlagCustomers"])

const step = (model: Model, message: Message) => {
	const result = update(model, message, sharedOf())
	return {
		model: result.model,
		commands: (result.commands ?? []).filter((command) => !NETWORK.has(command.name)),
	}
}

const stateModel = (state: State): Model => {
	const opened = init().model
	if (state === "loading") return opened
	const messages = [
		Message.UpdatedCreated({ keys: state === "empty" ? [] : ["checkout_v2"] }),
		Message.UpdatedAccounts({ accounts: accountsOf(state) }),
		...(state === "open" || state === "long-names" || state === "read-only"
			? [Message.PressedFlag({ key: state === "long-names" ? LONG_KEY : "beta_exports" })]
			: []),
		...(state === "invalid-key" ? [Message.ChangedNewKey({ value: "-not a valid key!" })] : []),
	]
	return messages.reduce((model, message) => step(model, message).model, opened)
}

const toMessage = (message: Message) => message

export const lab = defineLabWithFlags("Feature flags settings", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: step,
	view: (model: Model, h: HtmlBuilder<Message>): Html =>
		labPage(
			h,
			{
				title: "Feature flags settings",
				switches: [{ name: "state", values: STATES, current: currentState() }],
			},
			[
				h.div(
					[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
					[
						h.submodel({
							slotId: "feature-flags",
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
