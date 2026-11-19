import { OrganizationMemberId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { labShared } from "../../../../page/customers/lab-shared"
import { Message } from "../../../../page/customers/settings/metrics/message"
import { Model, type MetricRow } from "../../../../page/customers/settings/metrics/model"
import {
	init,
	type MetricsRoute,
	routeChanged,
	update,
} from "../../../../page/customers/settings/metrics/update"
import { view } from "../../../../page/customers/settings/metrics/view"
import type { Shared } from "../../../../page/contract"
import { AppRoute } from "../../../../route"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import {
	COVERAGE,
	LAYOUTS,
	LOGS_SQL,
	METRICS,
	METRICS_EMPTY,
	METRICS_WITH_FAILURE,
	PREVIEW_REFUSED,
	previewOf,
} from "../../../fixtures/customers-metrics"

// `/lab/customers/pages/metrics`: the real metrics settings page (catalog and editor) over the
// fixtures. Its update runs; its Commands do not: coverage and previews answer from the fixtures at
// once, saves stay pending, and navigation inside the page is followed. `?state=` picks a state.

const STATES = [
	"catalog",
	"catalog-failed",
	"catalog-empty",
	"catalog-read-only",
	"new-builder",
	"new-sql-error",
	"product-event",
	"formula-unknown",
	"preview-loaded",
	"preview-error",
	"provider-read-only",
] as const
type State = (typeof STATES)[number]
const Flags = Schema.Struct({ state: Schema.Literals(STATES) })

const memberAs = (role: "admin" | "member", n: number): Shared => ({
	...labShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)(`00000040-0000-4000-8000-00000000000${n}`),
		role,
	},
})
const admin = memberAs("admin", 1)
const member = memberAs("member", 2)

/** The lab chrome reads its switch from the URL (lab-only, see `frame.ts`). */
const currentState = (): State => {
	const value = new URLSearchParams(window.location.search).get("state")
	return STATES.find((state) => state === value) ?? "catalog"
}
const sharedOf = (state: State): Shared => (state === "catalog-read-only" ? member : admin)

const ORG_SLUG = labShared.orgSlug ?? "lab"
const catalogRoute = AppRoute.CustomersSettingsMetrics({ orgSlug: ORG_SLUG }) as MetricsRoute
const metricRoute = (metricKey: string) =>
	AppRoute.CustomersSettingsMetric({ orgSlug: ORG_SLUG, metricKey }) as MetricsRoute
const newRoute = (key: string | null, source: "maple_query" | "product_event" | "formula" | null) =>
	AppRoute.CustomersSettingsMetricNew({
		orgSlug: ORG_SLUG,
		key: Option.fromNullishOr(key),
		source: Option.fromNullishOr(source),
	}) as MetricsRoute

const metricsOf = (state: State): ReadonlyArray<MetricRow> =>
	state === "catalog-failed" ? METRICS_WITH_FAILURE : state === "catalog-empty" ? METRICS_EMPTY : METRICS

/**
 * One page step: the Commands that read answer from the fixtures (`refused` makes a preview's query
 * fail), and navigation inside the page is followed.
 */
const step = (model: Model, message: Message, shared: Shared, refused = false): Model => {
	const result = update(model, message, shared)
	const answered = (result.commands ?? []).reduce((current, command) => {
		if (command.name === "FetchMetricCoverage")
			return update(current, Message.SucceededFetchCoverage({ metrics: COVERAGE }), shared).model
		if (command.name === "PreviewMetric") {
			const args = command.args as { run: number; source: Parameters<typeof previewOf>[0] }
			const answer = refused ? PREVIEW_REFUSED : previewOf(args.source, 7)
			return update(current, Message.SucceededPreviewMetric({ run: args.run, result: answer }), shared)
				.model
		}
		return current
	}, result.model)
	const outMessage = result.outMessage
	return outMessage?._tag === "RequestedNavigation" &&
		(outMessage.route._tag === "CustomersSettingsMetrics" ||
			outMessage.route._tag === "CustomersSettingsMetricNew" ||
			outMessage.route._tag === "CustomersSettingsMetric")
		? openRoute(answered, outMessage.route as MetricsRoute, shared)
		: answered
}

/** Opens a route as the page would, answering its reads. */
const openRoute = (model: Model, route: MetricsRoute, shared: Shared): Model => {
	const result = routeChanged(model, route, shared)
	return (result.commands ?? []).some((command) => command.name === "FetchMetricCoverage")
		? update(result.model, Message.SucceededFetchCoverage({ metrics: COVERAGE }), shared).model
		: result.model
}

const live = (state: State, shared: Shared): Model =>
	[
		Message.UpdatedMetrics({ metrics: metricsOf(state) }),
		Message.UpdatedLayouts({ layouts: LAYOUTS }),
		Message.SucceededFetchCoverage({ metrics: COVERAGE }),
	].reduce((current, message) => update(current, message, shared).model, init(catalogRoute, shared).model)

const stateModel = (state: State): Model => {
	const shared = sharedOf(state)
	const listed = openRoute(live(state, shared), catalogRoute, shared)
	switch (state) {
		case "catalog":
		case "catalog-failed":
		case "catalog-empty":
		case "catalog-read-only":
			return listed
		case "new-builder":
			return openRoute(listed, newRoute("metric_points_ingested", null), shared)
		case "new-sql-error":
			return [
				Message.ChangedName({ value: "Log bytes, newest first" }),
				Message.PressedEditSql(),
				Message.ChangedSql({ value: `${LOGS_SQL}\nORDER BY value DESC` }),
			].reduce(
				(current, message) => step(current, message, shared),
				openRoute(listed, newRoute(null, null), shared),
			)
		case "product-event":
			return openRoute(listed, metricRoute("mcp_tool_calls"), shared)
		case "formula-unknown":
			return [
				Message.ChangedName({ value: "Log bytes per span" }),
				Message.ChangedExpression({ value: "{logs_ingested_bytes} / {spans_total}" }),
			].reduce(
				(current, message) => step(current, message, shared),
				openRoute(listed, newRoute(null, "formula"), shared),
			)
		case "preview-loaded":
			return step(
				openRoute(listed, metricRoute("logs_ingested_bytes"), shared),
				Message.PressedRunPreview(),
				shared,
			)
		case "preview-error":
			return step(
				openRoute(listed, metricRoute("services_reporting"), shared),
				Message.PressedRunPreview(),
				shared,
				true,
			)
		case "provider-read-only":
			return openRoute(listed, metricRoute("autumn.api_calls"), shared)
	}
}

const toMessage = (message: Message) => message

const labView = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{ title: "Metrics settings", switches: [{ name: "state", values: STATES, current: currentState() }] },
		[
			h.div(
				[h.Class("h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.submodel({
						slotId: "metrics",
						model,
						view,
						viewInputs: { shared: sharedOf(currentState()) },
						toParentMessage: toMessage,
					}),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Metrics settings", {
	Model,
	Flags,
	flags: Effect.all({ state: queryParam("state", STATES, "catalog") }),
	init: ({ state }) => ({ model: stateModel(state) }),
	update: (model: Model, message: Message) => ({ model: step(model, message, sharedOf(currentState())) }),
	view: labView,
})
