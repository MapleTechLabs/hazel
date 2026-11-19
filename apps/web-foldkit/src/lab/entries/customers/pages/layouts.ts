import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerOverviewLayoutId, OrganizationMemberId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as OverviewData from "../../../../customers/overview/data"
import type { LayoutRow } from "../../../../customers/overview/rows"
import { type AccountRow, toAccountRow, toSignalRow } from "../../../../customers/queries"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/layouts/message"
import { Model } from "../../../../page/customers/settings/layouts/model"
import {
	init,
	type LayoutsRoute,
	routeChanged,
	update,
} from "../../../../page/customers/settings/layouts/update"
import { view } from "../../../../page/customers/settings/layouts/view"
import { AppRoute } from "../../../../route"
import * as Popover from "../../../../ui/popover"
import { defineLabWithFlags, queryParam } from "../../../define"
import { ACCOUNTS, ACCOUNTS_BY_KEY, ACME_DETAIL, SETTINGS, SIGNALS, TEAM } from "../../../fixtures/customers"
import {
	LAYOUTS,
	METRIC_DEFS,
	metricWindowsFor,
	OBSERVABILITY,
	SELF_SERVE,
	seriesFor,
} from "../../../fixtures/customers-overview"
import { labPage } from "../../../frame"

// `/lab/customers/pages/layouts`: the real Overview layouts page over the fixtures, signed in as an
// admin. Its update runs; reads answer from the fixtures (the dry run evaluates the rule over the
// fixture customers), writes succeed and go nowhere, and navigation between the list and the editor
// happens in place. `?state=` picks the Wonder artboard: the list, the new layout dialog, a blank
// editor, a chart selected with the metric picker open, a metric table selected previewing Kestrel
// (no logs), the rule popover with an overlap warning.

const STATES = [
	"list",
	"new-dialog",
	"editor-blank",
	"editor-chart",
	"editor-table",
	"editor-overlap",
] as const
const Flags = Schema.Struct({ state: Schema.Literals(STATES) })

const shared = {
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000036-0000-4000-8000-000000000001"),
		role: "admin" as const,
	},
}

const ENTERPRISE: Customers.LayoutRule = {
	match: "all",
	conditions: [{ _tag: "plan", planNames: ["Enterprise"] }],
}

// THE DRY RUN, OVER THE FIXTURES

const factsOf = (account: AccountRow): Customers.LayoutFacts => ({
	lifecycleStage: account.lifecycleStage,
	planName: account.planName,
	tags: account.tags,
	healthStatus: account.healthStatus,
	mrrMinor: account.mrrMinor,
	attributes: {},
	metricWindows: new Map(),
})

const ordered = LAYOUTS.filter((layout) => !layout.isDefault).sort(
	(left, right) => left.position - right.position,
)

/** Each fixture customer gets the first layout that matches, else the default. */
const ACCOUNT_ROWS: ReadonlyArray<AccountRow> = ACCOUNTS.map(toAccountRow).map((account) => ({
	...account,
	layoutId: Customers.resolveLayout(LAYOUTS, factsOf(account), null)?.id ?? null,
}))

const dryRun = (
	rule: Customers.LayoutRule,
	layoutId: string | null,
	position: number | null,
): Customers.LayoutDryRunResult => {
	const at =
		position ?? ordered.find((layout) => layout.id === layoutId)?.position ?? Number.NEGATIVE_INFINITY
	const earlier = ordered.filter((layout) => layout.id !== layoutId && layout.position < at)
	const matching = ACCOUNT_ROWS.filter((account) => Customers.ruleMatches(rule, factsOf(account)))
	const taken = new Map<LayoutRow, number>()
	for (const account of matching) {
		const first = earlier.find((layout) => Customers.ruleMatches(layout.rule, factsOf(account)))
		if (first !== undefined) taken.set(first, (taken.get(first) ?? 0) + 1)
	}
	const takenCount = [...taken.values()].reduce((sum, count) => sum + count, 0)
	return {
		matchingCount: matching.length,
		matching: matching.slice(0, 200).map((account) => ({ accountId: account.id, name: account.name })),
		takenBy: [...taken.entries()].map(([layout, count]) => ({
			layoutId: layout.id,
			name: layout.name,
			count,
		})),
		pinnedElsewhere: 0,
		effectiveCount: matching.length - takenCount,
	}
}

// THE PROGRAM

type Return = ReturnType<typeof update>
type AnyCommand = NonNullable<Return["commands"]>[number]

const asAccountId = (value: unknown) => Schema.decodeUnknownSync(CustomerAccountId)(value)

/** The fixture answer to a Command; "local" for one that stays in the browser, null for a write. */
const answer = (command: AnyCommand): Message | null | "local" => {
	const args = (command.args ?? {}) as Record<string, unknown>
	switch (command.name) {
		case "FetchLayoutDryRun":
			return Message.SucceededFetchLayoutDryRun({
				version: Number(args.version),
				result: dryRun(
					args.rule as Customers.LayoutRule,
					(args.layoutId as string | null) ?? null,
					(args.position as number | null) ?? null,
				),
			})
		case "WaitForLayoutDryRunDelay":
			return Message.ElapsedLayoutDryRunDelay({ version: Number(args.version) })
		case "FetchLayoutPreviewDetail": {
			const accountId = asAccountId(args.accountId)
			const account = ACCOUNTS.find((each) => each.id === accountId) ?? ACME_DETAIL.account
			return Message.SucceededFetchPreviewDetail({ accountId, detail: { ...ACME_DETAIL, account } })
		}
		case "FetchOverviewMetricWindows": {
			const accountId = asAccountId(args.accountId)
			return Message.GotOverviewDataMessage({
				message: OverviewData.Message.SucceededFetchMetricWindows({
					accountId,
					asked: String(args.asked),
					windows: metricWindowsFor(
						accountId,
						args.windows as ReadonlyArray<{ metricKey: string; days: number }>,
					),
				}),
			})
		}
		case "FetchOverviewChartSeries": {
			const accountId = asAccountId(args.accountId)
			return Message.GotOverviewDataMessage({
				message: OverviewData.Message.SucceededFetchChartSeries({
					accountId,
					widgetId: String(args.widgetId),
					asked: String(args.asked),
					series: seriesFor(
						accountId,
						args.metricKeys as ReadonlyArray<string>,
						args.range as OverviewData.ChartRange,
					),
				}),
			})
		}
		case "CreateOverviewLayout":
			return Message.SucceededCreateLayout()
		case "UpdateOverviewLayout":
			return Message.SucceededUpdateLayout({
				layoutId: Schema.decodeUnknownSync(CustomerOverviewLayoutId)(args.layoutId),
			})
		case "ReorderOverviewLayouts":
		case "DeleteOverviewLayout":
			return null
		default:
			return "local"
	}
}

type Step = { model: Model; commands: ReadonlyArray<AnyCommand> }

const isLayoutsRoute = (route: AppRoute): route is LayoutsRoute =>
	route._tag === "CustomersSettingsLayouts" ||
	route._tag === "CustomersSettingsLayoutNew" ||
	route._tag === "CustomersSettingsLayout"

/** Runs a Return: answers its reads, and follows navigation to another layouts route in place. */
const settle = (result: Return): Step => {
	let current = result.model
	const kept: Array<AnyCommand> = []
	const outMessage = result.outMessage
	if (outMessage?._tag === "RequestedNavigation" && isLayoutsRoute(outMessage.route)) {
		const next = settle(routeChanged(current, { ...outMessage.route, orgSlug: "lab" }, shared))
		current = next.model
		kept.push(...next.commands)
	}
	for (const command of result.commands ?? []) {
		const reply = answer(command)
		if (reply === "local") kept.push(command)
		else if (reply !== null) {
			const next = step(current, reply)
			current = next.model
			kept.push(...next.commands)
		}
	}
	return { model: current, commands: kept }
}

const step = (model: Model, message: Message): Step => settle(update(model, message, shared))

const steps = (start: Step, messages: ReadonlyArray<Message>): Step =>
	messages.reduce<Step>((current, message) => {
		const next = step(current.model, message)
		return { model: next.model, commands: [...current.commands, ...next.commands] }
	}, start)

const newRoute = (from: string, preview: AccountRow["id"] | null = null) =>
	AppRoute.CustomersSettingsLayoutNew({
		orgSlug: "lab",
		from: Option.some(from),
		name: Option.some("Enterprise expansion"),
		preview: Option.fromNullishOr(preview),
	})

const ROUTES = {
	list: AppRoute.CustomersSettingsLayouts({ orgSlug: "lab" }),
	"new-dialog": AppRoute.CustomersSettingsLayouts({ orgSlug: "lab" }),
	"editor-blank": newRoute("blank", ACCOUNTS_BY_KEY.northwind.id),
	"editor-chart": newRoute("observability", ACCOUNTS_BY_KEY.northwind.id),
	"editor-table": newRoute("observability", ACCOUNTS_BY_KEY.kestrel.id),
	"editor-overlap": AppRoute.CustomersSettingsLayout({
		orgSlug: "lab",
		layoutId: SELF_SERVE.id,
		preview: Option.some(ACCOUNTS_BY_KEY.kestrel.id),
	}),
} satisfies Record<(typeof STATES)[number], LayoutsRoute>

const open = (wrap: (message: Popover.Message) => Message) => wrap(Popover.Message.RequestedOpen())

const SCENES = {
	list: [],
	"new-dialog": [
		Message.PressedNewLayout(),
		Message.ChangedNewName({ value: "Enterprise expansion" }),
		Message.ClickedNewFrom({ from: "observability" }),
	],
	"editor-blank": [Message.EditedRule({ rule: ENTERPRISE })],
	"editor-chart": [
		Message.EditedRule({ rule: ENTERPRISE }),
		Message.ClickedWidget({ widgetId: "ingest-volume" }),
		open((message) => Message.GotPickerPopoverMessage({ message })),
	],
	"editor-table": [
		Message.EditedRule({ rule: ENTERPRISE }),
		Message.ClickedWidget({ widgetId: "feature-adoption" }),
	],
	"editor-overlap": [
		Message.EditedRule({ rule: { match: "all", conditions: [...OBSERVABILITY.rule.conditions] } }),
		open((message) => Message.GotRulePopoverMessage({ message })),
	],
} satisfies Record<(typeof STATES)[number], ReadonlyArray<Message>>

const initial = ({ state }: typeof Flags.Type): Step => {
	const started = settle(init(ROUTES[state], shared))
	const live = steps(started, [
		Message.UpdatedMetrics({ metrics: METRIC_DEFS }),
		Message.UpdatedAccounts({ accounts: ACCOUNT_ROWS }),
		Message.UpdatedSignals({ signals: SIGNALS.map(toSignalRow) }),
		Message.UpdatedMembers({ members: TEAM }),
		Message.UpdatedSettings({
			settings: {
				lastComputedAtMs: null,
				bands: SETTINGS.health.bands,
				reportingCurrency: SETTINGS.reportingCurrency,
			},
		}),
		Message.UpdatedLayouts({ layouts: LAYOUTS }),
	])
	return steps(live, SCENES[state])
}

const labView = (model: Model, h: HtmlBuilder<Message>): Html => {
	const params = new URLSearchParams(window.location.search)
	return labPage(
		h,
		{
			title: "Overview layouts",
			switches: [{ name: "state", values: STATES, current: params.get("state") ?? "list" }],
		},
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "layouts",
						model,
						view,
						viewInputs: { shared },
						toParentMessage: (message: Message) => message,
					}),
				],
			),
		],
	)
}

export const lab = defineLabWithFlags("Overview layouts", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "list") }),
	init: initial,
	update: step,
	view: labView,
})
