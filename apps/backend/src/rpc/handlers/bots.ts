/**
 * Bots run in two places (`rpc/routing.ts`):
 *
 * - the `OrgObject` (`create`, `install`, `installById`, `uninstall`, `listInstalled`): the org's
 *   `bot_installations` and the bot user's membership, written with the copies of the bot and its
 *   user and the channels' `channel_bots` (`worker/objects/org/bot-installs.ts`); a new bot's
 *   directory rows go out through the org's outbox;
 * - the directory path (the rest): D1 `bots`, `bot_commands` and the bot's machine user, no
 *   transactions, each change fanned out to the orgs in the bot user's `membership_index`.
 *
 * Rate limits are the api Worker's (`rateLimits` in `rpc/routing.ts`).
 */
import { BotCommandRepo, BotRepo, UserRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { ActiveOrganizationRequiredError, CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { isRegisteredInstallRedirect } from "@hazel/domain/bot-install"
import {
	BotAlreadyInstalledError,
	BotCommandListResponse,
	BotInstallAuthorizedResponse,
	BotInstallRedirectMismatchError,
	BotInstallRequestResponse,
	BotCreatedResponse,
	BotListResponse,
	BotNotFoundError,
	BotResponse,
	BotRpcs,
	PublicBotListResponse,
} from "@hazel/domain/rpc"
import { BotId, type OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { Hex } from "effect/encoding"
import { generateTransactionId } from "../../lib/create-transactionId"
import { currentObject } from "../../lib/current-object"
import { BotPolicy } from "../../policies/bot-policy"
import { Directory } from "../../services/directory"
import {
	botProjection,
	DirectoryWireEffects,
	DirectoryWireOrgEffects,
	readDirectoryBot,
	toBotWire,
} from "../../worker/objects/directory-wire"
import { DirectoryEffects } from "../../worker/objects/effects/directory-effects"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { fanOut, transactionIdOf } from "../../worker/objects/fanout"
import { orgTarget } from "../../worker/objects/kinds"
import { mintInstallGrant } from "../../worker/objects/org/bot-install-grants"
import { installBotHere, uninstallBotHere } from "../../worker/objects/org/bot-installs"
import { toUserProjection, upsertUserProjection } from "../../worker/objects/org/projections"
import { projectUserToOrgs } from "./users"

/** A bot token (shown once) and its SHA-256 hash (stored). */
const generateBotToken = Effect.promise(async () => {
	const random = () => crypto.randomUUID().replace(/-/g, "")
	const token = `hzl_bot_${random()}${random()}`
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
	return { token, tokenHash: Hex.encode(new Uint8Array(digest)) }
})

/** The org a bot call acts in: the routing hint, else the caller's active org. */
const activeOrganization = (hint: OrganizationId | undefined) =>
	Effect.gen(function* () {
		const user = yield* CurrentUser.Context
		const organizationId = hint ?? user.organizationId ?? undefined
		// The router sends calls with an org to its OrgObject; anywhere else there is none.
		const object = yield* currentObject
		if (organizationId === undefined || Option.isNone(object) || object.value.kind !== "org") {
			return yield* new ActiveOrganizationRequiredError({ message: "Select an organization first" })
		}
		return organizationId
	})

/** Project the directory's bot (and its commands, or its user) to every org it is installed in. */
const projectBotToOrgs = Effect.fn("Bot.projectToOrgs")(function* (
	botId: BotId,
	options: { readonly commands?: boolean; readonly user?: boolean },
) {
	const directory = yield* Directory
	const bot = yield* directory.db.first(
		SQLite.from(schema.botsTable)
			.select()
			.where(($) => [$.id.eq(botId)])
			.limit(1),
	)
	if (Option.isNone(bot)) return transactionIdOf([])
	const commands = options.commands
		? yield* directory.db.run(
				SQLite.from(schema.botCommandsTable)
					.select()
					.where(($) => [$.botId.eq(botId)]),
			)
		: null
	const organizations = yield* directory.organizationsOf(bot.value.userId)
	const applied = yield* fanOut(
		DirectoryWireOrgEffects.upsertBotProjection,
		organizations.map(orgTarget),
		botProjection(bot.value, commands),
		crypto.randomUUID(),
	)
	if (options.user) yield* projectUserToOrgs(bot.value.userId)
	return transactionIdOf(applied)
})

/** Machine-user email from the bot's name. */
const botEmail = (name: string, botId: BotId) => {
	const sanitized = name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
	return `${sanitized}-${botId.slice(0, 8)}@bot.hazel.sh`
}

export const BotRpcLive = BotRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const botPolicy = yield* BotPolicy

		/** Install a directory bot in this org (`bot.install`, `bot.installById`). */
		const install = (botId: BotId, hint: OrganizationId | undefined, publicOnly: boolean) =>
			Effect.gen(function* () {
				const currentUser = yield* CurrentUser.Context
				const organizationId = yield* activeOrganization(hint)
				yield* botPolicy.canInstall(organizationId)
				const found = yield* readDirectoryBot(botId)
				if (Option.isNone(found) || (publicOnly && !found.value.bot.isPublic)) {
					return yield* new BotNotFoundError({ botId })
				}
				return yield* db.transaction(
					Effect.gen(function* () {
						const installed = yield* db.first(
							SQLite.from(schema.botInstallationsTable)
								.select("id")
								.where(($) => [$.botId.eq(botId), $.organizationId.eq(organizationId)])
								.limit(1),
						)
						if (Option.isSome(installed)) return yield* new BotAlreadyInstalledError({ botId })
						yield* installBotHere({
							bot: found.value.bot,
							commands: found.value.commands,
							organizationId,
							installedBy: currentUser.id,
						})
						return { transactionId: yield* generateTransactionId() }
					}),
				)
			}).pipe(withRemapDbErrors("BotInstallation", "create"))

		return {
			"bot.create": (payload) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context
					const organizationId = yield* activeOrganization(payload.organizationId)
					yield* botPolicy.canCreate(organizationId)
					const { token, tokenHash } = yield* generateBotToken
					const now = new Date()
					const botId = BotId.make(crypto.randomUUID())
					const botUserId = UserId.make(crypto.randomUUID())
					const botUser: schema.User = {
						id: botUserId,
						externalId: `bot_${botUserId}`,
						authActive: true,
						securityRevision: "initial",
						email: botEmail(payload.name, botId),
						firstName: payload.name,
						lastName: "",
						avatarUrl: null,
						userType: "machine",
						settings: null,
						isOnboarded: false,
						timezone: null,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					}
					const bot: schema.Bot = {
						id: botId,
						userId: botUserId,
						createdBy: currentUser.id,
						name: payload.name,
						description: payload.description ?? null,
						webhookUrl: payload.webhookUrl ?? null,
						apiTokenHash: tokenHash,
						scopes: [...payload.scopes],
						metadata: null,
						isPublic: payload.isPublic ?? false,
						installCount: 1,
						mentionable: false,
						allowedIntegrations: null,
						installRedirectUris: null,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					}
					return yield* db
						.transaction(
							Effect.gen(function* () {
								// The directory's rows, delivered right after the commit.
								yield* enqueueEffect(
									DirectoryWireEffects.createBot,
									{ kind: "directory" },
									toBotWire(bot),
								)
								yield* enqueueEffect(
									DirectoryEffects.upsertBotUser,
									{ kind: "directory" },
									toUserProjection(botUser),
								)
								// Not in the directory yet, so copied here rather than read back.
								yield* upsertUserProjection(toUserProjection(botUser))
								yield* installBotHere({
									bot,
									commands: [],
									organizationId,
									installedBy: currentUser.id,
								})
								const txid = yield* generateTransactionId()
								return new BotCreatedResponse({ data: bot, token, transactionId: txid })
							}),
						)
						.pipe(withRemapDbErrors("Bot", "create"))
				}),

			"bot.list": () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const botRepo = yield* BotRepo
					return new BotListResponse({ data: yield* botRepo.findByCreator(user.id) })
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.get": ({ id }) =>
				Effect.gen(function* () {
					yield* botPolicy.canRead(id)
					const botRepo = yield* BotRepo
					const bot = yield* botRepo.findById(id)
					if (Option.isNone(bot)) return yield* new BotNotFoundError({ botId: id })
					return new BotResponse({ data: bot.value, transactionId: transactionIdOf([]) })
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.update": ({ id, ...payload }) =>
				Effect.gen(function* () {
					yield* botPolicy.canUpdate(id)
					const botRepo = yield* BotRepo
					const existing = yield* botRepo.findById(id)
					if (Option.isNone(existing)) return yield* new BotNotFoundError({ botId: id })
					const updatedBot = yield* botRepo.update({
						id,
						name: payload.name,
						description: payload.description,
						webhookUrl: payload.webhookUrl,
						scopes: payload.scopes ? [...payload.scopes] : undefined,
						isPublic: payload.isPublic,
						installRedirectUris: payload.installRedirectUris,
					})
					// The machine user's name follows the bot's.
					if (payload.name) {
						yield* db.run(
							SQLite.update(schema.usersTable)
								.set({ firstName: payload.name, updatedAt: new Date() })
								.where(($) => [$.id.eq(existing.value.userId)]),
						)
					}
					const transactionId = yield* projectBotToOrgs(id, { user: payload.name !== undefined })
					return new BotResponse({ data: updatedBot, transactionId })
				}).pipe(withRemapDbErrors("Bot", "update")),

			"bot.delete": ({ id }) =>
				Effect.gen(function* () {
					yield* botPolicy.canDelete(id)
					const botRepo = yield* BotRepo
					const existing = yield* botRepo.findById(id)
					if (Option.isNone(existing)) return yield* new BotNotFoundError({ botId: id })
					yield* botRepo.softDelete(id)
					// The orgs' copies turn deleted, which takes the bot out of their channels.
					return { transactionId: yield* projectBotToOrgs(id, {}) }
				}).pipe(withRemapDbErrors("Bot", "delete")),

			"bot.regenerateToken": ({ id }) =>
				Effect.gen(function* () {
					yield* botPolicy.canUpdate(id)
					const botRepo = yield* BotRepo
					const existing = yield* botRepo.findById(id)
					if (Option.isNone(existing)) return yield* new BotNotFoundError({ botId: id })
					const { token, tokenHash } = yield* generateBotToken
					// The hash is the directory's alone; no org copy changes.
					const updatedBot = yield* botRepo.updateTokenHash(id, tokenHash)
					return new BotCreatedResponse({
						data: updatedBot,
						token,
						transactionId: transactionIdOf([]),
					})
				}).pipe(withRemapDbErrors("Bot", "update")),

			"bot.getCommands": ({ botId }) =>
				Effect.gen(function* () {
					yield* botPolicy.canRead(botId)
					const botRepo = yield* BotRepo
					const commandRepo = yield* BotCommandRepo
					const bot = yield* botRepo.findById(botId)
					if (Option.isNone(bot)) return yield* new BotNotFoundError({ botId })
					const commands = yield* commandRepo.findByBot(botId)
					return new BotCommandListResponse({
						data: commands.map((cmd) => ({
							...cmd,
							arguments: cmd.arguments
								? cmd.arguments.map((arg) => ({
										...arg,
										description: arg.description ?? null,
										placeholder: arg.placeholder ?? null,
									}))
								: null,
							updatedAt: cmd.updatedAt ?? null,
						})),
					})
				}).pipe(withRemapDbErrors("BotCommand", "select")),

			"bot.listPublic": ({ search, organizationId }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const botRepo = yield* BotRepo
					const userRepo = yield* UserRepo
					const directory = yield* Directory
					const publicBots = yield* botRepo.findPublic(search)

					// Installed here = the bot user is an active member (`membership_index`).
					const orgId = organizationId ?? user.organizationId ?? undefined
					const installed = new Set<string>()
					if (orgId !== undefined && publicBots.length > 0) {
						const rows = yield* directory.db.run(
							SQLite.from(schema.membershipIndexTable)
								.select("userId")
								.where(($) => [
									$.organizationId.eq(orgId),
									$.deletedAt.isNull(),
									$.userId.in_(...publicBots.map((bot) => bot.userId)),
								]),
						)
						for (const row of rows) installed.add(row.userId)
					}

					const creatorIds = [...new Set(publicBots.map((b) => b.createdBy))]
					const creators = yield* Effect.forEach(creatorIds, (id) => userRepo.findById(id), {
						concurrency: 10,
					})
					const creatorMap = new Map<string, string>()
					creatorIds.forEach((id, i) => {
						const creator = creators[i]
						if (creator !== undefined && Option.isSome(creator)) {
							const { firstName, lastName, email } = creator.value
							creatorMap.set(id, firstName && lastName ? `${firstName} ${lastName}` : email)
						}
					})

					return new PublicBotListResponse({
						data: publicBots.map((bot) => ({
							...bot,
							isInstalled: installed.has(bot.userId),
							creatorName: creatorMap.get(bot.createdBy) ?? "Unknown",
						})),
					})
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.listInstalled": ({ organizationId }) =>
				Effect.gen(function* () {
					const resolved = yield* activeOrganization(organizationId).pipe(
						Effect.map(Option.some),
						Effect.catchTag("ActiveOrganizationRequiredError", () => Effect.succeedNone),
					)
					if (Option.isNone(resolved)) return new BotListResponse({ data: [] })
					const installations = yield* db.run(
						SQLite.from(schema.botInstallationsTable)
							.select("botId")
							.where(($) => [$.organizationId.eq(resolved.value)]),
					)
					const bots =
						installations.length === 0
							? []
							: yield* db.run(
									SQLite.from(schema.botsTable)
										.select()
										.where(($) => [
											$.id.in_(...installations.map((row) => row.botId)),
											$.deletedAt.isNull(),
										]),
								)
					return new BotListResponse({ data: bots })
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.install": ({ botId, organizationId }) => install(botId, organizationId, true),

			"bot.installById": ({ botId, organizationId }) => install(botId, organizationId, false),

			"bot.uninstall": ({ botId, organizationId: hint }) =>
				Effect.gen(function* () {
					const organizationId = yield* activeOrganization(hint)
					yield* botPolicy.canUninstall(organizationId)
					return yield* db
						.transaction(
							Effect.gen(function* () {
								const removed = yield* uninstallBotHere(botId, organizationId)
								if (!removed) return yield* new BotNotFoundError({ botId })
								return { transactionId: yield* generateTransactionId() }
							}),
						)
						.pipe(withRemapDbErrors("BotInstallation", "delete"))
				}),

			"bot.getInstallRequest": ({ botId, redirectUri }) =>
				Effect.gen(function* () {
					const botRepo = yield* BotRepo
					const userRepo = yield* UserRepo
					const bot = yield* botRepo.findById(botId)
					if (Option.isNone(bot)) return yield* new BotNotFoundError({ botId })
					if (!isRegisteredInstallRedirect(bot.value.installRedirectUris, redirectUri)) {
						return yield* new BotInstallRedirectMismatchError({ botId })
					}
					const [botUser, creator] = yield* Effect.all(
						[userRepo.findById(bot.value.userId), userRepo.findById(bot.value.createdBy)],
						{ concurrency: 2 },
					)
					const creatorName = Option.match(creator, {
						onNone: () => "Unknown",
						onSome: ({ firstName, lastName, email }) =>
							firstName && lastName ? `${firstName} ${lastName}` : email,
					})
					return new BotInstallRequestResponse({
						id: bot.value.id,
						name: bot.value.name,
						description: bot.value.description,
						avatarUrl: Option.match(botUser, {
							onNone: () => null,
							onSome: (user) => user.avatarUrl ?? null,
						}),
						creatorName,
					})
				}).pipe(withRemapDbErrors("Bot", "select")),

			// The consent page's approval: install (unless it already is) and mint the grant together.
			"bot.authorizeInstall": ({ botId, organizationId: hint, redirectUri }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context
					const organizationId = yield* activeOrganization(hint)
					yield* botPolicy.canInstall(organizationId)
					const found = yield* readDirectoryBot(botId)
					if (Option.isNone(found)) return yield* new BotNotFoundError({ botId })
					if (!isRegisteredInstallRedirect(found.value.bot.installRedirectUris, redirectUri)) {
						return yield* new BotInstallRedirectMismatchError({ botId })
					}
					return yield* db.transaction(
						Effect.gen(function* () {
							const installed = yield* db.first(
								SQLite.from(schema.botInstallationsTable)
									.select("id")
									.where(($) => [$.botId.eq(botId), $.organizationId.eq(organizationId)])
									.limit(1),
							)
							if (Option.isNone(installed)) {
								yield* installBotHere({
									bot: found.value.bot,
									commands: found.value.commands,
									organizationId,
									installedBy: currentUser.id,
								})
							}
							const code = yield* mintInstallGrant({
								organizationId,
								botId,
								redirectUri,
								installedBy: currentUser.id,
							})
							return new BotInstallAuthorizedResponse({
								code,
								transactionId: yield* generateTransactionId(),
							})
						}),
					)
				}).pipe(withRemapDbErrors("BotInstallation", "create")),

			"bot.updateAvatar": ({ id, avatarUrl }) =>
				Effect.gen(function* () {
					yield* botPolicy.canUpdate(id)
					const botRepo = yield* BotRepo
					const bot = yield* botRepo.findById(id)
					if (Option.isNone(bot)) return yield* new BotNotFoundError({ botId: id })
					yield* db.run(
						SQLite.update(schema.usersTable)
							.set({ avatarUrl, updatedAt: new Date() })
							.where(($) => [$.id.eq(bot.value.userId)]),
					)
					const transactionId = yield* projectUserToOrgs(bot.value.userId)
					return new BotResponse({ data: bot.value, transactionId })
				}).pipe(withRemapDbErrors("Bot", "update")),
		}
	}),
)
