import { Activity } from "effect/workflow"
import { and, Database, eq, isNull, lt, schema } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import type { AttachmentId } from "@hazel/schema"
import { Effect } from "effect"

const DEFAULT_MAX_AGE_MINUTES = 10

export const CleanupUploadsWorkflowLayer = Cluster.CleanupUploadsWorkflow.toLayer(
	Effect.fn("workflow.CleanupUploads")(function* (
		payload: Cluster.CleanupUploadsWorkflowPayload,
		_executionId: string,
	) {
		const maxAgeMinutes = payload.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES

		yield* Effect.annotateCurrentSpan("workflow.max_age_minutes", maxAgeMinutes)

		yield* Effect.logDebug(`Starting CleanupUploadsWorkflow (maxAgeMinutes: ${maxAgeMinutes})`)

		const staleUploadsResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "FindStaleUploads",
				success: Cluster.FindStaleUploadsResult,
				error: Cluster.FindStaleUploadsError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					yield* Effect.logDebug(
						`Finding attachments in 'uploading' status older than ${maxAgeMinutes} minutes`,
					)

					const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000)

					const staleUploads = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.attachmentsTable.id,
									fileName: schema.attachmentsTable.fileName,
									uploadedAt: schema.attachmentsTable.uploadedAt,
								})
								.from(schema.attachmentsTable)
								.where(
									and(
										eq(schema.attachmentsTable.status, "uploading"),
										lt(schema.attachmentsTable.uploadedAt, cutoffTime),
										isNull(schema.attachmentsTable.deletedAt),
									),
								),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.FindStaleUploadsError({
											message: "Failed to find stale uploads",
											cause: err,
										}),
									),
							}),
						)

					const uploads = staleUploads.map((upload) => ({
						id: upload.id,
						fileName: upload.fileName,
						uploadedAt: upload.uploadedAt,
						ageMinutes: Math.floor((Date.now() - upload.uploadedAt.getTime()) / (60 * 1000)),
					}))

					yield* Effect.annotateCurrentSpan("activity.stale_count", uploads.length)
					yield* Effect.logDebug(`Found ${uploads.length} stale uploads`)

					return {
						uploads,
						totalCount: uploads.length,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("FindStaleUploads activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		// If no stale uploads found, we're done
		if (staleUploadsResult.totalCount === 0) {
			yield* Effect.logDebug("No stale uploads found, workflow complete")
			return
		}

		const markFailedResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "MarkUploadsFailed",
				success: Cluster.MarkUploadsFailedResult,
				error: Cluster.MarkUploadsFailedError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database
					const failedIds: AttachmentId[] = []

					yield* Effect.logDebug(`Marking ${staleUploadsResult.uploads.length} uploads as failed`)

					for (const upload of staleUploadsResult.uploads) {
						yield* db
							.execute((client) =>
								client
									.update(schema.attachmentsTable)
									.set({ status: "failed" })
									.where(
										and(
											eq(schema.attachmentsTable.id, upload.id),
											eq(schema.attachmentsTable.status, "uploading"),
										),
									),
							)
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new Cluster.MarkUploadsFailedError({
												message: `Failed to mark upload ${upload.id} as failed`,
												cause: err,
											}),
										),
								}),
							)

						failedIds.push(upload.id)
						yield* Effect.logDebug(
							`Marked attachment ${upload.id} (${upload.fileName}) as failed (age: ${upload.ageMinutes}min)`,
						)
					}

					yield* Effect.annotateCurrentSpan("activity.marked_count", failedIds.length)

					return {
						markedCount: failedIds.length,
						failedIds,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("MarkUploadsFailed activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		yield* Effect.logDebug(
			`CleanupUploadsWorkflow completed: ${markFailedResult.markedCount} uploads marked as failed`,
		)
	}),
)
