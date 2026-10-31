/**
 * The directory path (D1, run in the api Worker) and the `UserObject`, on node SQLite: profile
 * updates fanned out to the user's orgs, bot create/uninstall/install end to end (org member,
 * `channel_bots`, directory rows), invitation accept, notifications in the owner's object, and
 * presence (socket-driven online/offline, projections, status expiry on the alarm).
 */
import { Database } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import type { BotId, ChannelId, NotificationId, OrganizationId, UserId } from "@hazel/schema"
import { makeFakeSocket } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { Hex } from "effect/encoding"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { Directory } from "../../services/directory"
import { callObject } from "./calls"
import { channelTarget, orgTarget, userTarget } from "./kinds"
import {
	hashInstallCode,
	OrganizationChannelsCall,
	OrganizationUsersCall,
	RedeemBotInstallGrantCall,
} from "./org/bot-install-grants"
import { ObjectStubs } from "./protocol"
import { encodeInvokePrincipal } from "./principal"
import { makeTestObjects, type TestObject, type TestObjects } from "./testing"

const uuid = () => crypto.randomUUID()

const userOf = (id: string, email = `${id}@example.com`) =>
	new CurrentUser.Schema({
		id: id as UserId,
		organizationId: null,
		role: "member",
		email,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

const principalOf = (user: string, email?: string) => ({ user: userOf(user, email), botScopes: null })

/** Call `tag` on `object` as `user`, the way the api Worker forwards it. */
const call = (object: TestObject, objectId: string, tag: HazelRpcTag, payload: unknown, user: string) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal(principalOf(user)),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	})

const ok = <A>(exit: Exit.Exit<unknown, unknown>): A => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value as A
}

const errorTag = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit)
		? Option.match(Cause.findErrorOption(exit.cause), {
				onNone: () => "defect",
				onSome: (error) => (error as { _tag?: string })._tag,
			})
		: undefined

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const directoryDb = (objects: TestObjects) =>
	Effect.map(Effect.provideContext(Directory, objects.directory), (directory) => directory.db)

interface Seed {
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly member: UserId
}

/**
 * An org (owner and member) in its object, and the directory's view of it: `users`, `org_index`
 * and `membership_index`.
 */
const seed = (objects: TestObjects) =>
	Effect.gen(function* () {
		const s: Seed = { orgId: uuid() as OrganizationId, owner: uuid() as UserId, member: uuid() as UserId }
		const org = yield* objects.get(orgTarget(s.orgId))
		const db = org.storage.db
		db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(s.orgId)
		for (const [id, role] of [
			[s.owner, "owner"],
			[s.member, "member"],
		] as const) {
			db.prepare(
				`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'First', 'Last')`,
			).run(id, `ext-${id}`, `${id}@example.com`)
			db.prepare(
				`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, ?)`,
			).run(s.orgId, id, role)
			yield* insertDirectoryUser(objects, id, `${id}@example.com`)
			yield* Effect.provideContext(
				Effect.flatMap(Directory, (d) =>
					d.upsertMembership({ userId: id, organizationId: s.orgId, deletedAt: null }),
				),
				objects.directory,
			)
		}
		yield* Effect.provideContext(
			Effect.flatMap(Directory, (d) =>
				d.upsertOrg({ id: s.orgId, slug: "acme", name: "Acme", deletedAt: null }),
			),
			objects.directory,
		)
		return { seed: s, org }
	}).pipe(Effect.orDie)

const insertDirectoryUser = (objects: TestObjects, id: string, email: string) =>
	Effect.flatMap(directoryDb(objects), (db) =>
		db.execute(
			Database_sql(
				`INSERT INTO users (id, "externalId", email, "firstName", "lastName") VALUES ('${id}', 'ext-${id}', '${email}', 'First', 'Last')`,
			),
		),
	)

const Database_sql = (statement: string) => Database.sql.raw(statement)

/** Rows from the directory database. */
const directoryRows = <A>(objects: TestObjects, statement: string) =>
	Effect.flatMap(directoryDb(objects), (db) => db.query(Database_sql(statement))).pipe(
		Effect.map((rows) => rows as ReadonlyArray<A>),
		Effect.orDie,
	)

const createChannel = (org: TestObject, s: Seed, name: string, type: "public" | "private" = "public") =>
	Effect.map(
		call(
			org,
			s.orgId,
			"channel.create",
			{
				name,
				icon: null,
				type,
				organizationId: s.orgId,
				parentChannelId: null,
				sectionId: null,
			},
			s.owner,
		),
		(exit) => ok<{ data: { id: ChannelId } }>(exit).data.id,
	)

describe("directory path", () => {
	it("user.update writes the directory and projects to each org, returning an org txid", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const { seed: s, org } = yield* seed(objects)
				const exit = yield* objects.invokeDirectory(
					"user.update",
					{ id: s.member, firstName: "Renamed" },
					principalOf(s.member),
				)
				const response = ok<{ data: { firstName: string }; transactionId: string }>(exit)
				expect(response.data.firstName).toBe("Renamed")
				expect(response.transactionId).toMatch(new RegExp(`^org:${s.orgId}:\\d+$`))
				const copy = org.storage.db.prepare(`SELECT firstName FROM users WHERE id = ?`).get(s.member)
				expect(copy).toEqual({ firstName: "Renamed" })

				const other = yield* objects.invokeDirectory(
					"user.update",
					{ id: s.owner, firstName: "Nope" },
					principalOf(s.member),
				)
				expect(errorTag(other)).toBe("UnauthorizedError")
			}),
		))

	it("bot.create, uninstall and installById move the bot user, channel_bots and the directory", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const { seed: s, org } = yield* seed(objects)
				const channelId = yield* createChannel(org, s, "general")
				const channel = yield* objects.get(channelTarget(channelId))

				const created = ok<{
					data: { id: string; userId: string }
					token: string
					transactionId: string
				}>(
					yield* call(
						org,
						s.orgId,
						"bot.create",
						{ name: "Helper", scopes: ["messages:read"], organizationId: s.orgId },
						s.owner,
					),
				)
				const { id: botId, userId: botUserId } = created.data
				expect(created.token).toMatch(/^hzl_bot_/)
				expect(created.transactionId).toMatch(new RegExp(`^org:${s.orgId}:\\d+$`))

				// Directory: the bot (with its token hash), its user, its membership, the count.
				const hash = Hex.encode(
					new Uint8Array(
						yield* Effect.promise(() =>
							crypto.subtle.digest("SHA-256", new TextEncoder().encode(created.token)),
						),
					),
				)
				const bots = yield* directoryRows<{ apiTokenHash: string; installCount: number }>(
					objects,
					`SELECT "apiTokenHash", "installCount" FROM bots WHERE id = '${botId}'`,
				)
				expect(bots).toEqual([{ apiTokenHash: hash, installCount: 1 }])
				expect(
					yield* directoryRows(objects, `SELECT id FROM users WHERE id = '${botUserId}'`),
				).toHaveLength(1)

				// Org: member, installation, a copy without the hash; channel_bots on the channel.
				const member = org.storage.db
					.prepare(`SELECT deletedAt FROM organization_members WHERE userId = ?`)
					.get(botUserId)
				expect(member).toEqual({ deletedAt: null })
				expect(org.storage.db.prepare(`SELECT apiTokenHash FROM bots`).all()).toEqual([
					{ apiTokenHash: "" },
				])
				const channelBots = () =>
					channel.storage.db.prepare(`SELECT botId FROM channel_bots`).all() as Array<{
						botId: string
					}>
				expect(channelBots()).toEqual([{ botId }])

				// A plain member may not install or uninstall.
				const denied = yield* call(
					org,
					s.orgId,
					"bot.uninstall",
					{ botId, organizationId: s.orgId },
					s.member,
				)
				expect(errorTag(denied)).toBe("UnauthorizedError")

				ok(yield* call(org, s.orgId, "bot.uninstall", { botId, organizationId: s.orgId }, s.owner))
				expect(channelBots()).toEqual([])
				expect(org.storage.db.prepare(`SELECT count(*) AS n FROM bots`).get()).toEqual({ n: 0 })
				expect(
					(
						org.storage.db
							.prepare(`SELECT deletedAt FROM organization_members WHERE userId = ?`)
							.get(botUserId) as { deletedAt: string | null }
					).deletedAt,
				).not.toBeNull()
				expect(
					yield* directoryRows(objects, `SELECT "installCount" FROM bots WHERE id = '${botId}'`),
				).toEqual([{ installCount: 0 }])

				ok(yield* call(org, s.orgId, "bot.installById", { botId, organizationId: s.orgId }, s.owner))
				expect(channelBots()).toEqual([{ botId }])
				const again = yield* call(
					org,
					s.orgId,
					"bot.installById",
					{ botId, organizationId: s.orgId },
					s.owner,
				)
				expect(errorTag(again)).toBe("BotAlreadyInstalledError")
				const installed = ok<{ data: Array<{ id: string }> }>(
					yield* call(org, s.orgId, "bot.listInstalled", { organizationId: s.orgId }, s.member),
				)
				expect(installed.data.map((bot) => bot.id)).toEqual([botId])

				// Directory-path edits fan out to the org's copy.
				ok(
					yield* objects.invokeDirectory(
						"bot.update",
						{ id: botId, name: "Helper 2" },
						principalOf(s.owner),
					),
				)
				expect(org.storage.db.prepare(`SELECT name FROM bots`).get()).toEqual({ name: "Helper 2" })
				expect(
					org.storage.db.prepare(`SELECT firstName FROM users WHERE id = ?`).get(botUserId),
				).toEqual({
					firstName: "Helper 2",
				})
				ok(yield* objects.invokeDirectory("bot.delete", { id: botId }, principalOf(s.owner)))
				expect(channelBots()).toEqual([])

				// Without an org there is nothing to install into.
				const none = yield* objects.invokeDirectory("bot.install", { botId }, principalOf(s.owner))
				expect(errorTag(none)).toBe("ActiveOrganizationRequiredError")
			}),
		))

	it("bot install grants: a registered redirect, an admin's approval, one redemption by that bot", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const home = yield* seed(objects)
				const away = yield* seed(objects)
				const worker = <A, E>(effect: Effect.Effect<A, E, ObjectStubs | Directory>) =>
					effect.pipe(
						Effect.provideService(ObjectStubs, objects.stubs),
						Effect.provideContext(objects.directory),
						Effect.exit,
					)
				const redirectUri = "https://maple.example/oauth/chat/hazel/callback"
				const created = ok<{ data: { id: string; userId: string } }>(
					yield* call(
						home.org,
						home.seed.orgId,
						"bot.create",
						{ name: "Maple", scopes: ["messages:read"], organizationId: home.seed.orgId },
						home.seed.owner,
					),
				)
				const botId = created.data.id
				const request = (uri: string) =>
					objects.invokeDirectory(
						"bot.getInstallRequest",
						{ botId, redirectUri: uri },
						principalOf(away.seed.owner),
					)
				expect(errorTag(yield* request(redirectUri))).toBe("BotInstallRedirectMismatchError")

				ok(
					yield* objects.invokeDirectory(
						"bot.update",
						{ id: botId, installRedirectUris: [redirectUri] },
						principalOf(home.seed.owner),
					),
				)
				expect(ok<{ name: string }>(yield* request(redirectUri)).name).toBe("Maple")
				expect(errorTag(yield* request(`${redirectUri}?x=1`))).toBe("BotInstallRedirectMismatchError")

				const authorize = (user: UserId, uri = redirectUri) =>
					call(
						away.org,
						away.seed.orgId,
						"bot.authorizeInstall",
						{ botId, organizationId: away.seed.orgId, redirectUri: uri },
						user,
					)
				expect(errorTag(yield* authorize(away.seed.member))).toBe("UnauthorizedError")
				expect(errorTag(yield* authorize(away.seed.owner, "https://evil.example/cb"))).toBe(
					"BotInstallRedirectMismatchError",
				)
				const { code } = ok<{ code: string }>(yield* authorize(away.seed.owner))
				expect(code.startsWith(`${away.seed.orgId}.`)).toBe(true)
				expect(away.org.storage.db.prepare(`SELECT botId FROM bot_installations`).all()).toEqual([
					{ botId },
				])
				// Approving again while installed mints another grant rather than failing.
				const second = ok<{ code: string }>(yield* authorize(away.seed.owner)).code
				expect(second).not.toBe(code)

				const redeem = (input: { code: string; botId?: string; redirectUri?: string }) =>
					Effect.flatMap(hashInstallCode(input.code), (codeHash) =>
						worker(
							callObject(RedeemBotInstallGrantCall, orgTarget(away.seed.orgId), {
								botId: (input.botId ?? botId) as never,
								codeHash,
								redirectUri: input.redirectUri ?? redirectUri,
							}),
						),
					)
				expect(errorTag(yield* redeem({ code, botId: uuid() }))).toBe("BotInstallGrantInvalidError")
				expect(errorTag(yield* redeem({ code, redirectUri: `${redirectUri}/x` }))).toBe(
					"BotInstallGrantInvalidError",
				)
				expect(ok(yield* redeem({ code }))).toEqual({
					organizationId: away.seed.orgId,
					organizationName: "Acme",
					installedBy: away.seed.owner,
				})
				expect(errorTag(yield* redeem({ code }))).toBe("BotInstallGrantInvalidError")

				// An expired grant is refused.
				away.org.storage.db
					.prepare(`UPDATE bot_install_grants SET expiresAt = '2000-01-01 00:00:00.000'`)
					.run()
				expect(errorTag(yield* redeem({ code: second }))).toBe("BotInstallGrantInvalidError")

				// The bot reads the org's people by id; another org it is not in refuses.
				const users = ok<ReadonlyArray<{ id: string; isBot: boolean; displayName: string }>>(
					yield* worker(
						callObject(OrganizationUsersCall, orgTarget(away.seed.orgId), {
							botId: botId as never,
							botUserId: created.data.userId as UserId,
							ids: [away.seed.owner, created.data.userId as UserId, uuid() as UserId],
						}),
					),
				)
				expect(users.map((user) => [user.id, user.isBot]).sort()).toEqual(
					[
						[away.seed.owner, false],
						[created.data.userId, true],
					].sort(),
				)
				const stranger = yield* seed(objects)
				const refused = yield* worker(
					callObject(OrganizationUsersCall, orgTarget(stranger.seed.orgId), {
						botId: botId as never,
						botUserId: created.data.userId as UserId,
						ids: [stranger.seed.owner],
					}),
				)
				expect(errorTag(refused)).toBe("BotNotInstalledError")
			}),
		))

	it("a bot lists the channels it can post in: public ones, and private ones it is in", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const { seed: s, org } = yield* seed(objects)
				const created = ok<{ data: { id: string; userId: string } }>(
					yield* call(
						org,
						s.orgId,
						"bot.create",
						{ name: "Maple", scopes: ["channels:read"], organizationId: s.orgId },
						s.owner,
					),
				)
				const botId = created.data.id as BotId
				const botUserId = created.data.userId as UserId
				const general = yield* createChannel(org, s, "general")
				// The bot is added to one private channel; the update recomputes its access.
				const incidents = yield* createChannel(org, s, "incidents", "private")
				org.storage.db
					.prepare(`INSERT INTO channel_members (channelId, userId) VALUES (?, ?)`)
					.run(incidents, botUserId)
				ok(yield* call(org, s.orgId, "channel.update", { id: incidents, name: "incidents" }, s.owner))
				yield* createChannel(org, s, "leadership", "private")
				const gone = yield* createChannel(org, s, "archive")
				ok(yield* call(org, s.orgId, "channel.delete", { id: gone }, s.owner))

				const list = (orgId: OrganizationId) =>
					callObject(OrganizationChannelsCall, orgTarget(orgId), { botId, botUserId }).pipe(
						Effect.provideService(ObjectStubs, objects.stubs),
						Effect.provideContext(objects.directory),
						Effect.exit,
					)
				expect(ok(yield* list(s.orgId))).toEqual([
					{ id: general, name: "general", private: false },
					{ id: incidents, name: "incidents", private: true },
				])

				// An org the bot is not installed in refuses.
				const stranger = yield* seed(objects)
				expect(errorTag(yield* list(stranger.seed.orgId))).toBe("BotNotInstalledError")
			}),
		))

	it("invitation.accept joins the org and #general, and only once", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const { seed: s, org } = yield* seed(objects)
				const general = yield* createChannel(org, s, "general")
				const invitee = uuid() as UserId
				yield* insertDirectoryUser(objects, invitee, "invitee@example.com").pipe(Effect.orDie)

				// Created in the org object: members are skipped, the row lands in D1.
				const created = ok<{ invited: Array<{ email: string }>; skipped: Array<{ email: string }> }>(
					yield* call(
						org,
						s.orgId,
						"invitation.create",
						{
							organizationId: s.orgId,
							emails: ["other@example.com", `${s.member}@example.com`],
							role: "member",
						},
						s.owner,
					),
				)
				expect(created.invited.map((i) => i.email)).toEqual(["other@example.com"])
				expect(created.skipped.map((i) => i.email)).toEqual([`${s.member}@example.com`])
				const listed = ok<Array<{ id: string }>>(
					yield* call(org, s.orgId, "invitation.list", { organizationId: s.orgId }, s.owner),
				)
				expect(listed).toHaveLength(1)
				// Revoke routes by the D1 row's org; it runs in the org for the admin check.
				ok(yield* call(org, s.orgId, "invitation.revoke", { id: listed[0]!.id }, s.owner))
				expect(
					yield* directoryRows(
						objects,
						`SELECT status FROM organization_invitations WHERE id = '${listed[0]!.id}'`,
					),
				).toEqual([{ status: "revoked" }])

				// A known token for the invitee.
				const token = "invite-token"
				const hash = Hex.encode(
					new Uint8Array(
						yield* Effect.promise(() =>
							crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
						),
					),
				)
				yield* Effect.flatMap(directoryDb(objects), (db) =>
					db.execute(
						Database_sql(
							`INSERT INTO organization_invitations (id, "organizationId", email, role, "tokenHash", "invitedBy", "expiresAt")
							VALUES ('${uuid()}', '${s.orgId}', 'invitee@example.com', 'admin', '${hash}', '${s.owner}', '${new Date(Date.now() + 60_000).toISOString()}')`,
						),
					),
				).pipe(Effect.orDie)

				const preview = ok<{ organizationName: string; status: string }>(
					yield* objects.invokeDirectory("invitation.preview", { token }, principalOf(s.member)),
				)
				expect(preview).toMatchObject({ organizationName: "Acme", status: "Pending" })

				const mismatch = yield* objects.invokeDirectory(
					"invitation.accept",
					{ token },
					principalOf(s.member),
				)
				expect(errorTag(mismatch)).toBe("InvitationEmailMismatchError")

				const accepted = ok<{ organizationId: string; slug: string }>(
					yield* objects.invokeDirectory(
						"invitation.accept",
						{ token },
						principalOf(invitee, "invitee@example.com"),
					),
				)
				expect(accepted).toMatchObject({ organizationId: s.orgId, slug: "acme" })
				expect(
					org.storage.db
						.prepare(`SELECT role FROM organization_members WHERE userId = ?`)
						.get(invitee),
				).toEqual({ role: "admin" })
				expect(
					org.storage.db
						.prepare(
							`SELECT count(*) AS n FROM channel_members WHERE userId = ? AND channelId = ?`,
						)
						.get(invitee, general),
				).toEqual({ n: 1 })
				expect(org.storage.db.prepare(`SELECT email FROM users WHERE id = ?`).get(invitee)).toEqual({
					email: "invitee@example.com",
				})
				expect(
					yield* directoryRows(
						objects,
						`SELECT "deletedAt" FROM membership_index WHERE "userId" = '${invitee}'`,
					),
				).toEqual([{ deletedAt: null }])
				const user = yield* objects.get(userTarget(invitee))
				expect(
					user.storage.db.prepare(`SELECT organizationId FROM user_organizations`).all(),
				).toEqual([{ organizationId: s.orgId }])
				const channel = yield* objects.get(channelTarget(general))
				expect(
					channel.storage.db
						.prepare(`SELECT role FROM channel_viewers WHERE userId = ?`)
						.get(invitee),
				).toEqual({ role: "admin" })

				const again = yield* objects.invokeDirectory(
					"invitation.accept",
					{ token },
					principalOf(invitee, "invitee@example.com"),
				)
				expect(errorTag(again)).toBe("InvitationUnavailableError")
			}),
		))
})

describe("UserObject", () => {
	it("notifications are the owner's: update, deleteByMessageIds, others refused", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const owner = uuid() as UserId
				const user = yield* objects.get(userTarget(owner))
				const id = uuid() as NotificationId
				const messageId = uuid()
				user.storage.db
					.prepare(
						`INSERT INTO notifications (id, memberId, resourceId, resourceType) VALUES (?, ?, ?, 'message')`,
					)
					.run(id, uuid(), messageId)

				const read = ok<{ data: { readAt: unknown }; transactionId: string }>(
					yield* call(user, owner, "notification.update", { id, readAt: new Date() }, owner),
				)
				expect(read.data.readAt).not.toBeNull()
				expect(read.transactionId).toMatch(new RegExp(`^user:${owner}:\\d+$`))

				const stranger = yield* call(user, owner, "notification.update", { id, readAt: null }, uuid())
				expect(errorTag(stranger)).toBe("UnauthorizedError")

				const created = ok<{ data: { memberId: string } }>(
					yield* call(
						user,
						owner,
						"notification.create",
						{
							memberId: uuid(),
							targetedResourceId: null,
							targetedResourceType: null,
							resourceId: uuid(),
							resourceType: "message",
							readAt: null,
						},
						owner,
					),
				)
				expect(created.data.memberId).toBeDefined()

				const deleted = ok<{ deletedCount: number }>(
					yield* call(
						user,
						owner,
						"notification.deleteByMessageIds",
						{ messageIds: [messageId], channelId: uuid() },
						owner,
					),
				)
				expect(deleted.deletedCount).toBe(1)
			}),
		))

	it("presence: a socket marks the user online in their orgs, the last close offline, status expires", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const { seed: s, org } = yield* seed(objects)
				const user = yield* objects.get(userTarget(s.member))
				// The org told the user's object about the membership (as `publishMembership` does).
				const joined = yield* user.applyEffect({
					objectId: s.member,
					kind: "user.setOrganization",
					payload: { organizationId: s.orgId, deletedAt: null },
					key: uuid(),
					sender: { kind: "org", id: s.orgId },
				})
				expect(joined._tag).toBe("Applied")

				const orgStatus = () =>
					org.storage.db
						.prepare(`SELECT status, statusEmoji FROM user_presence_status WHERE userId = ?`)
						.get(s.member) as { status: string; statusEmoji: string | null } | undefined

				const first = makeFakeSocket()
				const second = makeFakeSocket()
				expect(yield* user.adopt(first, { userId: s.member, expiresAt: null })).toBe("accepted")
				expect(yield* user.adopt(second, { userId: s.member, expiresAt: null })).toBe("accepted")
				// The projection is delivered after the upgrade answers, not before.
				for (let i = 0; i < 100 && orgStatus()?.status !== "online"; i++) {
					yield* Effect.sleep("5 millis")
				}
				expect(orgStatus()?.status).toBe("online")

				// Someone else's socket is refused and changes nothing.
				expect(yield* user.adopt(makeFakeSocket(), { userId: s.owner, expiresAt: null })).toBe(
					"forbidden",
				)

				first.close(1000, "bye")
				yield* user.onClose(first)
				expect(orgStatus()?.status).toBe("online")
				second.close(1000, "bye")
				yield* user.onClose(second)
				expect(orgStatus()?.status).toBe("offline")

				// A custom status that has expired is cleared by the alarm, in the orgs too.
				const updated = ok<{ transactionId: string }>(
					yield* call(
						user,
						s.member,
						"userPresenceStatus.update",
						{ status: "busy", statusEmoji: "🎧", statusExpiresAt: new Date(Date.now() - 1_000) },
						s.member,
					),
				)
				expect(updated.transactionId).toMatch(new RegExp(`^user:${s.member}:\\d+$`))
				expect(orgStatus()).toEqual({ status: "busy", statusEmoji: "🎧" })
				expect(user.storage.alarm()).not.toBeNull()
				yield* user.alarm
				expect(orgStatus()?.statusEmoji).toBeNull()

				// Another user's presence RPC in this object is refused.
				const foreign = yield* call(user, s.member, "userPresenceStatus.clearStatus", {}, s.owner)
				expect(errorTag(foreign)).toBe("UnauthorizedError")
			}),
		))
})
