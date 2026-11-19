import * as Customers from "@hazel/domain/customers"
import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerMetricDefinitionCollection } from "~/db/collections"
import { awaitSynced } from "../../../../customers/await-synced"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message } from "./message"
import { PREVIEW_DAYS } from "./model"

/**
 * The metrics page's Commands: the catalog's coverage, the preview, and the metric writes. A write
 * waits for its transaction to sync (best effort), so the editor it opens or leaves is current.
 */

export const FetchMetricCoverage = Command.define("FetchMetricCoverage", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchCoverage, Message.FailedFetchCoverage],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("customers.metrics.coverage", { organizationId })).pipe(
			Effect.map((result) => Message.SucceededFetchCoverage({ metrics: result.metrics })),
			catchCommon((reason) => Message.FailedFetchCoverage({ reason })),
		),
})

/** The source over the last days, unsaved; `run` tags the answer. */
export const PreviewMetric = Command.define("PreviewMetric", {
	args: {
		organizationId: OrganizationId,
		run: Schema.Int,
		source: Customers.MetricSource,
		aggregation: Customers.MetricAggregation,
	},
	messages: [Message.SucceededPreviewMetric, Message.FailedPreviewMetric],
	execute: ({ organizationId, run, source, aggregation }) =>
		HazelRpc.use((rpc) =>
			rpc("customers.metric.preview", { organizationId, source, aggregation, days: PREVIEW_DAYS }),
		).pipe(
			Effect.map((result) => Message.SucceededPreviewMetric({ run, result })),
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(Message.FailedPreviewMetric({ run, reason: "Invalid" })),
			),
			catchCommon((reason) => Message.FailedPreviewMetric({ run, reason })),
		),
})

export const CreateMetric = Command.define("CreateMetric", {
	args: {
		organizationId: OrganizationId,
		/** The editor that asked: only it opens the new metric. */
		editorId: Schema.Int,
		key: Customers.UserMetricKey,
		metric: Customers.MetricDraft,
	},
	messages: [Message.SucceededCreateMetric, Message.FailedCreateMetric],
	execute: ({ organizationId, editorId, key, metric }) =>
		HazelRpc.use((rpc) => rpc("customers.metric.create", { organizationId, key, metric })).pipe(
			Effect.tap((result) => awaitSynced(customerMetricDefinitionCollection, result.transactionId)),
			Effect.map((result) => Message.SucceededCreateMetric({ editorId, metricKey: result.data.key })),
			Effect.catchTag("CustomersInvalidRequestError", (error) =>
				Effect.succeed(
					Message.FailedCreateMetric({ editorId, reason: "Invalid", detail: error.message }),
				),
			),
			catchCommon((reason) => Message.FailedCreateMetric({ editorId, reason, detail: null })),
		),
})

export const UpdateMetric = Command.define("UpdateMetric", {
	args: { organizationId: OrganizationId, metricKey: Schema.String, metric: Customers.MetricDraft },
	messages: [Message.SucceededUpdateMetric, Message.FailedUpdateMetric],
	execute: ({ organizationId, metricKey, metric }) =>
		HazelRpc.use((rpc) => rpc("customers.metric.update", { organizationId, metricKey, metric })).pipe(
			Effect.tap((result) => awaitSynced(customerMetricDefinitionCollection, result.transactionId)),
			Effect.as(Message.SucceededUpdateMetric({ metricKey })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(
						Message.FailedUpdateMetric({ metricKey, reason: "NotFound", detail: null }),
					),
				CustomersInvalidRequestError: (error) =>
					Effect.succeed(
						Message.FailedUpdateMetric({ metricKey, reason: "Invalid", detail: error.message }),
					),
			}),
			catchCommon((reason) => Message.FailedUpdateMetric({ metricKey, reason, detail: null })),
		),
})

export const DeleteMetric = Command.define("DeleteMetric", {
	args: { organizationId: OrganizationId, metricKey: Schema.String },
	messages: [Message.SucceededDeleteMetric, Message.FailedDeleteMetric],
	execute: ({ organizationId, metricKey }) =>
		HazelRpc.use((rpc) => rpc("customers.metric.delete", { organizationId, metricKey })).pipe(
			Effect.tap((result) => awaitSynced(customerMetricDefinitionCollection, result.transactionId)),
			Effect.as(Message.SucceededDeleteMetric({ metricKey })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(
						Message.FailedDeleteMetric({ metricKey, reason: "NotFound", detail: null }),
					),
				CustomersInvalidRequestError: (error) =>
					Effect.succeed(
						Message.FailedDeleteMetric({ metricKey, reason: "Invalid", detail: error.message }),
					),
			}),
			catchCommon((reason) => Message.FailedDeleteMetric({ metricKey, reason, detail: null })),
		),
})
