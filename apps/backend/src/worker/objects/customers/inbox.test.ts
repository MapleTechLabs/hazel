/**
 * Support inboxes (`docs/customers/email.md` § Issues): a message in an email mailbox's channel is
 * relayed by the `OrgObject` as `customers.inboxMessage`, matched to a customer by its sender, and
 * becomes (or answers) a support issue.
 */
import type { MessageId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { orgTarget } from "../kinds"
import { makeCustomersWorld, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const T0 = new Date("2026-06-15T12:00:00.000Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString()

const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", [
		{
			_tag: "account",
			externalId: "org_acme",
			name: "Acme",
			domains: ["acme.com"],
			sameAs: [],
			onNoMatch: "create",
		},
		{
			_tag: "account",
			externalId: "org_globex",
			name: "Globex",
			domains: ["globex.io"],
			sameAs: [],
			onNoMatch: "create",
		},
		// A Globex person writing from a free-mail address: matched as a contact, not by domain.
		{
			_tag: "contact",
			externalId: "user_hank",
			account: { provider: "clerk", externalId: "org_globex" },
			email: "Hank@Gmail.com",
		},
	])
	const accountOf = (name: string) =>
		world.rows<{ id: string }>(`SELECT id FROM customer_accounts WHERE name = ?`, name)[0]!.id

	const org = yield* world.objects.get(orgTarget(world.orgId))
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Hazel', 'hazel')`).run(world.orgId)
	db.prepare(
		`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Team', 'Member')`,
	).run(world.member, `user_${world.member}`, `${world.member}@example.com`)
	db.prepare(
		`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
	).run(uuid(), world.orgId, world.member)
	// The org uses Customers (its customers object pulled the members).
	db.prepare(`INSERT INTO _object_meta (key, value) VALUES ('customersEnabled', '1')`).run()

	const channel = (type: "public" | "thread", parentChannelId: string | null = null) => {
		const id = uuid()
		db.prepare(
			`INSERT INTO channels (id, name, type, organizationId, parentChannelId) VALUES (?, ?, ?, ?, ?)`,
		).run(id, `${type}-${id.slice(0, 4)}`, type, world.orgId, parentChannelId)
		return id
	}
	const inbox = channel("public")
	const connectionId = uuid()
	db.prepare(
		`INSERT INTO chat_sync_connections (id, organizationId, provider, externalWorkspaceId, createdBy)
		 VALUES (?, ?, 'email', 'mailbox0000000001', ?)`,
	).run(connectionId, world.orgId, world.owner)
	db.prepare(
		`INSERT INTO chat_sync_channel_links (id, syncConnectionId, hazelChannelId, externalChannelId)
		 VALUES (?, ?, ?, 'mailbox0000000001')`,
	).run(uuid(), connectionId, inbox)

	/** An email author: the shadow chat sync makes for their address. */
	const sender = (address: string) => {
		const id = uuid() as UserId
		db.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, ?, ?, '', 'machine')`,
		).run(id, `email-user-${address}`, `email-user-${address.replace("@", "=")}@email.internal`, address)
		db.prepare(`INSERT INTO organization_members (id, organizationId, userId) VALUES (?, ?, ?)`).run(
			uuid(),
			world.orgId,
			id,
		)
		return id
	}

	const toOrg = world.objects.stubs.get(orgTarget(world.orgId))
	const say = (input: {
		channelId: string
		authorId: UserId
		minutes: number
		content?: string
		threadRootMessageId?: string
	}) =>
		Effect.gen(function* () {
			const messageId = uuid() as MessageId
			yield* toOrg.applyEffect({
				objectId: world.orgId,
				kind: "org.messageCreated",
				payload: {
					channelId: input.channelId,
					messageId,
					authorId: input.authorId,
					mentionedUserIds: [],
					notifyAll: false,
					replyToAuthorId: null,
					content: input.content ?? "**Exports are failing**\n\nSince this morning",
					createdAt: at(input.minutes),
					threadRootMessageId: input.threadRootMessageId ?? null,
				},
				key: uuid(),
				sender: { kind: "worker" },
			})
			return messageId
		})
	const issues = () =>
		world.rows<{
			accountId: string
			status: string
			title: string
			rootMessageId: string
			threadChannelId: string | null
			messageCount: number
		}>(`SELECT * FROM customer_issues WHERE deletedAt IS NULL ORDER BY openedAt, rowid`)
	return { world, accountOf, channel, inbox, sender, say, issues }
})

describe("email support inboxes", () => {
	it("opens an issue on the account of the sender's domain, titled by the subject", () =>
		run(
			Effect.gen(function* () {
				const { world, accountOf, channel, inbox, sender, say, issues } = yield* setup
				const ana = sender("ana@acme.com")
				const root = yield* say({ channelId: inbox, authorId: ana, minutes: 0 })
				expect(issues()).toMatchObject([
					{
						accountId: accountOf("Acme"),
						status: "new",
						title: "Exports are failing",
						rootMessageId: root,
					},
				])
				// The team answers in the conversation's thread; the customer writes back.
				const thread = channel("thread", inbox)
				yield* say({
					channelId: thread,
					authorId: world.member,
					minutes: 5,
					threadRootMessageId: root,
				})
				expect(issues()[0]).toMatchObject({ status: "waiting_on_customer", threadChannelId: thread })
				yield* say({ channelId: thread, authorId: ana, minutes: 9, threadRootMessageId: root })
				expect(issues()[0]).toMatchObject({ status: "waiting_on_us", messageCount: 3 })
				// The sender is one of the account's chat participants, by their address.
				expect(
					world.rows<{ accountId: string }>(
						`SELECT accountId FROM customer_chat_participants WHERE userId = ?`,
						ana,
					),
				).toEqual([{ accountId: accountOf("Acme") }])
			}),
		))

	it("matches a contact's exact address before any domain, even a free-mail one", () =>
		run(
			Effect.gen(function* () {
				const { accountOf, inbox, sender, say, issues } = yield* setup
				yield* say({ channelId: inbox, authorId: sender("hank@gmail.com"), minutes: 0 })
				expect(issues()).toMatchObject([{ accountId: accountOf("Globex") }])
			}),
		))

	it("opens nothing for an unknown sender or a free-mail domain", () =>
		run(
			Effect.gen(function* () {
				const { inbox, sender, say, issues } = yield* setup
				yield* say({ channelId: inbox, authorId: sender("someone@unknown.dev"), minutes: 0 })
				yield* say({ channelId: inbox, authorId: sender("stranger@gmail.com"), minutes: 1 })
				expect(issues()).toEqual([])
			}),
		))

	it("makes each email conversation its own issue (no quick follow-up merge)", () =>
		run(
			Effect.gen(function* () {
				const { inbox, sender, say, issues } = yield* setup
				const ana = sender("ana@acme.com")
				yield* say({ channelId: inbox, authorId: ana, minutes: 0 })
				yield* say({ channelId: inbox, authorId: ana, minutes: 2, content: "**Second question**" })
				expect(issues().map((issue) => issue.title)).toEqual([
					"Exports are failing",
					"Second question",
				])
			}),
		))

	it("ignores the team's top-level notes and replies under no issue", () =>
		run(
			Effect.gen(function* () {
				const { world, channel, inbox, say, issues } = yield* setup
				const note = yield* say({ channelId: inbox, authorId: world.member, minutes: 0 })
				yield* say({
					channelId: channel("thread", inbox),
					authorId: world.member,
					minutes: 1,
					threadRootMessageId: note,
				})
				expect(issues()).toEqual([])
			}),
		))
})
