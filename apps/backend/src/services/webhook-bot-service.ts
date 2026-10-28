import { createHash } from "node:crypto"
import { OrganizationMemberRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { Integrations } from "@hazel/domain"
import { type ChannelWebhookId, type OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { DirectoryEffects } from "../worker/objects/effects/directory-effects"
import { enqueueEffect } from "../worker/objects/effects/registry"
import {
	toUserProjection,
	upsertUserProjection,
	type UserProjection,
} from "../worker/objects/org/projections"
import { Directory } from "./directory"

/** A stable user id for a global bot, so two orgs creating it at once agree on one row. */
const stableUserId = (externalId: string) => {
	const h = createHash("sha256").update(externalId).digest("hex")
	return UserId.make(
		`${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
	)
}

/**
 * Webhook Bot Service. Runs in the `OrgObject`.
 *
 * Machine users for channel webhooks (one per webhook) and integration webhooks (one per
 * provider, shared by every org). The user row is the directory's (`users` in D1, written through
 * `directory.upsertBotUser` from the outbox); the org keeps its projection copy and the bot's
 * `organization_members` row, so the bot shows as a message author.
 */
export class WebhookBotService extends Context.Service<WebhookBotService>()("WebhookBotService", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database
		const directory = yield* Directory
		const orgMemberRepo = yield* OrganizationMemberRepo

		/** Write the bot's org copy now and its directory row after the commit. */
		const saveBotUser = (user: UserProjection) =>
			Effect.gen(function* () {
				yield* upsertUserProjection(user)
				yield* enqueueEffect(DirectoryEffects.upsertBotUser, { kind: "directory" }, user)
			})

		const joinOrganization = (organizationId: OrganizationId, userId: UserId) =>
			orgMemberRepo.upsertByOrgAndUser({
				organizationId,
				userId,
				role: "member",
				nickname: null,
				joinedAt: new Date(),
				invitedBy: null,
				deletedAt: null,
			})

		const machineUser = (fields: {
			readonly id: UserId
			readonly externalId: string
			readonly email: string
			readonly name: string
			readonly avatarUrl: string | null
		}): UserProjection => {
			const now = new Date().toISOString()
			return {
				id: fields.id,
				externalId: fields.externalId,
				email: fields.email,
				firstName: fields.name,
				lastName: "",
				avatarUrl: fields.avatarUrl ?? "",
				userType: "machine",
				settings: null,
				isOnboarded: true,
				timezone: null,
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
			}
		}

		/** A machine user for one webhook, a member of `organizationId`. */
		const createWebhookBot = Effect.fn("WebhookBotService.createWebhookBot")(function* (
			webhookId: ChannelWebhookId,
			name: string,
			avatarUrl: string | null,
			organizationId: OrganizationId,
		) {
			const user = machineUser({
				id: UserId.make(crypto.randomUUID()),
				externalId: `webhook-bot-${webhookId}`,
				email: `webhook-${webhookId}@webhooks.internal`,
				name,
				avatarUrl,
			})
			yield* saveBotUser(user)
			yield* joinOrganization(organizationId, user.id)
			return user
		})

		/** Rename or re-avatar a webhook's bot (org copy and directory row). */
		const updateWebhookBot = Effect.fn("WebhookBotService.updateWebhookBot")(function* (
			userId: UserId,
			name: string,
			avatarUrl: string | null,
		) {
			const current = yield* db.first(
				SQLite.from(schema.usersTable)
					.select()
					.where(($) => [$.id.eq(userId)])
					.limit(1),
			)
			if (Option.isNone(current)) return
			yield* saveBotUser({
				...toUserProjection(current.value),
				firstName: name,
				avatarUrl: avatarUrl ?? "",
				updatedAt: new Date().toISOString(),
			})
		})

		/**
		 * The provider's shared webhook bot (`integration-bot-<provider>`), joined to
		 * `organizationId`: from the directory when another org created it, else created here.
		 * GitHub's posts subscription events.
		 */
		const getOrCreateIntegrationBot = Effect.fn("WebhookBotService.getOrCreateIntegrationBot")(function* (
			provider: Integrations.WebhookProvider | "github",
			organizationId: OrganizationId,
		) {
			const config =
				provider === "github"
					? Integrations.getBotConfig("github")
					: Integrations.getWebhookBotConfig(provider)
			const externalId = `integration-bot-${provider}`
			const known = yield* directory.db.first(
				SQLite.from(schema.usersTable)
					.select()
					.where(($) => [$.externalId.eq(externalId)])
					.limit(1),
			)
			const user = Option.isSome(known)
				? toUserProjection(known.value)
				: machineUser({
						id: stableUserId(externalId),
						externalId,
						email: `${provider}-bot@webhooks.internal`,
						name: config.name,
						avatarUrl: config.avatarUrl,
					})
			if (Option.isSome(known)) yield* upsertUserProjection(user)
			else yield* saveBotUser(user)
			yield* joinOrganization(organizationId, user.id)
			yield* Effect.annotateCurrentSpan({
				"bot.provider": provider,
				"bot.created": Option.isNone(known),
			})
			return user
		})

		return { createWebhookBot, updateWebhookBot, getOrCreateIntegrationBot }
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(OrganizationMemberRepo.layer))
}
