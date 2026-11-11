/**
 * Re-attributes provider-synced messages when a user links (or unlinks) their provider account:
 * between the provider user's shadow and the Hazel user. Runs in the org's `OrgObject` (its
 * `users` projection names the shadow); each linked `ChannelObject` moves its own messages
 * (`channel.chatSyncReassignAuthors`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { IntegrationConnection } from "@hazel/domain/models"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { reattributeProviderMessages } from "./chat-sync-org"

interface ReconcileAttributionParams {
	organizationId: OrganizationId
	provider: IntegrationConnection.IntegrationProvider
	userId: UserId
	externalAccountId: string
	externalAccountName?: string | null
}

/** Re-attribution needs the org's object (its outbox); called elsewhere, it is refused. */
export class ChatSyncAttributionUnavailableError extends Schema.TaggedError<ChatSyncAttributionUnavailableError>()(
	"ChatSyncAttributionUnavailableError",
	{ message: Schema.String },
) {}

export class ChatSyncAttributionReconciler extends Context.Service<ChatSyncAttributionReconciler>()(
	"ChatSyncAttributionReconciler",
	{
		make: Effect.gen(function* () {
			const db = yield* Database.Database
			const sql = yield* Effect.serviceOption(SqlClient)

			/** The provider user's shadow, if this org ever saw them. */
			const shadowOf = (params: ReconcileAttributionParams) =>
				db
					.first(
						SQLite.from(schema.usersTable)
							.select("id")
							.where(($) => [
								$.externalId.eq(`${params.provider}-user-${params.externalAccountId}`),
							])
							.limit(1),
					)
					.pipe(Effect.map(Option.map((row) => row.id)))

			const reassign = (
				event: string,
				params: ReconcileAttributionParams,
				direction: (shadow: UserId) => { fromAuthorId: UserId; toAuthorId: UserId },
			) =>
				Effect.gen(function* () {
					if (Option.isNone(sql)) {
						return yield* new ChatSyncAttributionUnavailableError({
							message: "Chat sync re-attribution runs in the organization's object",
						})
					}
					const shadow = yield* shadowOf(params)
					if (Option.isNone(shadow)) return { updatedCount: 0 }
					const channels = yield* reattributeProviderMessages({
						provider: params.provider,
						...direction(shadow.value),
					}).pipe(Effect.provideService(SqlClient, sql.value))
					yield* Effect.logInfo("External messages re-attribution sent to linked channels", {
						event,
						provider: params.provider,
						organizationId: params.organizationId,
						userId: params.userId,
						shadowUserId: shadow.value,
						channels,
					})
					// Each channel moves its own messages; the count is of channels.
					return { updatedCount: channels }
				})

			const relinkHistoricalProviderMessages = Effect.fn(
				"ChatSyncAttributionReconciler.relinkHistoricalProviderMessages",
			)((params: ReconcileAttributionParams) =>
				reassign("chat_sync_attribution_relinked", params, (shadow) => ({
					fromAuthorId: shadow,
					toAuthorId: params.userId,
				})),
			)

			const unlinkHistoricalProviderMessages = Effect.fn(
				"ChatSyncAttributionReconciler.unlinkHistoricalProviderMessages",
			)((params: ReconcileAttributionParams) =>
				reassign("chat_sync_attribution_unlinked", params, (shadow) => ({
					fromAuthorId: params.userId,
					toAuthorId: shadow,
				})),
			)

			return { relinkHistoricalProviderMessages, unlinkHistoricalProviderMessages }
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
