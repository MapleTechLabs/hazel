/**
 * A member's own API keys for the AI panel's hosted engines, in the `OrgObject`. A key is the
 * member's user-level integration connection (`anthropic`, `openai`) with the key as its
 * encrypted token (`integration_tokens`), as a T3 Code link holds its credential: the
 * connection row syncs to its owner (provider and status only), the key never leaves the object
 * and is never logged. `assistant_preferences` holds the engine new chats start on.
 */
import { IntegrationConnectionRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import type { Assistant } from "@hazel/domain/models"
import type { AssistantStatus } from "@hazel/domain/rpc"
import type { UserId } from "@hazel/schema"
import { Clock, Effect, Option, Redacted } from "effect"
import { IntegrationTokenService } from "../../../services/integration-token-service"
import { requireOrganizationId } from "./integrations"
import { t3CodeLink } from "./t3code"

/** The model each hosted engine runs (`docs/assistant.md`). */
export const HOSTED_MODELS = {
	anthropic: "claude-sonnet-5-5",
	// `@effect/ai-openai` 4.1.4's current general model with a dated snapshot (`gpt-5.5-2026-04-23`).
	openai: "gpt-5.5",
} as const satisfies Record<Assistant.HostedProvider, string>

/** The member's saved key connection for `provider`, if any. */
const findKeyConnection = (userId: UserId, provider: Assistant.HostedProvider) =>
	Effect.gen(function* () {
		const organizationId = yield* requireOrganizationId
		const repo = yield* IntegrationConnectionRepo
		return yield* repo.findUserConnection(organizationId, userId, provider).pipe(Effect.orDie)
	})

/** Whether the member saved a key for `provider`. */
export const hasHostedKey = (userId: UserId, provider: Assistant.HostedProvider) =>
	Effect.map(findKeyConnection(userId, provider), Option.isSome)

/** The member's key, decrypted for one turn; `None` when they have none (or it is unreadable). */
export const hostedKey = Effect.fn("Assistant.hostedKey")(function* (
	userId: UserId,
	provider: Assistant.HostedProvider,
) {
	const connection = yield* findKeyConnection(userId, provider)
	if (Option.isNone(connection)) return Option.none<Redacted.Redacted<string>>()
	const tokens = yield* IntegrationTokenService
	return yield* tokens.getValidAccessToken(connection.value.id).pipe(
		Effect.map((key) => Option.some(Redacted.make(key))),
		Effect.catchTags({
			TokenNotFoundError: () => Effect.succeed(Option.none<Redacted.Redacted<string>>()),
			ConnectionNotFoundError: () => Effect.succeed(Option.none<Redacted.Redacted<string>>()),
			TokenRefreshError: () => Effect.succeed(Option.none<Redacted.Redacted<string>>()),
			IntegrationEncryptionError: Effect.die,
			KeyVersionNotFoundError: Effect.die,
			DatabaseError: Effect.die,
		}),
	)
})

/** Save (or replace) the member's key, encrypted. The caller checked it with the provider. */
export const saveHostedKey = Effect.fn("Assistant.saveHostedKey")(function* (input: {
	readonly userId: UserId
	readonly provider: Assistant.HostedProvider
	readonly apiKey: Redacted.Redacted<string>
}) {
	const organizationId = yield* requireOrganizationId
	const db = yield* Database.Database
	const repo = yield* IntegrationConnectionRepo
	const tokens = yield* IntegrationTokenService
	yield* db
		.transaction(
			Effect.gen(function* () {
				const saved = yield* repo.upsertByUserAndProvider({
					provider: input.provider,
					organizationId,
					userId: input.userId,
					level: "user",
					status: "active",
					externalAccountId: null,
					externalAccountName: null,
					connectedBy: input.userId,
					settings: null,
					metadata: { model: HOSTED_MODELS[input.provider] },
					errorMessage: null,
					lastUsedAt: null,
					deletedAt: null,
				})
				yield* tokens.storeTokens(saved.id, { accessToken: Redacted.value(input.apiKey) })
			}),
		)
		.pipe(Effect.orDie)
	yield* Effect.annotateCurrentSpan({ "assistant.provider": input.provider })
})

/** Forget the member's key (the connection and its token). */
export const removeHostedKey = Effect.fn("Assistant.removeHostedKey")(function* (input: {
	readonly userId: UserId
	readonly provider: Assistant.HostedProvider
}) {
	const db = yield* Database.Database
	const repo = yield* IntegrationConnectionRepo
	const tokens = yield* IntegrationTokenService
	const connection = yield* findKeyConnection(input.userId, input.provider)
	if (Option.isNone(connection)) return
	yield* db
		.transaction(
			Effect.gen(function* () {
				yield* tokens.deleteTokens(connection.value.id)
				yield* repo.softDelete(connection.value.id)
			}),
		)
		.pipe(Effect.orDie)
})

/** Record the engine new chats start on. */
export const setPreferredEngine = Effect.fn("Assistant.setPreferredEngine")(function* (input: {
	readonly userId: UserId
	readonly engine: Assistant.Engine
}) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	yield* db
		.run(
			SQLite.insertInto(schema.assistantPreferencesTable)
				.values({ userId: input.userId, engine: input.engine, updatedAt: now })
				.onConflictDoUpdate({ target: ["userId"], set: SQLite.excluded(["engine", "updatedAt"]) }),
		)
		.pipe(Effect.orDie)
})

const ENGINE_ORDER: ReadonlyArray<Assistant.Engine> = ["t3code", "anthropic", "openai"]

/**
 * What `assistant.status` answers: each engine's state, and the one new chats use (the member's
 * choice while it is connected, else the first connected one).
 */
export const assistantStatusOf = Effect.fn("Assistant.status")(function* (userId: UserId) {
	const db = yield* Database.Database
	const link = yield* t3CodeLink({ userId })
	const anthropic = yield* hasHostedKey(userId, "anthropic")
	const openai = yield* hasHostedKey(userId, "openai")
	const t3code: AssistantStatus["t3code"] =
		link === null
			? { state: "not_connected", environmentLabel: null }
			: {
					state: link.status === "active" ? "connected" : "expired",
					environmentLabel: link.metadata.environmentLabel,
				}
	const connected = {
		t3code: t3code.state === "connected",
		anthropic,
		openai,
	} satisfies Record<Assistant.Engine, boolean>
	const chosen = yield* db
		.first(
			SQLite.from(schema.assistantPreferencesTable)
				.select("engine")
				.where(($) => [$.userId.eq(userId)]),
		)
		.pipe(Effect.orDie)
	const preferredEngine = Option.match(chosen, {
		onNone: () => ENGINE_ORDER.find((engine) => connected[engine]) ?? null,
		onSome: (row) =>
			connected[row.engine] ? row.engine : (ENGINE_ORDER.find((engine) => connected[engine]) ?? null),
	})
	return {
		t3code,
		anthropic: { state: anthropic ? "connected" : "not_connected", model: HOSTED_MODELS.anthropic },
		openai: { state: openai ? "connected" : "not_connected", model: HOSTED_MODELS.openai },
		preferredEngine,
	} satisfies AssistantStatus as AssistantStatus
})
