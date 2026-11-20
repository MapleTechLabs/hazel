/**
 * Who writes in channels linked to customers (`docs/customers/author-side.md`): the `OrgObject`
 * classifies each author of a linked channel's messages (customer, team, bot, unknown), keeps
 * `customer_chat_authors`, and streams the messages to the `CustomersObject`, which keeps
 * `customer_chat_participants`. Overrides and the backfill of a newly linked channel follow.
 */
import { schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, rpcFor } from "../../../rpc/dispatch"
import { channelTarget, orgTarget } from "../kinds"
import { encodeInvokePrincipal } from "../principal"
import type { TestObject } from "../testing"
import { makeCustomersWorld, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", [
		{ _tag: "account", externalId: "org_acme", name: "Acme", sameAs: [], onNoMatch: "create" },
	])
	const acme = world.rows<{ id: string }>(`SELECT id FROM customer_accounts WHERE name = 'Acme'`)[0]!.id
	const org = yield* world.objects.get(orgTarget(world.orgId))
	const exec = (query: string, ...params: Array<string | number | null>) =>
		org.storage.db.prepare(query).run(...params)
	const orgRows = <T>(query: string, ...params: Array<string>) =>
		org.storage.db.prepare(query).all(...params) as Array<T>
	exec(
		`INSERT INTO organizations (id, name, slug) VALUES (?, 'Vendor', ?)`,
		world.orgId,
		`vendor-${uuid()}`,
	)

	/** A `users` projection row; `member` also makes them a member (live or `left`). */
	const person = (options: {
		externalId?: string
		userType?: "user" | "machine"
		email?: string
		name?: string
		member?: "live" | "left"
	}) => {
		const id = uuid() as UserId
		exec(
			`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, ?, ?, '', ?)`,
			id,
			options.externalId ?? `user_${id}`,
			options.email ?? `${id}@example.com`,
			options.name ?? "Person",
			options.userType ?? "user",
		)
		if (options.member !== undefined) {
			exec(
				`INSERT INTO organization_members (id, organizationId, userId, deletedAt) VALUES (?, ?, ?, ?)`,
				uuid(),
				world.orgId,
				id,
				options.member === "left" ? new Date().toISOString() : null,
			)
		}
		return id
	}
	for (const userId of [world.owner, world.member]) {
		exec(
			`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Team', 'Member')`,
			userId,
			`user_${userId}`,
			`${userId}@example.com`,
		)
		exec(
			`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'owner')`,
			uuid(),
			world.orgId,
			userId,
		)
	}

	const channel = (type: "public" | "thread" = "public", parentChannelId: string | null = null) => {
		const id = uuid() as ChannelId
		exec(
			`INSERT INTO channels (id, name, type, organizationId, parentChannelId) VALUES (?, ?, ?, ?, ?)`,
			id,
			`${type}-${id.slice(0, 4)}`,
			type,
			world.orgId,
			parentChannelId,
		)
		for (const userId of [world.owner, world.member]) {
			exec(
				`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`,
				userId,
				id,
				world.orgId,
			)
		}
		return id
	}
	const link = (channelId: string) =>
		world.call("customers.channel.link", { accountId: acme, channelId }, world.member)

	/** What the channel's object sends the org for a new message. */
	const post = (channelId: ChannelId, authorId: UserId, at = new Date()) =>
		org.applyEffect({
			objectId: world.orgId,
			kind: "org.messageCreated",
			payload: {
				channelId,
				messageId: uuid(),
				authorId,
				mentionedUserIds: [],
				notifyAll: false,
				replyToAuthorId: null,
				createdAt: at.toISOString(),
			},
			key: uuid(),
			sender: { kind: "channel", id: channelId },
		})

	const authors = () =>
		Object.fromEntries(
			orgRows<{ userId: string; side: string; reason: string }>(
				`SELECT userId, side, reason FROM customer_chat_authors`,
			).map((row) => [row.userId, `${row.side}:${row.reason}`]),
		)
	const participants = () =>
		Object.fromEntries(
			world
				.rows<{ userId: string; side: string; accountId: string; lastChannelId: string }>(
					`SELECT userId, side, accountId, lastChannelId FROM customer_chat_participants`,
				)
				.map((row) => [row.userId, row]),
		)

	/** An RPC on the org's object, as `user`. */
	const callOrg = (tag: "customers.chatAuthor.setSide", payload: Record<string, unknown>, user: UserId) =>
		Effect.gen(function* () {
			const rpc = yield* rpcFor(tag)
			const response = yield* org.invoke({
				objectId: world.orgId,
				tag,
				payload: yield* encodePayload(rpc, { organizationId: world.orgId, ...payload }),
				principal: yield* encodeInvokePrincipal({
					user: new CurrentUser.Schema({
						id: user,
						role: "member",
						email: `${user}@example.com`,
						isOnboarded: true,
						timezone: null,
						settings: null,
					}),
					botScopes: null,
				}),
			})
			return yield* decodeExit(rpc, structuredClone(response).exit)
		}).pipe(Effect.orDie)

	return { world, org, exec, acme, person, channel, link, post, authors, participants, callOrg }
})

describe("Author side in linked channels", () => {
	it("classifies each author by what the org knows of them", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel()
				expect(tagOf(yield* t.link(general))).toBe("Success")
				const formerTeammate = t.person({ member: "left" })
				// Chat-sync shadows are machine users made members on first sight.
				const slackCustomer = t.person({
					externalId: "slack-user-UACME",
					userType: "machine",
					member: "live",
				})
				const slackTeammate = t.person({
					externalId: "slack-user-UOURS",
					userType: "machine",
					member: "live",
				})
				const discordUser = t.person({
					externalId: "discord-user-42",
					userType: "machine",
					member: "live",
				})
				const integration = t.person({
					externalId: "integration-bot-github",
					userType: "machine",
					member: "live",
				})
				const guest = t.person({ email: "jane@acme.com", name: "Jane" })
				t.exec(
					`INSERT INTO connect_participants (id, conversationId, channelId, userId, homeOrganizationId, isExternal) VALUES (?, ?, ?, ?, ?, 1)`,
					uuid(),
					uuid(),
					general,
					guest,
					uuid() as OrganizationId,
				)
				const stranger = uuid() as UserId
				// The account's contact with the guest's email (another case).
				const contactId = uuid()
				t.world.object.storage.db
					.prepare(
						`INSERT INTO customer_contacts (id, accountId, email, name) VALUES (?, ?, ?, 'Jane')`,
					)
					.run(contactId, t.acme, "JANE@acme.com")
				const unlinked = t.channel()
				const slackOutsider = t.person({
					externalId: "slack-user-UOUT",
					userType: "machine",
					member: "live",
				})
				// Left the org, now writes from the customer's org in the Connect channel.
				const leftForCustomer = t.person({ member: "left" })
				t.exec(
					`INSERT INTO connect_participants (id, conversationId, channelId, userId, homeOrganizationId, isExternal) VALUES (?, ?, ?, ?, ?, 1)`,
					uuid(),
					uuid(),
					general,
					leftForCustomer,
					uuid() as OrganizationId,
				)
				yield* t.org.run(
					Effect.gen(function* () {
						const { noteExternalWorkspace } = yield* Effect.promise(
							() => import("../org/customer-chat"),
						)
						yield* noteExternalWorkspace(t.world.orgId, general, slackCustomer, "other")
						yield* noteExternalWorkspace(t.world.orgId, general, slackTeammate, "home")
						// Authors of channels not linked to a customer are not kept.
						yield* noteExternalWorkspace(t.world.orgId, unlinked, slackOutsider, "other")
					}),
				)

				for (const author of [
					t.world.member,
					formerTeammate,
					slackCustomer,
					slackTeammate,
					discordUser,
					integration,
					guest,
					leftForCustomer,
					stranger,
				]) {
					yield* t.post(general, author)
				}

				expect(t.authors()).toEqual({
					[t.world.member]: "team:org_member",
					[formerTeammate]: "team:former_member",
					[slackCustomer]: "customer:external_other_workspace",
					[slackTeammate]: "team:external_home_workspace",
					[discordUser]: "customer:external",
					[integration]: "bot:bot",
					[guest]: "customer:connect_guest",
					[leftForCustomer]: "customer:connect_guest",
					[stranger]: "unknown:unknown",
				})
				const participants = t.participants()
				expect(Object.keys(participants)).toHaveLength(9)
				expect(participants[slackCustomer]).toMatchObject({ side: "customer", accountId: t.acme })
				expect(participants[t.world.member]).toMatchObject({ side: "team" })
				// The Connect guest's email names the account's contact when there is one.
				const contact = t.world.rows<{ contactId: string | null; name: string }>(
					`SELECT contactId, name FROM customer_chat_participants WHERE userId = ?`,
					guest,
				)[0]!
				expect(contact).toEqual({ contactId, name: "Jane" })
				// Shadows have no real email: never matched.
				expect(participants[slackCustomer]).toMatchObject({ side: "customer" })
				expect(
					t.world.rows<{ contactId: string | null }>(
						`SELECT contactId FROM customer_chat_participants WHERE userId = ?`,
						slackCustomer,
					)[0]?.contactId,
				).toBeNull()
			}),
		))

	it("ignores unlinked channels and files thread messages under the linked parent", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const linked = t.channel()
				const other = t.channel()
				yield* t.link(linked)
				const thread = t.channel("thread", linked)
				const customer = t.person({
					externalId: "discord-user-7",
					userType: "machine",
					member: "live",
				})
				yield* t.post(other, customer)
				expect(t.participants()).toEqual({})
				yield* t.post(thread, customer)
				expect(t.participants()[customer]).toMatchObject({ side: "customer", lastChannelId: linked })
			}),
		))

	it("lets a member override someone's side, and clear it", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel()
				yield* t.link(general)
				const bob = t.person({ externalId: "slack-user-UBOB", userType: "machine", member: "live" })
				yield* t.post(general, bob)
				expect(t.participants()[bob]?.side).toBe("customer")

				const marked = yield* t.callOrg(
					"customers.chatAuthor.setSide",
					{ userId: bob, side: "team" },
					t.world.member,
				)
				expect(tagOf(marked)).toBe("Success")
				expect(t.authors()[bob]).toBe("team:override")
				expect(t.participants()[bob]?.side).toBe("team")

				const cleared = yield* t.callOrg(
					"customers.chatAuthor.setSide",
					{ userId: bob, side: null },
					t.world.member,
				)
				expect(tagOf(cleared)).toBe("Success")
				expect(t.authors()[bob]).toBe("customer:external")
				expect(t.participants()[bob]?.side).toBe("customer")

				// Not a member (a shadow cannot sign in, but is refused anyway), or nobody the org knows.
				expect(
					tagOf(
						yield* t.callOrg("customers.chatAuthor.setSide", { userId: bob, side: "team" }, bob),
					),
				).toBe("UnauthorizedError")
				const unknown = yield* t.callOrg(
					"customers.chatAuthor.setSide",
					{ userId: uuid(), side: "team" },
					t.world.member,
				)
				expect(tagOf(unknown)).toBe("CustomersNotFoundError")
			}),
		))

	it("backfills a newly linked channel's past authors, threads included", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel()
				const thread = t.channel("thread", general)
				const customer = t.person({
					externalId: "discord-user-9",
					userType: "machine",
					member: "live",
				})
				const threadOnly = t.person({
					externalId: "discord-user-10",
					userType: "machine",
					member: "live",
				})
				const setViewers = (channelId: ChannelId) =>
					Effect.gen(function* () {
						const object = yield* t.world.objects.get(channelTarget(channelId))
						yield* object.applyEffect({
							objectId: channelId,
							kind: "channel.setViewers",
							payload: {
								organizationId: t.world.orgId,
								conversationId: null,
								viewers: [
									{ userId: t.world.member, organizationId: t.world.orgId, role: "member" },
								],
								bots: [],
							},
							key: uuid(),
							sender: { kind: "org", id: t.world.orgId },
						})
						return object
					})
				const insertMessage = (
					object: TestObject,
					channelId: ChannelId,
					authorId: UserId,
					createdAt: string,
					threadChannelId: ChannelId | null = null,
				) =>
					object.storage.db
						.prepare(
							`INSERT INTO messages (id, channelId, authorId, content, threadChannelId, createdAt) VALUES (?, ?, ?, 'hi', ?, ?)`,
						)
						.run(uuid(), channelId, authorId, threadChannelId, createdAt)
				const parent = yield* setViewers(general)
				const threadObject = yield* setViewers(thread)
				insertMessage(parent, general, customer, "2026-01-01T10:00:00.000Z")
				insertMessage(parent, general, customer, "2026-02-01T10:00:00.000Z", thread)
				insertMessage(parent, general, t.world.member, "2026-01-02T10:00:00.000Z")
				insertMessage(threadObject, thread, threadOnly, "2026-03-01T10:00:00.000Z")

				expect(tagOf(yield* t.link(general))).toBe("Success")
				const participants = t.participants()
				expect(participants[customer]).toMatchObject({ side: "customer" })
				expect(participants[t.world.member]).toMatchObject({ side: "team" })
				expect(participants[threadOnly]).toMatchObject({ side: "customer", lastChannelId: general })
				const window = t.world.rows<{ firstMessageAt: string; lastMessageAt: string }>(
					`SELECT firstMessageAt, lastMessageAt FROM customer_chat_participants WHERE userId = ?`,
					customer,
				)[0]!
				expect(schema.parseTimestamp(window.firstMessageAt).toISOString()).toBe(
					"2026-01-01T10:00:00.000Z",
				)
				expect(schema.parseTimestamp(window.lastMessageAt).toISOString()).toBe(
					"2026-02-01T10:00:00.000Z",
				)

				// Linking again (or a new snapshot) does not ask twice.
				yield* t.link(general)
				expect(Object.keys(t.participants())).toHaveLength(3)

				// Unlinked, then linked again: asked again (a new request, past the inbox's dedupe).
				t.world.object.storage.db.prepare(`DELETE FROM customer_chat_participants`).run()
				expect(
					tagOf(
						yield* t.world.call(
							"customers.channel.unlink",
							{ channelId: general },
							t.world.member,
						),
					),
				).toBe("Success")
				yield* t.link(general)
				expect(Object.keys(t.participants())).toHaveLength(3)

				// Moved to another account in place: that account gets the past authors too.
				yield* t.world.ingest("clerk", [
					{
						_tag: "account",
						externalId: "org_globex",
						name: "Globex",
						sameAs: [],
						onNoMatch: "create",
					},
				])
				const globex = t.world.rows<{ id: string }>(
					`SELECT id FROM customer_accounts WHERE name = 'Globex'`,
				)[0]!.id
				const moved = yield* t.world.call(
					"customers.channel.link",
					{ accountId: globex, channelId: general },
					t.world.member,
				)
				expect(tagOf(moved)).toBe("Success")
				expect(
					t.world.rows<{ userId: string }>(
						`SELECT userId FROM customer_chat_participants WHERE accountId = ?`,
						globex,
					),
				).toHaveLength(3)
			}),
		))
})
