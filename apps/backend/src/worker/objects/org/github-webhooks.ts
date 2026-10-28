/**
 * GitHub webhooks in the `OrgObject` (the cluster's `GitHubWebhookWorkflow` and
 * `GitHubInstallationWorkflow`, rehomed). The api Worker verifies the signature and finds the org
 * by installation id in the directory's `integration_index`, then calls:
 *
 * - `org.githubEvent`: repository events. Each enabled subscription of the repository that wants
 *   the event (and, for pushes, the branch) gets the event's embed as a
 *   `channel.postSystemMessage` from the shared GitHub bot. Message and outbox ids derive from
 *   the delivery id, so a redelivery posts nothing twice.
 * - `org.githubInstallation`: suspend, unsuspend and delete update the connection's status
 *   (delete also drops the index row). `created` is the OAuth callback's to handle.
 */
import { createHash } from "node:crypto"
import { Database, SQLite, schema } from "@hazel/db"
import { GitHub } from "@hazel/integrations"
import { MessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { WebhookBotService } from "../../../services/webhook-bot-service"
import { defineCall } from "../calls"
import { ChannelEffects } from "../effects/channel-effects"
import { enqueueEffect } from "../effects/registry"
import { channelTarget } from "../kinds"
import { indexInstallation, requireOrganizationId } from "./integrations"

export const GitHubEventCall = defineCall("org.githubEvent", "org", {
	payload: Schema.Struct({
		deliveryId: Schema.String,
		eventType: Schema.String,
		repositoryId: Schema.Number,
		eventPayload: Schema.Unknown,
	}),
	success: Schema.Struct({ messagesCreated: Schema.Number }),
	error: Schema.Never,
})

export const GitHubInstallationCall = defineCall("org.githubInstallation", "org", {
	payload: Schema.Struct({
		action: Schema.Literals(["created", "deleted", "suspend", "unsuspend"]),
		installationId: Schema.String,
	}),
	success: Schema.Struct({ updated: Schema.Number }),
	error: Schema.Never,
})

/** A UUID-shaped id fixed by `seed`. */
const stableMessageId = (seed: string) => {
	const h = createHash("sha256").update(seed).digest("hex")
	return MessageId.make(
		`${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
	)
}

export const githubEvent = Effect.fn("OrgObject.githubEvent")(
	function* (payload: typeof GitHubEventCall.payload.Type) {
		const eventType = GitHub.mapEventType(payload.eventType)
		if (eventType === null) return { messagesCreated: 0 }
		const organizationId = yield* requireOrganizationId
		const db = yield* Database.Database
		const subscriptions = yield* db.run(
			SQLite.from(schema.githubSubscriptionsTable)
				.select("id", "channelId", "enabledEvents", "branchFilter")
				.where(($) => [
					$.repositoryId.eq(payload.repositoryId),
					$.isEnabled.eq(true),
					$.deletedAt.isNull(),
				]),
		)
		const ref = (payload.eventPayload as { readonly ref?: string } | null)?.ref
		const eligible = subscriptions.filter(
			(subscription) =>
				(subscription.enabledEvents as ReadonlyArray<string>).includes(eventType) &&
				(payload.eventType !== "push" || GitHub.matchesBranchFilter(subscription.branchFilter, ref)),
		)
		yield* Effect.annotateCurrentSpan({
			"github.event_type": payload.eventType,
			"github.subscriptions": subscriptions.length,
			"github.eligible": eligible.length,
		})
		if (eligible.length === 0) return { messagesCreated: 0 }
		const embed = GitHub.buildGitHubEmbed(payload.eventType, payload.eventPayload)
		if (embed === null) return { messagesCreated: 0 }

		const bots = yield* WebhookBotService
		yield* db
			.transaction(
				Effect.gen(function* () {
					const bot = yield* bots.getOrCreateIntegrationBot("github", organizationId)
					yield* Effect.forEach(
						eligible,
						(subscription) => {
							const seed = `github:${payload.deliveryId}:${subscription.id}`
							const id = stableMessageId(seed)
							return enqueueEffect(
								ChannelEffects.postSystemMessage,
								channelTarget(subscription.channelId),
								{
									id,
									channelId: subscription.channelId,
									authorId: bot.id,
									content: "",
									embeds: [embed],
								},
								{ id: seed },
							)
						},
						{ discard: true },
					)
				}),
			)
			.pipe(Effect.orDie)
		return { messagesCreated: eligible.length }
	},
	Effect.catchTag("DatabaseError", Effect.die),
)

export const githubInstallation = Effect.fn("OrgObject.githubInstallation")(function* (
	payload: typeof GitHubInstallationCall.payload.Type,
) {
	yield* Effect.annotateCurrentSpan({ "github.action": payload.action })
	if (payload.action === "created") return { updated: 0 }
	const db = yield* Database.Database
	const status =
		payload.action === "deleted" ? "revoked" : payload.action === "suspend" ? "suspended" : "active"
	const now = new Date()
	return yield* db
		.transaction(
			Effect.gen(function* () {
				const updated = yield* db.run(
					SQLite.update(schema.integrationConnectionsTable)
						.set({
							status,
							updatedAt: now,
							...(payload.action === "deleted" ? { deletedAt: now } : {}),
						})
						.where(($) => [
							$.provider.eq("github"),
							SQLite.jsonText($.metadata, "installationId").eq(payload.installationId),
							$.deletedAt.isNull(),
						])
						.returning(),
				)
				if (payload.action === "deleted") {
					yield* Effect.forEach(updated, (connection) => indexInstallation(connection, true), {
						discard: true,
					})
				}
				return { updated: updated.length }
			}),
		)
		.pipe(Effect.orDie)
})
