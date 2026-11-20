/**
 * Support issues (`docs/customers/issues.md`): the pure transitions, and the flow from the
 * `OrgObject`'s `org.messageCreated` through the relay to the `CustomersObject`, plus the issue RPCs.
 */
import type { ChannelId, CustomerIssueId, MessageId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { Directory } from "../../../services/directory"
import { channelTarget, customersTarget, orgTarget } from "../kinds"
import {
	foldMessage,
	type IssueActivity,
	joinsIssue,
	MERGE_WINDOW_MS,
	openedBy,
	type SupportMessage,
	seedDemoIssues,
	titleOf,
} from "./issues"
import { makeCustomersWorld, ok, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const T0 = new Date("2026-06-15T12:00:00.000Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
const CUSTOMER = uuid() as UserId
const TEAMMATE = uuid() as UserId

const message = (side: SupportMessage["side"], minutes: number, authorId?: UserId): SupportMessage => ({
	messageId: uuid() as MessageId,
	authorId: authorId ?? (side === "team" ? TEAMMATE : CUSTOMER),
	side,
	sentAt: at(minutes),
	content: "Our dashboard is broken",
})

const fold = (issue: IssueActivity, ...messages: Array<SupportMessage>) => messages.reduce(foldMessage, issue)

describe("issue transitions", () => {
	const opened = openedBy(message("customer", 0), false)

	it("opens new on the customer's message, with the customer timestamps", () => {
		expect(opened).toMatchObject({
			status: "new",
			firstCustomerMessageAt: at(0),
			lastCustomerMessageAt: at(0),
			firstTeamReplyAt: null,
			messageCount: 1,
		})
	})

	it.each([
		["new", "team", "waiting_on_customer"],
		["new", "customer", "new"],
		["waiting_on_customer", "customer", "waiting_on_us"],
		["waiting_on_us", "team", "waiting_on_customer"],
		["on_hold", "team", "on_hold"],
		["on_hold", "customer", "waiting_on_us"],
		["closed", "team", "closed"],
		["closed", "customer", "waiting_on_us"],
		["waiting_on_us", "bot", "waiting_on_us"],
		["waiting_on_us", "unknown", "waiting_on_us"],
	] as const)("%s + %s message → %s", (from, side, to) => {
		expect(foldMessage({ ...opened, status: from }, message(side, 5)).status).toBe(to)
	})

	it("records the first and last team reply (first response)", () => {
		const issue = fold(opened, message("team", 3), message("customer", 4), message("team", 9))
		expect(issue).toMatchObject({
			status: "waiting_on_customer",
			firstTeamReplyAt: at(3),
			lastTeamReplyAt: at(9),
			lastCustomerMessageAt: at(4),
			lastMessageAt: at(9),
			messageCount: 4,
		})
	})

	it("reopens a closed issue when the customer writes again", () => {
		const closed = { ...fold(opened, message("team", 3)), status: "closed" as const, closedAt: at(4) }
		expect(foldMessage(closed, message("customer", 60))).toMatchObject({
			status: "waiting_on_us",
			closedAt: null,
			reopenCount: 1,
			reopenedAt: at(60),
		})
	})

	it("an out-of-order message fills timestamps but leaves the status", () => {
		const answered = fold(opened, message("team", 10))
		const late = foldMessage(answered, message("customer", 5))
		expect(late.status).toBe("waiting_on_customer")
		expect(late.lastCustomerMessageAt).toEqual(at(5))
		expect(late.lastMessageAt).toEqual(at(10))
		// A team reply delivered late still counts as the first response.
		const early = foldMessage(fold(opened, message("team", 10)), message("team", 2))
		expect(early.firstTeamReplyAt).toEqual(at(2))
	})

	it("an issue a member opens on a team message is waiting on us, with no customer timestamps", () => {
		expect(openedBy(message("team", 0), true)).toMatchObject({
			status: "waiting_on_us",
			firstCustomerMessageAt: null,
		})
		expect(openedBy(message("customer", 0), true).status).toBe("new")
	})

	it("joins the same author's unanswered issue within the merge window only", () => {
		const issue = { ...opened, openedByUserId: CUSTOMER }
		const minutes = MERGE_WINDOW_MS / 60_000
		expect(joinsIssue(issue, message("customer", 1))).toBe(true)
		expect(joinsIssue(issue, message("customer", minutes + 1))).toBe(false)
		expect(joinsIssue(issue, message("customer", 1, uuid() as UserId))).toBe(false)
		expect(joinsIssue(issue, message("team", 1))).toBe(false)
		const answered = { ...fold(issue, message("team", 2)), openedByUserId: CUSTOMER }
		expect(joinsIssue(answered, message("customer", 3))).toBe(false)
	})

	it("titles an issue by its first line", () => {
		expect(titleOf("\n  Login fails on SSO  \nmore detail")).toBe("Login fails on SSO")
		expect(titleOf("   ")).toBe("Message with no text")
		expect(Array.from(titleOf("x".repeat(500))).length).toBe(140)
	})
})

// ---------------------------------------------------------------------------
// Relay and RPCs
// ---------------------------------------------------------------------------

interface IssueRow {
	id: CustomerIssueId
	accountId: string
	status: string
	title: string
	rootMessageId: string
	threadChannelId: string | null
	openedByUserId: string
	createdByUserId: string | null
	assigneeUserId: string | null
	priority: string
	tags: string
	firstTeamReplyAt: string | null
	closedAt: string | null
	reopenCount: number
	messageCount: number
	deletedAt: string | null
}

const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", [
		{ _tag: "account", externalId: "org_acme", name: "Acme", sameAs: [], onNoMatch: "create" },
	])
	const accountId = world.rows<{ id: string }>(`SELECT id FROM customer_accounts WHERE name = 'Acme'`)[0]!
		.id
	const org = yield* world.objects.get(orgTarget(world.orgId))
	const orgDb = org.storage.db
	orgDb.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Hazel', 'hazel')`).run(world.orgId)
	// The member is on the team: a person and a member of the org (the author-side classifier).
	orgDb
		.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Team', 'Member')`,
		)
		.run(world.member, `user_${world.member}`, `${world.member}@example.com`)
	orgDb
		.prepare(
			`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
		)
		.run(uuid(), world.orgId, world.member)
	/** A customer: a Discord author chat sync mirrors in (a shadow member), classified `customer:external`. */
	let shadows = 0
	const customerUser = () => {
		shadows += 1
		const id = uuid() as UserId
		orgDb
			.prepare(
				`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, ?, 'Customer', '', 'machine')`,
			)
			.run(id, `discord-user-${shadows}`, `${id}@example.com`)
		orgDb
			.prepare(`INSERT INTO organization_members (id, organizationId, userId) VALUES (?, ?, ?)`)
			.run(uuid(), world.orgId, id)
		return id
	}
	const channel = (type: "public" | "thread", parentChannelId: string | null = null) => {
		const id = uuid()
		orgDb
			.prepare(
				`INSERT INTO channels (id, name, type, organizationId, parentChannelId) VALUES (?, ?, ?, ?, ?)`,
			)
			.run(id, `${type}-${id.slice(0, 4)}`, type, world.orgId, parentChannelId)
		orgDb
			.prepare(`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`)
			.run(world.member, id, world.orgId)
		return id
	}
	const linked = channel("public")
	ok(yield* world.call("customers.channel.link", { accountId, channelId: linked }, world.member))
	/** Deliver as the Worker would: the call waits for the deliveries it sets off. */
	const toOrg = world.objects.stubs.get(orgTarget(world.orgId))
	const customer = customerUser()

	/** `org.messageCreated` as the channel's object sends it; waits for the relay to land. */
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
					content: input.content ?? "Our dashboard is broken\nSince this morning",
					createdAt: at(input.minutes).toISOString(),
					threadRootMessageId: input.threadRootMessageId ?? null,
				},
				key: uuid(),
				sender: { kind: "worker" },
			})
			return messageId
		})
	const issues = () =>
		world.rows<IssueRow>(`SELECT * FROM customer_issues WHERE deletedAt IS NULL ORDER BY openedAt`)
	return { world, toOrg, accountId, channel, linked, customer, customerUser, say, issues }
})

describe("support issues", () => {
	it("opens an issue on a customer's top-level message, and the thread follows it", () =>
		run(
			Effect.gen(function* () {
				const { world, channel, linked, customer, say, issues, accountId } = yield* setup
				const root = yield* say({ channelId: linked, authorId: customer, minutes: 0 })
				expect(issues()).toMatchObject([
					{
						accountId,
						status: "new",
						title: "Our dashboard is broken",
						rootMessageId: root,
						messageCount: 1,
					},
				])
				const thread = channel("thread", linked)
				yield* say({
					channelId: thread,
					authorId: world.member,
					minutes: 5,
					threadRootMessageId: root,
				})
				expect(issues()[0]).toMatchObject({ status: "waiting_on_customer", threadChannelId: thread })
				expect(issues()[0]!.firstTeamReplyAt).not.toBeNull()
				yield* say({ channelId: thread, authorId: customer, minutes: 9, threadRootMessageId: root })
				expect(issues()[0]).toMatchObject({ status: "waiting_on_us", messageCount: 3 })
				expect(
					world.rows(`SELECT type FROM customer_events WHERE type = 'issue.opened'`),
				).toHaveLength(1)
			}),
		))

	it("ignores team top-level messages, unlinked channels and replies under no issue", () =>
		run(
			Effect.gen(function* () {
				const { world, channel, linked, customer, say, issues } = yield* setup
				const teamRoot = yield* say({ channelId: linked, authorId: world.member, minutes: 0 })
				yield* say({ channelId: channel("public"), authorId: customer, minutes: 1 })
				const thread = channel("thread", linked)
				yield* say({
					channelId: thread,
					authorId: customer,
					minutes: 2,
					threadRootMessageId: teamRoot,
				})
				expect(issues()).toEqual([])
			}),
		))

	it("merges a customer's quick follow-up, and opens a new issue after the window or an answer", () =>
		run(
			Effect.gen(function* () {
				const { linked, customer, customerUser, say, issues } = yield* setup
				yield* say({ channelId: linked, authorId: customer, minutes: 0, content: "hi" })
				yield* say({ channelId: linked, authorId: customer, minutes: 1, content: "dashboard broken" })
				expect(issues()).toMatchObject([{ title: "hi", messageCount: 2 }])
				yield* say({ channelId: linked, authorId: customer, minutes: 30, content: "also billing" })
				expect(issues().map((issue) => issue.title)).toEqual(["hi", "also billing"])
				// Another customer is another issue.
				yield* say({ channelId: linked, authorId: customerUser(), minutes: 31, content: "me too" })
				expect(issues()).toHaveLength(3)
			}),
		))

	it("reopens a closed issue when the customer replies in its thread", () =>
		run(
			Effect.gen(function* () {
				const { world, channel, linked, customer, say, issues } = yield* setup
				const root = yield* say({ channelId: linked, authorId: customer, minutes: 0 })
				const issueId = issues()[0]!.id
				ok(yield* world.call("customers.issue.update", { issueId, status: "closed" }, world.member))
				expect(issues()[0]!.closedAt).not.toBeNull()
				const thread = channel("thread", linked)
				yield* say({ channelId: thread, authorId: customer, minutes: 90, threadRootMessageId: root })
				expect(issues()[0]).toMatchObject({ status: "waiting_on_us", closedAt: null, reopenCount: 1 })
			}),
		))

	it("updates assignee, priority, tags and status by hand, refusing a non-member assignee", () =>
		run(
			Effect.gen(function* () {
				const { world, linked, customer, say, issues } = yield* setup
				yield* say({ channelId: linked, authorId: customer, minutes: 0 })
				const issueId = issues()[0]!.id
				ok(
					yield* world.call(
						"customers.issue.update",
						{
							issueId,
							assigneeUserId: world.member,
							priority: "high",
							tags: [" bug ", "bug", "sso"],
							status: "on_hold",
						},
						world.member,
					),
				)
				expect(issues()[0]).toMatchObject({
					assigneeUserId: world.member,
					priority: "high",
					tags: JSON.stringify(["bug", "sso"]),
					status: "on_hold",
				})
				expect(
					tagOf(
						yield* world.call(
							"customers.issue.update",
							{ issueId, assigneeUserId: customer },
							world.member,
						),
					),
				).toBe("CustomersInvalidRequestError")
				expect(
					tagOf(
						yield* world.call(
							"customers.issue.update",
							{ issueId: uuid(), status: "closed" },
							world.member,
						),
					),
				).toBe("CustomersNotFoundError")
				expect(
					world
						.rows<{ type: string }>(
							`SELECT type FROM customer_events WHERE type LIKE 'issue.%' ORDER BY type`,
						)
						.map((row) => row.type),
				).toEqual(["issue.assigned", "issue.opened", "issue.status_changed"])
			}),
		))

	it("creates an issue from a message by hand, once, for a reader of the linked channel", () =>
		run(
			Effect.gen(function* () {
				const { world, channel, linked, issues } = yield* setup
				const channelObject = yield* world.objects.get(channelTarget(linked))
				const messageId = uuid()
				channelObject.storage.db
					.prepare(`INSERT INTO messages (id, channelId, authorId, content) VALUES (?, ?, ?, ?)`)
					.run(messageId, linked, world.member, "Customer called: SSO broken")
				const create = (user: UserId, channelId = linked) =>
					world.call("customers.issue.createFromMessage", { channelId, messageId }, user)
				// Not a viewer of the channel yet: the message is not theirs to see.
				expect(tagOf(yield* create(world.member))).toBe("CustomersNotFoundError")
				channelObject.storage.db
					.prepare(
						`INSERT INTO channel_viewers (userId, organizationId, role) VALUES (?, ?, 'member')`,
					)
					.run(world.member, world.orgId)
				const created = ok(yield* create(world.member)).data
				expect(created).toMatchObject({
					title: "Customer called: SSO broken",
					status: "waiting_on_us",
					createdByUserId: world.member,
				})
				expect(ok(yield* create(world.member)).data.id).toBe(created.id)
				expect(issues()).toHaveLength(1)
				expect(tagOf(yield* create(world.member, channel("public")))).toBe(
					"CustomersInvalidRequestError",
				)
			}),
		))

	it("drops an issue whose root was deleted before anyone answered", () =>
		run(
			Effect.gen(function* () {
				const { world, toOrg, linked, customer, say, issues } = yield* setup
				const root = yield* say({ channelId: linked, authorId: customer, minutes: 0 })
				yield* toOrg.applyEffect({
					objectId: world.orgId,
					kind: "org.messageDeleted",
					payload: { channelId: linked, messageId: root },
					key: uuid(),
					sender: { kind: "worker" },
				})
				expect(issues()).toEqual([])
			}),
		))

	it("refuses a deleted root from anyone but the org's own object", () =>
		run(
			Effect.gen(function* () {
				const { world, linked, customer, say, issues } = yield* setup
				const root = yield* say({ channelId: linked, authorId: customer, minutes: 0 })
				// Refused in the receiving transaction (logged and dropped, never retried).
				yield* Effect.exit(
					world.objects.stubs.get(customersTarget(world.orgId)).applyEffect({
						objectId: world.orgId,
						kind: "customers.supportMessageDeleted",
						payload: { organizationId: world.orgId, channelId: linked, messageId: root },
						key: uuid(),
						sender: { kind: "channel", id: linked },
					}),
				)
				expect(issues()).toHaveLength(1)
			}),
		))

	it("seeds demo issues once, on linked channels when there are any", () =>
		run(
			Effect.gen(function* () {
				const { world, linked } = yield* setup
				const seed = () =>
					world.object
						.run(seedDemoIssues({ organizationId: world.orgId, now: T0 }))
						.pipe(Effect.orDie)
				expect(yield* seed()).toBe(8)
				expect(yield* seed()).toBe(0)
				const rows = world.rows<{ sourceChannelId: string; status: string }>(
					`SELECT sourceChannelId, status FROM customer_issues`,
				)
				expect(new Set(rows.map((row) => row.sourceChannelId))).toEqual(new Set([linked]))
				expect(new Set(rows.map((row) => row.status))).toEqual(
					new Set(["new", "waiting_on_us", "waiting_on_customer", "on_hold", "closed"]),
				)
			}),
		))

	it("a reply under a follow-up that joined the issue lands on it", () =>
		run(
			Effect.gen(function* () {
				const { world, channel, linked, customer, say, issues } = yield* setup
				yield* say({ channelId: linked, authorId: customer, minutes: 0, content: "hi" })
				const followUp = yield* say({
					channelId: linked,
					authorId: customer,
					minutes: 1,
					content: "dashboard broken",
				})
				const thread = channel("thread", linked)
				yield* say({
					channelId: thread,
					authorId: world.member,
					minutes: 3,
					threadRootMessageId: followUp,
				})
				expect(issues()).toHaveLength(1)
				expect(issues()[0]).toMatchObject({ status: "waiting_on_customer", messageCount: 3 })
				expect(issues()[0]!.firstTeamReplyAt).not.toBeNull()
				// A redelivered follow-up is not counted twice.
				expect(
					ok(
						yield* world.call(
							"customers.issue.createFromMessage",
							{ channelId: linked, messageId: followUp },
							world.member,
						),
					).data.id,
				).toBe(issues()[0]!.id)
			}),
		))

	it("a delete delivered before the message's creation leaves nothing open", () =>
		run(
			Effect.gen(function* () {
				const { world, toOrg, linked, customer, issues } = yield* setup
				const messageId = uuid() as MessageId
				yield* toOrg.applyEffect({
					objectId: world.orgId,
					kind: "org.messageDeleted",
					payload: { channelId: linked, messageId },
					key: uuid(),
					sender: { kind: "worker" },
				})
				yield* toOrg.applyEffect({
					objectId: world.orgId,
					kind: "org.messageCreated",
					payload: {
						channelId: linked,
						messageId,
						authorId: customer,
						mentionedUserIds: [],
						notifyAll: false,
						replyToAuthorId: null,
						content: "gone already",
						createdAt: T0.toISOString(),
						threadRootMessageId: null,
					},
					key: uuid(),
					sender: { kind: "worker" },
				})
				expect(issues()).toEqual([])
			}),
		))

	it("deleting the root keeps an issue whose thread has a conversation", () =>
		run(
			Effect.gen(function* () {
				const { world, toOrg, channel, linked, customer, say, issues } = yield* setup
				const root = yield* say({ channelId: linked, authorId: customer, minutes: 0 })
				yield* say({
					channelId: channel("thread", linked),
					authorId: world.member,
					minutes: 2,
					threadRootMessageId: root,
				})
				yield* toOrg.applyEffect({
					objectId: world.orgId,
					kind: "org.messageDeleted",
					payload: { channelId: linked, messageId: root },
					key: uuid(),
					sender: { kind: "worker" },
				})
				expect(issues()).toHaveLength(1)
			}),
		))

	it("creates an issue by hand on a Connect guest org's mount, asking the host channel", () =>
		run(
			Effect.gen(function* () {
				const { world, linked } = yield* setup
				const hostChannelId = uuid() as ChannelId
				yield* Directory.use((directory) =>
					directory.upsertChannel({
						channelId: linked as ChannelId,
						organizationId: world.orgId,
						hostChannelId,
						deletedAt: null,
					}),
				).pipe(Effect.provide(world.objects.directory))
				const host = yield* world.objects.get(channelTarget(hostChannelId))
				const messageId = uuid()
				host.storage.db
					.prepare(`INSERT INTO messages (id, channelId, authorId, content) VALUES (?, ?, ?, ?)`)
					.run(messageId, hostChannelId, world.member, "Shared channel: export broken")
				host.storage.db
					.prepare(
						`INSERT INTO channel_viewers (userId, organizationId, role) VALUES (?, ?, 'member')`,
					)
					.run(world.member, world.orgId)
				const created = ok(
					yield* world.call(
						"customers.issue.createFromMessage",
						{ channelId: linked, messageId },
						world.member,
					),
				).data
				expect(created).toMatchObject({
					sourceChannelId: linked,
					title: "Shared channel: export broken",
				})
			}),
		))
})
