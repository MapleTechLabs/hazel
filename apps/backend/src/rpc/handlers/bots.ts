import { createHash, randomUUID } from "node:crypto"
import { BotCommandRepo, BotInstallationRepo, BotRepo, UserRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { ActiveOrganizationRequiredError, CurrentUser, withRemapDbErrors } from "@hazel/domain"
import type { BotId, BotInstallationId, OrganizationMemberId, UserId } from "@hazel/schema"
import {
	BotAlreadyInstalledError,
	BotCommandListResponse,
	BotCreatedResponse,
	BotListResponse,
	BotNotFoundError,
	BotResponse,
	BotRpcs,
	PublicBotListResponse,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { BotPolicy } from "../../policies/bot-policy"
import { checkBotOperationRateLimit, checkBotUpdateRateLimit } from "../../services/rate-limit-helpers"
import { ChannelAccessSyncService } from "../../services/channel-access-sync"

// Generate a secure bot token and return both the plain token and its hash
const generateBotToken = async (): Promise<{ token: string; tokenHash: string }> => {
	const token = `hzl_bot_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`
	const tokenHash = createHash("sha256").update(token).digest("hex")
	return { token, tokenHash }
}

/**
 * Bot RPC Handlers
 *
 * Implements the business logic for all bot-related RPC methods.
 */
export const BotRpcLive = BotRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const botPolicy = yield* BotPolicy
		const channelAccessSync = yield* ChannelAccessSyncService

		return {
			"bot.create": (payload) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					// Rate limit bot operations
					yield* checkBotOperationRateLimit(currentUser.id)

					if (!currentUser.organizationId) {
						return yield* Effect.fail(
							new ActiveOrganizationRequiredError({ message: "Select an organization first" }),
						)
					}

					const organizationId = currentUser.organizationId

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* botPolicy.canCreate(organizationId)
								const botRepo = yield* BotRepo
								const installationRepo = yield* BotInstallationRepo

								// Generate token
								const { token, tokenHash } = yield* Effect.promise(generateBotToken)

								const botId = randomUUID() as BotId
								const botUserId = randomUUID() as UserId
								const installationId = randomUUID() as BotInstallationId
								const membershipId = randomUUID() as OrganizationMemberId
								const sanitizedName = payload.name
									.toLowerCase()
									.replace(/[^a-z0-9-]/g, "-") // Allow only alphanumeric + hyphen
									.replace(/-+/g, "-") // Collapse multiple hyphens
									.replace(/^-|-$/g, "") // Trim hyphens
								const botEmail = `${sanitizedName}-${botId.slice(0, 8)}@bot.hazel.sh`
								const externalId = `bot_${botUserId}`

								// 1. Create a machine user for the bot
								yield* db.run(
									SQLite.insertInto(schema.usersTable).values({
										id: botUserId,
										externalId,
										email: botEmail,
										firstName: payload.name,
										lastName: "",
										avatarUrl: "",
										userType: "machine",
									}),
								)

								// 2. Create the bot record
								const [bot] = yield* db.run(
									SQLite.insertInto(schema.botsTable)
										.values({
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
											allowedIntegrations: null,
										})
										.returning(),
								)

								// 3. Install the bot in the creator's organization
								yield* db.run(
									SQLite.insertInto(schema.botInstallationsTable).values({
										id: installationId,
										botId,
										organizationId,
										installedBy: currentUser.id,
									}),
								)

								// 4. Add bot user to the organization as a member
								yield* db.run(
									SQLite.insertInto(schema.organizationMembersTable).values({
										id: membershipId,
										organizationId,
										userId: botUserId,
										role: "member",
									}),
								)

								yield* channelAccessSync.syncUserInOrganization(botUserId, organizationId)

								const txid = yield* generateTransactionId()

								return new BotCreatedResponse({
									data: bot,
									token, // Only returned once
									transactionId: txid,
								})
							}),
						)
						.pipe(withRemapDbErrors("Bot", "create"))
				}),

			"bot.list": () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const botRepo = yield* BotRepo

					// List bots created by the current user
					const bots = yield* botRepo.findByCreator(user.id)

					return new BotListResponse({ data: bots })
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.get": ({ id }) =>
				Effect.gen(function* () {
					yield* botPolicy.canRead(id)
					const botRepo = yield* BotRepo

					const botOption = yield* botRepo.findById(id)
					if (Option.isNone(botOption)) {
						return yield* Effect.fail(new BotNotFoundError({ botId: id }))
					}

					const txid = yield* generateTransactionId()

					return new BotResponse({
						data: botOption.value,
						transactionId: txid,
					})
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.update": ({ id, ...payload }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					// Rate limit bot updates
					yield* checkBotUpdateRateLimit(currentUser.id)

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* botPolicy.canUpdate(id)
								const botRepo = yield* BotRepo

								// Check bot exists
								const botOption = yield* botRepo.findById(id)
								if (Option.isNone(botOption)) {
									return yield* Effect.fail(new BotNotFoundError({ botId: id }))
								}

								// Update bot
								const updatedBot = yield* botRepo.update({
									id,
									name: payload.name,
									description: payload.description,
									webhookUrl: payload.webhookUrl,
									scopes: payload.scopes ? [...payload.scopes] : undefined,
									isPublic: payload.isPublic,
								})

								// Keep machine user's firstName in sync with bot name
								if (payload.name) {
									const bot = botOption.value
									yield* db.run(
										SQLite.update(schema.usersTable)
											.set({ firstName: payload.name, updatedAt: new Date() })
											.where(($) => [$.id.eq(bot.userId)]),
									)
								}

								const txid = yield* generateTransactionId()

								return new BotResponse({
									data: updatedBot,
									transactionId: txid,
								})
							}),
						)
						.pipe(withRemapDbErrors("Bot", "update"))
				}),

			"bot.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* botPolicy.canDelete(id)
							const botRepo = yield* BotRepo

							// Check bot exists
							const botOption = yield* botRepo.findById(id)
							if (Option.isNone(botOption)) {
								return yield* Effect.fail(new BotNotFoundError({ botId: id }))
							}

							// Soft delete the bot
							yield* botRepo.softDelete(id)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Bot", "delete")),

			"bot.regenerateToken": ({ id }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					// Rate limit bot operations
					yield* checkBotOperationRateLimit(currentUser.id)

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* botPolicy.canUpdate(id)
								const botRepo = yield* BotRepo

								// Check bot exists
								const botOption = yield* botRepo.findById(id)
								if (Option.isNone(botOption)) {
									return yield* Effect.fail(new BotNotFoundError({ botId: id }))
								}

								// Generate new token
								const { token, tokenHash } = yield* Effect.promise(generateBotToken)

								// Update token
								const updatedBot = yield* botRepo.updateTokenHash(id, tokenHash)

								const txid = yield* generateTransactionId()

								return new BotCreatedResponse({
									data: updatedBot,
									token, // Only returned once
									transactionId: txid,
								})
							}),
						)
						.pipe(withRemapDbErrors("Bot", "update"))
				}),

			"bot.getCommands": ({ botId }) =>
				Effect.gen(function* () {
					yield* botPolicy.canRead(botId)
					const botRepo = yield* BotRepo
					const commandRepo = yield* BotCommandRepo

					// Check bot exists
					const botOption = yield* botRepo.findById(botId)
					if (Option.isNone(botOption)) {
						return yield* Effect.fail(new BotNotFoundError({ botId }))
					}

					const commands = yield* commandRepo.findByBot(botId)

					// Map commands to the expected format with null instead of undefined
					const mappedCommands = commands.map((cmd) => ({
						...cmd,
						arguments: cmd.arguments
							? cmd.arguments.map((arg) => ({
									...arg,
									description: arg.description ?? null,
									placeholder: arg.placeholder ?? null,
								}))
							: null,
						updatedAt: cmd.updatedAt ?? null,
					}))

					return new BotCommandListResponse({ data: mappedCommands })
				}).pipe(withRemapDbErrors("BotCommand", "select")),

			// === Bot Marketplace ===

			"bot.listPublic": ({ search }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const botRepo = yield* BotRepo
					const installationRepo = yield* BotInstallationRepo
					const userRepo = yield* UserRepo

					// Get all public bots
					const publicBots = yield* botRepo.findPublic(search)

					// Get installed bot IDs for this organization
					const installedBotIds = user.organizationId
						? yield* installationRepo.getBotIdsForOrg(user.organizationId)
						: []
					const installedSet = new Set(installedBotIds)

					// Get creator names
					const creatorIds = [...new Set(publicBots.map((b) => b.createdBy))]
					const creators = yield* Effect.forEach(creatorIds, (id) => userRepo.findById(id), {
						concurrency: 10,
					})
					const creatorMap = new Map<string, string>()
					for (let i = 0; i < creatorIds.length; i++) {
						const creator = creators[i]
						if (Option.isSome(creator)) {
							const name =
								creator.value.firstName && creator.value.lastName
									? `${creator.value.firstName} ${creator.value.lastName}`
									: creator.value.email
							creatorMap.set(creatorIds[i]!, name)
						}
					}

					// Build response with isInstalled flag and creator name
					const data = publicBots.map((bot) => ({
						...bot,
						isInstalled: installedSet.has(bot.id),
						creatorName: creatorMap.get(bot.createdBy) ?? "Unknown",
					}))

					return new PublicBotListResponse({ data })
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.listInstalled": () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const botRepo = yield* BotRepo
					const installationRepo = yield* BotInstallationRepo

					if (!user.organizationId) {
						return new BotListResponse({ data: [] })
					}

					// Get installed bot IDs for this organization
					const botIds = yield* installationRepo.getBotIdsForOrg(user.organizationId)

					// Get bot details
					const bots = yield* botRepo.findByIds(botIds)

					return new BotListResponse({ data: bots })
				}).pipe(withRemapDbErrors("Bot", "select")),

			"bot.install": ({ botId }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					// Rate limit bot operations
					yield* checkBotOperationRateLimit(currentUser.id)

					if (!currentUser.organizationId) {
						return yield* Effect.fail(
							new ActiveOrganizationRequiredError({ message: "Select an organization first" }),
						)
					}

					const organizationId = currentUser.organizationId

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* botPolicy.canInstall(organizationId)
								const botRepo = yield* BotRepo
								const installationRepo = yield* BotInstallationRepo

								// Check bot exists and is public
								const botOption = yield* botRepo.findById(botId)
								if (Option.isNone(botOption)) {
									return yield* Effect.fail(new BotNotFoundError({ botId }))
								}

								const bot = botOption.value
								if (!bot.isPublic) {
									return yield* Effect.fail(new BotNotFoundError({ botId }))
								}

								// Check if already installed
								const isInstalled = yield* installationRepo.isInstalled(botId, organizationId)

								if (isInstalled) {
									return yield* Effect.fail(new BotAlreadyInstalledError({ botId }))
								}

								// Create installation
								const installationId = randomUUID() as BotInstallationId
								yield* db.run(
									SQLite.insertInto(schema.botInstallationsTable).values({
										id: installationId,
										botId,
										organizationId,
										installedBy: currentUser.id,
									}),
								)

								// Add bot user to the organization as a member (reactivate if soft-deleted)
								const membershipId = randomUUID() as OrganizationMemberId
								yield* db.run(
									SQLite.insertInto(schema.organizationMembersTable)
										.values({
											id: membershipId,
											organizationId,
											userId: bot.userId,
											role: "member",
										})
										.onConflictDoUpdate({
											target: ["organizationId", "userId"],
											set: { deletedAt: null },
										}),
								)

								yield* channelAccessSync.syncUserInOrganization(bot.userId, organizationId)

								// Increment install count
								yield* botRepo.incrementInstallCount(botId)

								const txid = yield* generateTransactionId()

								return { transactionId: txid }
							}),
						)
						.pipe(withRemapDbErrors("BotInstallation", "create"))
				}),

			"bot.uninstall": ({ botId }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					// Rate limit bot operations
					yield* checkBotOperationRateLimit(currentUser.id)

					if (!currentUser.organizationId) {
						return yield* Effect.fail(
							new ActiveOrganizationRequiredError({ message: "Select an organization first" }),
						)
					}

					const organizationId = currentUser.organizationId

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* botPolicy.canUninstall(organizationId)
								const botRepo = yield* BotRepo
								const installationRepo = yield* BotInstallationRepo

								// Check if installed
								const installationOption = yield* installationRepo.findByBotAndOrg(
									botId,
									organizationId,
								)

								if (Option.isNone(installationOption)) {
									return yield* Effect.fail(new BotNotFoundError({ botId }))
								}

								// Delete the installation
								yield* db.run(
									SQLite.deleteFrom(schema.botInstallationsTable).where(($) => [
										$.id.eq(installationOption.value.id),
									]),
								)

								// Get bot to remove bot user from org
								const botOption = yield* botRepo.findById(botId)
								if (Option.isSome(botOption)) {
									// Remove bot user from organization (soft delete)
									yield* db.run(
										SQLite.update(schema.organizationMembersTable)
											.set({ deletedAt: new Date() })
											.where(($) => [
												$.organizationId.eq(organizationId),
												$.userId.eq(botOption.value.userId),
											]),
									)

									yield* channelAccessSync.syncUserInOrganization(
										botOption.value.userId,
										organizationId,
									)

									// Decrement install count
									yield* botRepo.decrementInstallCount(botId)
								}

								const txid = yield* generateTransactionId()

								return { transactionId: txid }
							}),
						)
						.pipe(withRemapDbErrors("BotInstallation", "delete"))
				}),

			"bot.installById": ({ botId }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					// Rate limit bot operations
					yield* checkBotOperationRateLimit(currentUser.id)

					if (!currentUser.organizationId) {
						return yield* Effect.fail(
							new ActiveOrganizationRequiredError({ message: "Select an organization first" }),
						)
					}

					const organizationId = currentUser.organizationId

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* botPolicy.canInstall(organizationId)
								const botRepo = yield* BotRepo
								const installationRepo = yield* BotInstallationRepo

								// Check bot exists (no public check - allows private bots by ID)
								const botOption = yield* botRepo.findById(botId)
								if (Option.isNone(botOption)) {
									return yield* Effect.fail(new BotNotFoundError({ botId }))
								}

								const bot = botOption.value

								// Check if already installed
								const isInstalled = yield* installationRepo.isInstalled(botId, organizationId)

								if (isInstalled) {
									return yield* Effect.fail(new BotAlreadyInstalledError({ botId }))
								}

								// Create installation
								const installationId = randomUUID() as BotInstallationId
								yield* db.run(
									SQLite.insertInto(schema.botInstallationsTable).values({
										id: installationId,
										botId,
										organizationId,
										installedBy: currentUser.id,
									}),
								)

								// Add bot user to the organization as a member (reactivate if soft-deleted)
								const membershipId = randomUUID() as OrganizationMemberId
								yield* db.run(
									SQLite.insertInto(schema.organizationMembersTable)
										.values({
											id: membershipId,
											organizationId,
											userId: bot.userId,
											role: "member",
										})
										.onConflictDoUpdate({
											target: ["organizationId", "userId"],
											set: { deletedAt: null },
										}),
								)

								yield* channelAccessSync.syncUserInOrganization(bot.userId, organizationId)

								// Increment install count
								yield* botRepo.incrementInstallCount(botId)

								const txid = yield* generateTransactionId()

								return { transactionId: txid }
							}),
						)
						.pipe(withRemapDbErrors("BotInstallation", "create"))
				}),

			"bot.updateAvatar": ({ id, avatarUrl }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* botPolicy.canUpdate(id)
							const botRepo = yield* BotRepo

							// Check bot exists
							const botOption = yield* botRepo.findById(id)
							if (Option.isNone(botOption)) {
								return yield* Effect.fail(new BotNotFoundError({ botId: id }))
							}

							const bot = botOption.value

							// Update the machine user's avatar URL
							yield* db.run(
								SQLite.update(schema.usersTable)
									.set({ avatarUrl, updatedAt: new Date() })
									.where(($) => [$.id.eq(bot.userId)]),
							)

							// Return the bot data (unchanged, but user avatar is updated)
							const txid = yield* generateTransactionId()

							return new BotResponse({
								data: bot,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Bot", "update")),
		}
	}),
)
