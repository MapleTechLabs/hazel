/**
 * Hazel's production monitoring in Maple, declared next to the Workers it watches: per-service
 * alert rules and a services dashboard over the telemetry `hazelTelemetry` exports (`./maple.ts`).
 *
 * Alerts post into a Hazel channel through Hazel's own Maple integration: create the channel's
 * Maple webhook in Hazel (Integrations → Maple) and set its URL as `MAPLE_ALERTS_WEBHOOK_URL`.
 * Without it the rules are not declared, since a rule with no destination notifies nobody.
 *
 * Rules are `builder_query`s so they can scope to `deployment.environment = "production"`: preview
 * deploys report under the same service names.
 */
import * as Maple from "@maple-dev/alchemy"
import type * as Output from "alchemy/Output"
import { Effect, Option } from "effect"
import { optionalString } from "../config-helpers.ts"

/** The Workers that export through the Maple SDK (`hazelTelemetry`), by `service.name`. */
export const HAZEL_TELEMETRY_SERVICES = ["api", "bot-gateway"] as const

const PRODUCTION = `deployment.environment = "production"`

type TraceAggregation = "count" | "error_rate" | "p95_duration" | "p99_duration"

/** A traces query-builder draft, the shape alert rules and dashboard widgets share. */
const tracesQuery = (options: {
	readonly where: string
	readonly aggregation: TraceAggregation
	readonly groupBy?: ReadonlyArray<string>
}) => ({
	id: "q1",
	name: "A",
	enabled: true,
	hidden: false,
	where_clause: options.where,
	aggregation: options.aggregation,
	step_interval: "",
	order_by_direction: "desc",
	add_ons: {
		group_by: options.groupBy !== undefined,
		having: false,
		order_by: false,
		limit: false,
		legend: false,
	},
	group_by: options.groupBy ?? [],
	having: "",
	order_by: "",
	limit: "",
	legend: "",
	data_source: "traces",
})

/** Root spans of one service in production: request-level signals, not internal calls. */
const serviceRequests = (service: string) =>
	`service.name = "${service}" AND ${PRODUCTION} AND root_only = "true"`

const serviceAlerts = (service: string, destinationId: Output.Output<string>) =>
	Effect.all([
		Maple.AlertRule(`${service}-error-rate`, {
			name: `Hazel ${service}: error rate above 5%`,
			severity: "critical",
			signal_type: "builder_query",
			query_builder_draft: tracesQuery({ where: serviceRequests(service), aggregation: "error_rate" }),
			comparator: "gt",
			threshold: 0.05,
			window_minutes: 5,
			minimum_sample_count: 20,
			consecutive_breaches_required: 2,
			destination_ids: [destinationId],
			tags: ["hazel", service],
		}),
		Maple.AlertRule(`${service}-p95-latency`, {
			name: `Hazel ${service}: p95 latency above 2s`,
			severity: "warning",
			signal_type: "builder_query",
			query_builder_draft: tracesQuery({
				where: serviceRequests(service),
				aggregation: "p95_duration",
			}),
			comparator: "gt",
			threshold: 2000,
			window_minutes: 10,
			minimum_sample_count: 20,
			consecutive_breaches_required: 2,
			destination_ids: [destinationId],
			tags: ["hazel", service],
		}),
	])

const chart = (options: {
	readonly id: string
	readonly title: string
	readonly aggregation: TraceAggregation
	readonly unit: string
	readonly x: number
	readonly y: number
}) => ({
	id: options.id,
	visualization: "chart",
	data_source: {
		kind: "query",
		result_shape: "timeseries",
		queries: [
			tracesQuery({
				where: `${PRODUCTION} AND root_only = "true"`,
				aggregation: options.aggregation,
				groupBy: ["service.name"],
			}),
		],
	},
	display: {
		title: options.title,
		chart_id: "query-builder-line",
		unit: options.unit,
		chart_presentation: { legend: "visible" },
	},
	layout: { x: options.x, y: options.y, w: 6, h: 6, min_w: 2, min_h: 2 },
})

/** Golden signals of every Hazel service in production, one line per `service.name`. */
const servicesDashboard = Maple.Dashboard("services", {
	name: "Hazel services",
	description:
		"Production golden signals of the Hazel Workers (api, bot-gateway) over root spans. Managed by alchemy.run.ts: edits in the UI are overwritten on deploy.",
	tags: ["hazel"],
	time_range: { type: "relative", value: "12h" },
	widgets: [
		chart({ id: "throughput", title: "Requests", aggregation: "count", unit: "number", x: 0, y: 0 }),
		chart({
			id: "error-rate",
			title: "Error rate",
			aggregation: "error_rate",
			unit: "percent",
			x: 6,
			y: 0,
		}),
		chart({
			id: "p95",
			title: "p95 latency",
			aggregation: "p95_duration",
			unit: "duration_ms",
			x: 0,
			y: 6,
		}),
		chart({
			id: "p99",
			title: "p99 latency",
			aggregation: "p99_duration",
			unit: "duration_ms",
			x: 6,
			y: 6,
		}),
	],
})

/** Declare Hazel's Maple dashboard and, when a Hazel channel webhook is configured, its alerts. */
export const HazelMonitoring = Effect.gen(function* () {
	const dashboard = yield* servicesDashboard
	const webhookUrl = yield* optionalString("MAPLE_ALERTS_WEBHOOK_URL")
	if (Option.isNone(webhookUrl)) return { dashboardId: dashboard.dashboardId, alertRules: 0 }

	// Hazel's incoming Maple webhook (`/webhooks/incoming/:id/:token/maple`) renders the alert payload.
	const destination = yield* Maple.AlertDestination("hazel-alerts", {
		type: "webhook",
		name: "Hazel #alerts",
		url: webhookUrl.value.trim(),
	})
	const rules = yield* Effect.forEach(HAZEL_TELEMETRY_SERVICES, (service) =>
		serviceAlerts(service, destination.destinationId),
	)
	return { dashboardId: dashboard.dashboardId, alertRules: rules.flat().length }
})
