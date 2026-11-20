/**
 * Suggested links for a channel an org mounted from another org's Connect share: the guest org's
 * `OrgObject` holds only its mount, so the `CustomersObject` asks the host org for the people
 * (`org.connectGuestEvidence`), and a host member who is one of the guest's contacts links the
 * channel by itself.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import type { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, type Exit, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../../rpc/dispatch"
import { Directory } from "../../../services/directory"
import { customersTarget, orgTarget } from "../kinds"
import { connectGuestEvidence } from "../org/channel-evidence"
import { encodeInvokePrincipal } from "../principal"
import { makeTestObjects, type TestObject, type TestObjects } from "../testing"
import { ok, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

const call = (
	object: TestObject,
	objectId: string,
	tag: HazelRpcTag,
	payload: unknown,
	user: string,
): Effect.Effect<Exit.Exit<any, unknown>> =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	}).pipe(Effect.orDie)

const directoryUser = (objects: TestObjects, id: UserId, firstName: string) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.run(
			SQLite.insertInto(schema.usersTable).values({
				id,
				externalId: `ext-${id}`,
				email: `${id}@example.com`,
				firstName,
				lastName: "Last",
			}),
		),
	).pipe(Effect.provideContext(objects.directory), Effect.orDie)

const makeOrg = (objects: TestObjects, name: string, slug: string, owner: UserId) =>
	Effect.gen(function* () {
		const id = uuid() as OrganizationId
		const object = yield* objects.get(orgTarget(id))
		ok(
			yield* call(
				object,
				id,
				"organization.create",
				{ name, slug, logoUrl: null, settings: null, isPublic: false },
				owner,
			),
		)
		return { id, object }
	})

/** Host org A shares a channel with guest org B; B's customers know A's member as a contact. */
const makeShare = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const [a1, b1] = [uuid(), uuid()] as Array<UserId>
	yield* directoryUser(objects, a1, "Ada")
	yield* directoryUser(objects, b1, "Bea")
	const a = yield* makeOrg(objects, "Acme", "acme", a1)
	const b = yield* makeOrg(objects, "Beta", "beta", b1)
	const hostChannelId = uuid() as ChannelId
	ok(
		yield* call(
			a.object,
			a.id,
			"channel.create",
			{
				id: hostChannelId,
				name: "partners",
				icon: null,
				type: "private",
				organizationId: a.id,
				parentChannelId: null,
				sectionId: null,
			},
			a1,
		),
	)
	const invite = ok(
		yield* call(
			a.object,
			a.id,
			"connectShare.invite.create",
			{ channelId: hostChannelId, target: { kind: "slug", value: "beta" }, allowGuestMemberAdds: true },
			a1,
		),
	)
	ok(
		yield* call(
			b.object,
			b.id,
			"connectShare.invite.accept",
			{ inviteId: invite.data.id as ConnectInviteId, guestOrganizationId: b.id },
			b1,
		),
	)
	yield* a.object.alarm.pipe(Effect.orDie)
	yield* b.object.alarm.pipe(Effect.orDie)
	const [mount] = b.object.storage.db
		.prepare(`SELECT channelId, conversationId FROM connect_conversation_channels WHERE role = 'guest'`)
		.all() as Array<{ channelId: ChannelId; conversationId: ConnectConversationId }>

	const customers = yield* objects.get(customersTarget(b.id))
	yield* customers.applyEffect({
		objectId: b.id,
		kind: "customers.setMembers",
		payload: { organizationId: b.id, members: [{ userId: b1, role: "owner" }], version: 1 },
		key: uuid(),
		sender: { kind: "org", id: b.id },
	})
	ok(yield* call(customers, b.id, "customers.ignoreRules.list", { organizationId: b.id }, b1))
	const accountId = uuid()
	customers.storage.db
		.prepare(`INSERT INTO customer_accounts (id, organizationId, name) VALUES (?, ?, 'Acme')`)
		.run(accountId, b.id)
	customers.storage.db
		.prepare(`INSERT INTO customer_contacts (id, accountId, email) VALUES (?, ?, ?)`)
		.run(uuid(), accountId, ` ${a1.toUpperCase()}@Example.com`)
	return { objects, a, b, a1, b1, mount: mount!, customers, accountId }
})

describe("Suggested links for a Connect guest's channel", () => {
	it("asks the host for its people and links the channel to the contact's account", () =>
		run(
			Effect.gen(function* () {
				const t = yield* makeShare
				const listed = yield* call(
					t.customers,
					t.b.id,
					"customers.channel.suggestions",
					{ organizationId: t.b.id, channelId: t.mount.channelId },
					t.b1,
				)
				ok(listed)
				const links = t.customers.storage.db
					.prepare(
						`SELECT channelId, accountId, linkedBy FROM customer_channel_links WHERE deletedAt IS NULL`,
					)
					.all()
				expect(links).toEqual([
					{ channelId: t.mount.channelId, accountId: t.accountId, linkedBy: null },
				])
			}),
		))

	it("the host answers only for conversations the guest has mounted, without the guest's people", () =>
		run(
			Effect.gen(function* () {
				const t = yield* makeShare
				const ask = (guestOrganizationId: OrganizationId) =>
					t.a.object
						.run(
							connectGuestEvidence({
								organizationId: t.a.id,
								guestOrganizationId,
								conversationIds: [t.mount.conversationId],
							}),
						)
						.pipe(Effect.orDie)
				const answer = yield* ask(t.b.id)
				expect(answer).toHaveLength(1)
				expect(answer[0]?.members).toContainEqual({ source: "connect", email: `${t.a1}@example.com` })
				expect(answer[0]?.members).not.toContainEqual({
					source: "connect",
					email: `${t.b1}@example.com`,
				})
				// Another org, not mounted: nothing.
				expect(yield* ask(uuid() as OrganizationId)).toEqual([])
			}),
		))
})
