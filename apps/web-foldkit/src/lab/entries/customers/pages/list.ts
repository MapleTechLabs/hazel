import { CustomerSavedViewId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { msOf, toAccountRow, toSignalRow } from "../../../../customers/queries"
import { labShared } from "../../../../page/customers/lab-shared"
import type { FetchListSparklines } from "../../../../page/customers/list/commands"
import { Message } from "../../../../page/customers/list/message"
import { ALL_DRAFT, Model, type ViewRow } from "../../../../page/customers/list/model"
import { subscriptions } from "../../../../page/customers/list/subscription"
import { init, routeChanged, update } from "../../../../page/customers/list/update"
import { view } from "../../../../page/customers/list/view"
import { AppRoute } from "../../../../route"
import * as Menu from "../../../../ui/menu"
import * as Popover from "../../../../ui/popover"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import {
	ACCOUNTS,
	ACCOUNTS_BY_KEY,
	CONNECTIONS,
	ME,
	SETTINGS,
	SIGNALS,
	TEAM,
} from "../../../fixtures/customers"

// `/lab/customers/pages/list`: the real customers list over the fixtures. Its update runs; the
// sparklines answer from the fixtures, the other network Commands are dropped (bulk edits still
// apply to the rows at once). `?state=` picks a Wonder artboard.

const STATES = [
	"all",
	"at-risk",
	"filter",
	"columns",
	"bulk",
	"hover",
	"no-results",
	"first-run",
	"loading",
] as const
const State = Schema.Literals(STATES)
const Flags = Schema.Struct({ state: State })

const VIEW_IDS = Array.from({ length: 6 }, (_, index) =>
	Schema.decodeSync(CustomerSavedViewId)(`00000040-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
)

const builtIn = (
	index: number,
	builtInKey: NonNullable<ViewRow["builtInKey"]>,
	name: string,
	filters: ViewRow["filters"],
): ViewRow => ({
	id: VIEW_IDS[index]!,
	name,
	builtInKey,
	ownerUserId: null,
	position: index,
	filters,
	sort: { column: "mrr", direction: "desc" },
	columns: ALL_DRAFT.columns,
})

/** The seeded built-ins and one personal view. */
export const LIST_VIEWS: ReadonlyArray<ViewRow> = [
	builtIn(0, "my_customers", "My customers", { ownedByMe: true }),
	builtIn(1, "paying", "Paying", { payingOnly: true }),
	builtIn(2, "trialing", "Trialing", { lifecycleStages: ["trialing"] }),
	builtIn(3, "at_risk", "At risk", { healthStatuses: ["at_risk", "critical"] }),
	builtIn(4, "churned", "Churned", { lifecycleStages: ["churned"] }),
	{
		id: VIEW_IDS[5]!,
		name: "Scale renewals",
		builtInKey: null,
		ownerUserId: ME.id,
		position: 5,
		filters: { planNames: ["Scale"] },
		sort: { column: "customer_since", direction: "asc" },
		columns: ["name", "owner", "mrr", "health", "last_active", "customer_since", "tags"],
	},
]

/** 30 days of daily active users that end near the account's 30-day count and follow its trend. */
const sparklineOf = (accountId: string): ReadonlyArray<number> => {
	const account = ACCOUNTS.find((entry) => entry.id === accountId)
	if (account === undefined) return []
	const level = Math.max(0, account.activeUsers30d / 3)
	const trend = (account.activeUsersTrendPct ?? 0) / 100
	return Array.from({ length: 30 }, (_, day) => {
		const progress = day / 29
		const wobble = ((day * 7 + account.name.length) % 5) / 40
		return Math.max(0, Math.round((level * (1 - trend / 2 + trend * progress) + wobble) * 10) / 10)
	})
}

type Return = ReturnType<typeof update>
type AnyCommand = NonNullable<Return["commands"]>[number]

const isSparklineFetch = (command: AnyCommand): command is ReturnType<typeof FetchListSparklines> =>
	command.name === "FetchListSparklines"

const NETWORK = new Set([
	"FetchListSparklines",
	"CreateSavedView",
	"UpdateSavedView",
	"DeleteSavedView",
	"BulkAssignOwner",
	"BulkAddTag",
])

/** Runs the page's update; sparklines answer from the fixtures, other network Commands drop. */
const step = (model: Model, message: Message): { model: Model; commands: ReadonlyArray<AnyCommand> } => {
	const result = update(model, message, labShared)
	const fetches = (result.commands ?? []).filter(isSparklineFetch)
	const local = (result.commands ?? []).filter((command) => !NETWORK.has(command.name))
	return fetches.reduce<{ model: Model; commands: ReadonlyArray<AnyCommand> }>(
		(current, fetch) => {
			const ids = (fetch.args?.accountIds ?? []) as ReadonlyArray<string>
			const answered = step(
				current.model,
				Message.SucceededFetchSparklines({
					sparklines: ACCOUNTS.filter((account) => ids.includes(account.id)).map((account) => ({
						accountId: account.id,
						values: sparklineOf(account.id),
					})),
				}),
			)
			return { model: answered.model, commands: [...current.commands, ...answered.commands] }
		},
		{ model: result.model, commands: local },
	)
}

const run = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce<{ model: Model; commands: ReadonlyArray<AnyCommand> }>(
		(current, message) => {
			const next = step(current.model, message)
			return { model: next.model, commands: [...current.commands, ...next.commands] }
		},
		{ model, commands: [] },
	)

const routeOf = (view: string | null) =>
	AppRoute.CustomersList({ orgSlug: "lab", view: Option.fromNullishOr(view) })

const loaded = (view: string | null, empty = false) =>
	run(init(routeOf(view)).model, [
		Message.UpdatedMembers({ members: TEAM }),
		Message.UpdatedViews({ views: LIST_VIEWS }),
		Message.UpdatedSignals({ signals: empty ? [] : SIGNALS.map(toSignalRow) }),
		Message.UpdatedConnectedProviders({
			providers: empty ? [] : CONNECTIONS.map((connection) => connection.provider),
		}),
		Message.UpdatedLastComputedAt({
			lastComputedAtMs:
				SETTINGS.lastComputedAt === null ? null : msOf(SETTINGS.lastComputedAt) - 4 * 60_000,
		}),
		Message.UpdatedAccounts({ accounts: empty ? [] : ACCOUNTS.map(toAccountRow) }),
	])

const stateOf = (state: typeof State.Type) => {
	switch (state) {
		case "loading":
			return { model: init(routeOf(null)).model, commands: [] }
		case "first-run":
			return loaded(null, true)
		case "at-risk":
			return loaded("at_risk")
		case "filter": {
			const base = loaded(null)
			return run(base.model, [
				Message.PressedEditFilter({ field: "last_active" }),
				Message.ChangedPendingFilters({ filters: { inactiveForDays: 14 } }),
			])
		}
		case "columns":
			return run(loaded(null).model, [
				Message.GotColumnsPopoverMessage({ message: Popover.Message.RequestedOpen() }),
			])
		case "bulk": {
			const base = loaded(null)
			const picked = [
				ACCOUNTS_BY_KEY.brightfield.id,
				ACCOUNTS_BY_KEY.halcyon.id,
				ACCOUNTS_BY_KEY.oakridge.id,
			]
			return run(base.model, [
				...picked.map((accountId) => Message.ToggledRow({ accountId, isSelected: true })),
				Message.GotOwnerMenuMessage({
					message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
				}),
			])
		}
		case "hover": {
			const base = loaded(null)
			return { model: { ...base.model, hoveredId: ACCOUNTS_BY_KEY.acme.id }, commands: base.commands }
		}
		case "no-results": {
			const base = loaded(null)
			return {
				model: {
					...base.model,
					draft: {
						...base.model.draft,
						filters: { planNames: ["Scale"], inactiveForDays: 60, payingOnly: true },
					},
				},
				commands: base.commands,
			}
		}
		case "all":
			return loaded(null)
	}
}

const keys = Subscription.lift({ keys: subscriptions.keys })<Model, Message>({
	read: (model) => Option.some({ model, shared: labShared }),
	toParentMessage: (message) => message,
})

const toMessage = (message: Message) => message

const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "all"

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{ title: "Customers list", switches: [{ name: "state", values: STATES, current: currentState() }] },
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "customers-list",
						model,
						view,
						viewInputs: { shared: labShared },
						toParentMessage: toMessage,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Customers list", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "all") }),
	init: ({ state }) => stateOf(state),
	// Tabs navigate in the app; here they switch the view in place.
	update: (model: Model, message: Message) =>
		message._tag === "ClickedViewTab"
			? run(routeChanged(model, routeOf(message.key)).model, [
					Message.UpdatedViews({ views: model.views ?? [] }),
				])
			: step(model, message),
	view: labView,
	subscriptions: keys,
})
