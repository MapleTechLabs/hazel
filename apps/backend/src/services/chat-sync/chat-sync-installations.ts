/**
 * Provider workspace installs (directory `chat_sync_installations`): the encrypted bot token a
 * provider that issues one per workspace (Slack) posts with. Saved on the OAuth callback, read by
 * outbound deliveries in any `ChannelObject`, removed when the provider reports an uninstall.
 */
import { SQLite, schema } from "@hazel/db"
import type { UserId } from "@hazel/schema"
import { Context, Duration, Effect, Layer, Option, Redacted } from "effect"
import { Directory } from "../directory"
import { IntegrationEncryption } from "../integration-encryption"

/** How long a decrypted token is reused in this isolate before it is read again. */
const TOKEN_TTL = Duration.minutes(5)
const MAX_CACHED_TOKENS = 1_000

export interface ChatSyncInstallationInput {
	readonly provider: string
	readonly externalWorkspaceId: string
	readonly externalWorkspaceName: string | null
	readonly token: Redacted.Redacted<string>
	readonly scope: string | null
	readonly installedBy: UserId | null
}

export class ChatSyncInstallations extends Context.Service<ChatSyncInstallations>()("ChatSyncInstallations", {
	make: Effect.gen(function* () {
		const directory = yield* Directory
		const encryption = yield* IntegrationEncryption
		const cache = new Map<string, { readonly token: Redacted.Redacted<string>; readonly until: number }>()
		const keyOf = (provider: string, externalWorkspaceId: string) => `${provider}:${externalWorkspaceId}`

		const save = Effect.fn("ChatSyncInstallations.save")(function* (input: ChatSyncInstallationInput) {
			const encrypted = yield* encryption.encrypt(Redacted.value(input.token))
			const row = {
				externalWorkspaceName: input.externalWorkspaceName,
				encryptedToken: encrypted.ciphertext,
				iv: encrypted.iv,
				encryptionKeyVersion: encrypted.keyVersion,
				scope: input.scope,
			}
			yield* directory.db.run(
				SQLite.insertInto(schema.chatSyncInstallationsTable)
					.values({
						provider: input.provider,
						externalWorkspaceId: input.externalWorkspaceId,
						installedBy: input.installedBy,
						...row,
					})
					.onConflictDoUpdate({
						target: ["provider", "externalWorkspaceId"],
						set: { ...row, updatedAt: new Date() },
					}),
			)
			cache.delete(keyOf(input.provider, input.externalWorkspaceId))
			yield* Effect.annotateCurrentSpan({
				"chat_sync.provider": input.provider,
				"chat_sync.workspace_id": input.externalWorkspaceId,
			})
		})

		const remove = Effect.fn("ChatSyncInstallations.remove")(function* (
			provider: string,
			externalWorkspaceId: string,
		) {
			cache.delete(keyOf(provider, externalWorkspaceId))
			yield* directory.db.run(
				SQLite.deleteFrom(schema.chatSyncInstallationsTable).where(($) => [
					$.provider.eq(provider),
					$.externalWorkspaceId.eq(externalWorkspaceId),
				]),
			)
		})

		/** The workspace's bot token; `None` when the app is not installed there. */
		const token = Effect.fn("ChatSyncInstallations.token")(function* (
			provider: string,
			externalWorkspaceId: string,
		) {
			const key = keyOf(provider, externalWorkspaceId)
			const now = Date.now()
			const cached = cache.get(key)
			if (cached !== undefined && cached.until > now) return Option.some(cached.token)
			const row = yield* directory.db.first(
				SQLite.from(schema.chatSyncInstallationsTable)
					.select("encryptedToken", "iv", "encryptionKeyVersion")
					.where(($) => [$.provider.eq(provider), $.externalWorkspaceId.eq(externalWorkspaceId)]),
			)
			if (Option.isNone(row)) return Option.none<Redacted.Redacted<string>>()
			const plain = yield* encryption.decrypt({
				ciphertext: row.value.encryptedToken,
				iv: row.value.iv,
				keyVersion: row.value.encryptionKeyVersion,
			})
			const value = Redacted.make(plain)
			if (cache.size >= MAX_CACHED_TOKENS) cache.clear()
			cache.set(key, { token: value, until: now + Duration.toMillis(TOKEN_TTL) })
			return Option.some(value)
		})

		/** Forget a cached token the provider refused (revoked or rotated). */
		const invalidate = (provider: string, externalWorkspaceId: string) =>
			Effect.sync(() => void cache.delete(keyOf(provider, externalWorkspaceId)))

		return { save, remove, token, invalidate }
	}),
}) {
	/** Over the globally provided `Directory`. */
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(IntegrationEncryption.layer))
}
