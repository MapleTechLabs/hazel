import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { msOf, toAccountRow, toSignalRow } from "../../../../customers/queries"
import { labShared } from "../../../../page/customers/lab-shared"
import { draftOf } from "../../../../page/customers/settings/signals/draft"
import { Message } from "../../../../page/customers/settings/signals/message"
import { currencyOf, Model } from "../../../../page/customers/settings/signals/model"
import {
	init,
	routeChanged,
	type SignalsRoute,
	update,
} from "../../../../page/customers/settings/signals/update"
import { view } from "../../../../page/customers/settings/signals/view"
import type { Shared } from "../../../../page/contract"
import { AppRoute } from "../../../../route"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { ACCOUNTS, CONNECTIONS, SETTINGS, SIGNALS } from "../../../fixtures/customers"
import { dryRunOf, METRIC_DEFINITIONS, ruleOf, SCOPED_RULES } from "../../../fixtures/customers-signals"

// `/lab/customers/pages/signals`: the real signals settings page (list, picker, editor) over the
// fixtures. Its update runs; its Commands do not: the dry run answers from `dryRunOf` at once, saves
// and toggles stay optimistic, and navigation inside the page (rows, Set up, Close) is followed.
// `?state=` picks a Wonder artboard or an edge state.

const STATES = [
	"list",
	"list-read-only",
	"picker",
	"editor-inactive",
	"editor-usage-drop",
	"editor-new",
	"editor-invalid",
	"preview-loading",
	"preview-missing-source",
] as const
type State = (typeof STATES)[number]
const Flags = Schema.Struct({ state: Schema.Literals(STATES) })

const admin: Shared = {
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000040-0000-4000-8000-000000000001"),
		role: "admin",
	},
}
const member: Shared = {
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000040-0000-4000-8000-000000000002"),
		role: "member",
	},
}

/** The lab chrome reads its switch from the URL (lab-only, see `frame.ts`). */
const currentState = (): State => {
	const value = new URLSearchParams(window.location.search).get("state")
	return STATES.find((state) => state === value) ?? "list"
}
const sharedOf = (state: State): Shared => (state === "list-read-only" ? member : admin)

const ORG_SLUG = labShared.orgSlug ?? "lab"
const signalsRoute = AppRoute.CustomersSettingsSignals({ orgSlug: ORG_SLUG }) as SignalsRoute
const ruleRoute = (template: Parameters<typeof ruleOf>[0]) =>
	AppRoute.CustomersSettingsSignalRule({ orgSlug: ORG_SLUG, ruleId: ruleOf(template).id }) as SignalsRoute

/** The synced rows, as the Subscriptions would deliver them. */
const live = (model: Model, shared: Shared): Model =>
	[
		Message.UpdatedAccounts({ accounts: ACCOUNTS.map(toAccountRow) }),
		Message.UpdatedSignals({ signals: SIGNALS.map(toSignalRow) }),
		Message.UpdatedConnectedProviders({
			providers: CONNECTIONS.filter((row) => row.status !== "disconnected").map((row) => row.provider),
		}),
		Message.UpdatedSettings({
			settings: {
				lastComputedAtMs:
					SETTINGS.lastComputedAt === null ? null : msOf(SETTINGS.lastComputedAt) - 13 * 60_000,
				bands: SETTINGS.health.bands,
				reportingCurrency: SETTINGS.reportingCurrency,
			},
		}),
		Message.UpdatedMetrics({
			metrics: METRIC_DEFINITIONS.map((metric) => ({
				key: metric.key,
				name: metric.name,
				unit: metric.unit,
				provider: metric.provider,
				description: metric.description,
			})),
		}),
		Message.UpdatedRules({
			rules: SCOPED_RULES.map((rule) => ({
				id: rule.id,
				name: rule.name,
				template: rule.template,
				kind: rule.kind,
				severity: rule.severity,
				config: rule.config,
				scope: rule.scope,
				enabled: rule.enabled,
				lastTriggeredAtMs: rule.lastTriggeredAt === null ? null : msOf(rule.lastTriggeredAt),
				matchingCount: rule.matchingCount,
				updatedAtMs: msOf(rule.updatedAt),
			})),
		}),
	].reduce((current, message) => update(current, message, shared).model, model)

/** Answers a pending dry run from the fixtures (the lab's `customers.rule.dryRun`). */
const withFixturePreview = (model: Model): Model => {
	const editor = model.editor
	if (editor === null || editor.form === null || !AsyncData.isPending(editor.preview)) return model
	return Option.match(draftOf(editor.form, currencyOf(model)), {
		onNone: () => model,
		onSome: (draft) =>
			update(
				model,
				Message.SucceededFetchDryRun({
					version: editor.version,
					result: dryRunOf(draft, editor.ruleId),
				}),
				admin,
			).model,
	})
}

/** One page step: the debounce elapses at once, the dry run answers, navigation inside the page is followed. */
const step = (model: Model, message: Message, shared: Shared): Model => {
	const result = update(model, message, shared)
	const waited = (result.commands ?? []).some((command) => command.name === "WaitForRuleDryRunDelay")
	const elapsed =
		waited && result.model.editor !== null
			? update(
					result.model,
					Message.ElapsedRuleDryRunDelay({ version: result.model.editor.version }),
					shared,
				).model
			: result.model
	const outMessage = result.outMessage
	const navigated =
		outMessage?._tag === "RequestedNavigation" &&
		(outMessage.route._tag === "CustomersSettingsSignals" ||
			outMessage.route._tag === "CustomersSettingsSignalNew" ||
			outMessage.route._tag === "CustomersSettingsSignalRule")
			? routeChanged(elapsed, outMessage.route as SignalsRoute, shared).model
			: elapsed
	return withFixturePreview(navigated)
}

const stateModel = (state: State): Model => {
	const shared = sharedOf(state)
	const listed = live(init(signalsRoute, shared).model, shared)
	const open = (route: SignalsRoute) => withFixturePreview(routeChanged(listed, route, shared).model)
	switch (state) {
		case "list":
		case "list-read-only":
			return listed
		case "picker": {
			const picking = update(listed, Message.PressedNewSignal(), shared).model
			return update(picking, Message.ClickedTemplate({ template: "usage_drop" }), shared).model
		}
		case "editor-inactive":
			return step(open(ruleRoute("inactive")), Message.ToggledScopeStage({ stage: "past_due" }), shared)
		case "editor-usage-drop":
			return open(ruleRoute("usage_drop"))
		case "editor-new":
			return open(
				AppRoute.CustomersSettingsSignalNew({
					orgSlug: ORG_SLUG,
					template: Option.some("champion_inactive"),
				}) as SignalsRoute,
			)
		case "editor-invalid":
			return step(
				open(ruleRoute("inactive")),
				Message.ChangedConfigNumber({ key: "inactiveDays", value: "0" }),
				shared,
			)
		case "preview-loading":
			return routeChanged(listed, ruleRoute("payment_failed"), shared).model
		case "preview-missing-source":
			return open(ruleRoute("near_limit"))
	}
}

const toMessage = (message: Message) => message

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{ title: "Signals settings", switches: [{ name: "state", values: STATES, current: currentState() }] },
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "signals",
						model,
						view,
						viewInputs: { shared: sharedOf(currentState()) },
						toParentMessage: toMessage,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Signals settings", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "list") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({ model: step(model, message, sharedOf(currentState())) }),
	view: labView,
})
