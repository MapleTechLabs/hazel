import { BotRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { BotId, OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

/**
 * `canCreate` / `canInstall` / `canUninstall` run in the `OrgObject` (local org members);
 * `canRead` / `canUpdate` / `canDelete` on the directory path, against D1 `bots`.
 *
 * @effect-leakable-service
 */
export class BotPolicy extends Context.Service<BotPolicy>()("BotPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Bot" as const

		const botRepo = yield* BotRepo
		const orgResolver = yield* OrgResolver

		const canCreate = (organizationId: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"create",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireScope(organizationId, scope, policyEntity, "create"),
				),
			)

		// The directory path (D1) has no org members to check, so a bot is its creator's to read;
		// org members see installed bots through the org's `bots` projection.
		const canRead = (botId: BotId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"select",
			)(
				botRepo.with(botId, (bot) =>
					policy(
						policyEntity,
						"select",
						Effect.fn(`${policyEntity}.select`)(function* (actor) {
							return actor.id === bot.createdBy
						}),
					),
				),
			)

		const canUpdate = (botId: BotId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"update",
			)(
				botRepo.with(botId, (bot) =>
					policy(
						policyEntity,
						"update",
						Effect.fn(`${policyEntity}.update`)(function* (actor) {
							return actor.id === bot.createdBy
						}),
					),
				),
			)

		const canDelete = (botId: BotId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"delete",
			)(
				botRepo.with(botId, (bot) =>
					policy(
						policyEntity,
						"delete",
						Effect.fn(`${policyEntity}.delete`)(function* (actor) {
							return actor.id === bot.createdBy
						}),
					),
				),
			)

		const canInstall = (organizationId: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"install",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "install"),
				),
			)

		const canUninstall = (organizationId: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"uninstall",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "uninstall"),
				),
			)

		return { canCreate, canRead, canUpdate, canDelete, canInstall, canUninstall } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BotRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
