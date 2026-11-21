/**
 * Email support inboxes end to end on the in-memory objects (`docs/customers/email.md`): a mailbox
 * is made by RPC, raw emails come in through the inbound handler, conversations become messages
 * and threads, and team replies in a conversation's thread go out (to the recording provider).
 */
import { CreateThreadRequest } from "@hazel/domain/rpc"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { ObjectStubs } from "../../worker/objects/protocol"
import { makeTestObjects, type TestObject } from "../../worker/objects/testing"
import { callRpc, ok, rows, runScoped } from "../chat-sync/testing-world"
import { DEFAULT_INBOUND_EMAIL_DOMAIN } from "./config"
import { type InboundEmailOutcome, receiveInboundEmail } from "./inbound"

const uuid = () => crypto.randomUUID()

/** A raw RFC 5322 message. */
const rawEmail = (input: {
	readonly from: string
	readonly to: string
	readonly subject: string
	readonly messageId: string
	readonly body: string
	readonly inReplyTo?: string
	readonly references?: string
	readonly headers?: ReadonlyArray<string>
}) =>
	[
		`From: ${input.from}`,
		`To: ${input.to}`,
		`Subject: ${input.subject}`,
		`Message-ID: <${input.messageId}>`,
		"Date: Mon, 15 Jun 2026 12:00:00 +0000",
		...(input.inReplyTo === undefined ? [] : [`In-Reply-To: <${input.inReplyTo}>`]),
		...(input.references === undefined ? [] : [`References: ${input.references}`]),
		...(input.headers ?? []),
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="utf-8"',
		"",
		input.body,
		"",
	].join("\r\n")

const makeInbox = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const owner = uuid() as UserId
	const org = yield* objects.get(orgTarget(orgId))
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	db.prepare(
		`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Olive', 'Owner')`,
	).run(owner, `ext-${owner}`, `${owner}@example.com`)
	db.prepare(`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, 'owner')`).run(
		orgId,
		owner,
	)
	const created = (yield* ok(
		yield* callRpc(
			org,
			orgId,
			"channel.create",
			{
				name: "support",
				icon: null,
				type: "public",
				organizationId: orgId,
				parentChannelId: null,
				sectionId: null,
			},
			owner,
		),
	)) as { data: { id: ChannelId } }
	const channelId = created.data.id
	const mailbox = (yield* ok(
		yield* callRpc(
			org,
			orgId,
			"chatSync.email.create",
			{
				organizationId: orgId,
				displayName: "Acme Support",
				supportAddress: "Support@Acme.com",
				hazelChannelId: channelId,
			},
			owner,
		),
	)) as {
		connection: { externalWorkspaceId: string; metadata: unknown }
		link: { settings: Record<string, unknown> }
		inboundAddress: string
	}
	const mailboxId = mailbox.connection.externalWorkspaceId
	const channel = yield* objects.get(channelTarget(channelId))

	const rejected: Array<string> = []
	/** Hands a raw email to the inbound handler as Email Routing would. */
	const receive = (raw: string, to: string = mailbox.inboundAddress) =>
		receiveInboundEmail({
			to,
			rawSize: raw.length,
			raw: () => Promise.resolve(new TextEncoder().encode(raw).buffer as ArrayBuffer),
			setReject: (reason) => void rejected.push(reason),
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(ObjectStubs, objects.stubs),
					ConfigProvider.layer(ConfigProvider.fromUnknown({})),
				),
			),
			Effect.provideContext(objects.directory),
			Effect.orDie,
		) as Effect.Effect<InboundEmailOutcome>

	const directoryRows = <T extends object>(sql: string, ...params: Array<string>) =>
		Effect.orDie(objects.directorySql.unsafe<T>(sql, params))

	const nameOf = (userId: string) =>
		rows<{ firstName: string }>(org, `SELECT firstName FROM users WHERE id = ?`, userId)[0]?.firstName ??
		userId

	/** The channel as a reader sees it; each thread's messages indented under its root. */
	const transcript = Effect.gen(function* () {
		const lines: Array<string> = []
		const linesOf = (object: TestObject, indent: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				const messages = rows<{ authorId: string; content: string; threadChannelId: string | null }>(
					object,
					`SELECT authorId, content, threadChannelId FROM messages WHERE deletedAt IS NULL ORDER BY createdAt, rowid`,
				)
				for (const message of messages) {
					lines.push(`${indent}${nameOf(message.authorId)}: ${message.content.replace(/\n/g, "⏎")}`)
					if (message.threadChannelId !== null) {
						const [thread] = rows<{ name: string }>(
							org,
							`SELECT name FROM channels WHERE id = ?`,
							message.threadChannelId,
						)
						lines.push(`${indent}  thread "${thread?.name ?? "?"}":`)
						yield* linesOf(
							yield* objects.get(channelTarget(message.threadChannelId as ChannelId)),
							`${indent}    `,
						)
					}
				}
			})
		yield* linesOf(channel, "")
		return lines
	})

	const post = (object: TestObject, objectId: string, content: string) =>
		Effect.gen(function* () {
			const sent = (yield* ok(
				yield* callRpc(
					object,
					objectId,
					"message.create",
					{
						channelId: objectId,
						content,
						embeds: null,
						replyToMessageId: null,
						threadChannelId: null,
						authorId: owner,
						deletedAt: null,
					},
					owner,
				),
			)) as { data: { id: MessageId } }
			return sent.data.id
		})

	return {
		objects,
		org,
		orgId,
		owner,
		channel,
		channelId,
		mailbox,
		mailboxId,
		rejected,
		receive,
		transcript,
		post,
		directoryRows,
		/** Runs the org's and the channel's pending outbox deliveries. */
		settle: Effect.gen(function* () {
			yield* org.alarm
			yield* channel.alarm
		}),
	}
})

const run = runScoped

describe("email support inboxes", () => {
	it("makes a mailbox: a server-picked inbound address, linked to the channel with its settings", () =>
		run(
			Effect.gen(function* () {
				const inbox = yield* makeInbox
				expect(inbox.mailboxId).toMatch(/^[a-z0-9]{16}$/)
				expect(inbox.mailbox.inboundAddress).toBe(
					`${inbox.mailboxId}@${DEFAULT_INBOUND_EMAIL_DOMAIN}`,
				)
				expect(inbox.mailbox.connection.metadata).toEqual({
					inboundAddress: inbox.mailbox.inboundAddress,
				})
				expect(inbox.mailbox.link.settings.email).toEqual({
					displayName: "Acme Support",
					replyTo: "support@acme.com",
				})
				// A client cannot pick a mailbox id through the generic connection RPC.
				const exit = yield* callRpc(
					inbox.org,
					inbox.orgId,
					"chatSync.connection.create",
					{
						organizationId: inbox.orgId,
						provider: "email",
						externalWorkspaceId: "victimmailbox0001",
					},
					inbox.owner,
				)
				expect(exit._tag).toBe("Failure")
			}),
		))

	it("turns a new email into a message and its replies into the conversation's thread", () =>
		run(
			Effect.gen(function* () {
				const inbox = yield* makeInbox
				const outcome = yield* inbox.receive(
					rawEmail({
						from: "Ana Lopez <Ana@Customer.dev>",
						to: "support@acme.com",
						subject: "Exports are failing",
						messageId: "root-1@customer.dev",
						body: "Our CSV export has been failing since this morning.",
					}),
				)
				expect(outcome).toBe("routed")
				yield* inbox.settle
				// The customer answers the team's email (whose id Hazel recorded), quoting it.
				yield* inbox.receive(
					rawEmail({
						from: "Ana Lopez <ana@customer.dev>",
						to: inbox.mailbox.inboundAddress,
						subject: "Re: Exports are failing",
						messageId: "reply-2@customer.dev",
						inReplyTo: "root-1@customer.dev",
						references: "<root-1@customer.dev>",
						body: [
							"It works again, thanks!",
							"",
							"On Mon, Jun 15, 2026 at 12:00 PM Acme Support <support@acme.com> wrote:",
							"> Our CSV export has been failing since this morning.",
						].join("\r\n"),
					}),
				)
				yield* inbox.settle
				expect(yield* inbox.transcript).toEqual([
					"Ana Lopez: **Exports are failing**⏎⏎Our CSV export has been failing since this morning.",
					'  thread "Exports are failing":',
					"    Ana Lopez: It works again, thanks!",
				])
				// The same email delivered again lands once.
				yield* inbox.receive(
					rawEmail({
						from: "ana@customer.dev",
						to: inbox.mailbox.inboundAddress,
						subject: "Re: Exports are failing",
						messageId: "reply-2@customer.dev",
						inReplyTo: "root-1@customer.dev",
						body: "It works again, thanks!",
					}),
				)
				yield* inbox.settle
				expect(yield* inbox.transcript).toHaveLength(3)
				const [thread] = yield* inbox.directoryRows<{ participants: string; referenceIds: string }>(
					`SELECT participants, referenceIds FROM email_threads WHERE mailboxId = ?`,
					inbox.mailboxId,
				)
				expect(JSON.parse(thread!.participants)).toEqual([
					{ address: "ana@customer.dev", name: "Ana Lopez" },
					{ address: "support@acme.com", name: null },
				])
				expect(JSON.parse(thread!.referenceIds)).toEqual([
					"root-1@customer.dev",
					"reply-2@customer.dev",
				])
			}),
		))

	it("bounces mail for an unknown mailbox and drops automatic mail and loops", () =>
		run(
			Effect.gen(function* () {
				const inbox = yield* makeInbox
				const mail = (overrides: Partial<Parameters<typeof rawEmail>[0]>) =>
					rawEmail({
						from: "ana@customer.dev",
						to: inbox.mailbox.inboundAddress,
						subject: "Hello",
						messageId: `${uuid()}@customer.dev`,
						body: "Hi",
						...overrides,
					})
				expect(
					yield* inbox.receive(mail({}), `zzzzzzzzzzzzzzzz@${DEFAULT_INBOUND_EMAIL_DOMAIN}`),
				).toBe("rejected_unknown_mailbox")
				expect(yield* inbox.receive(mail({}), `${inbox.mailboxId}@elsewhere.dev`)).toBe(
					"rejected_address",
				)
				expect(inbox.rejected).toEqual(["No such mailbox", "No such mailbox"])
				expect(
					yield* inbox.receive(
						mail({ headers: ["Auto-Submitted: auto-replied"], subject: "Out of office" }),
					),
				).toBe("dropped_automatic")
				expect(yield* inbox.receive(mail({ from: `${inbox.mailboxId}@mail.hazel.sh` }))).toBe(
					"dropped_loop",
				)
				// A plus-tagged address is the same mailbox.
				expect(
					yield* inbox.receive(
						mail({}),
						`${inbox.mailboxId}+billing@${DEFAULT_INBOUND_EMAIL_DOMAIN}`,
					),
				).toBe("routed")
				yield* inbox.settle
				expect(yield* inbox.transcript).toEqual(["ana@customer.dev: **Hello**⏎⏎Hi"])
			}),
		))

	it("sends only replies in a conversation's thread, even one written before the thread was linked", () =>
		run(
			Effect.gen(function* () {
				const inbox = yield* makeInbox
				yield* inbox.receive(
					rawEmail({
						from: "Ana Lopez <ana@customer.dev>",
						to: "support@acme.com",
						subject: "Exports are failing",
						messageId: "root-1@customer.dev",
						body: "Help",
					}),
				)
				yield* inbox.settle
				const root = rows<{ id: MessageId }>(inbox.channel, `SELECT id FROM messages`)[0]!.id
				// A team note at the top level of the inbox stays in Hazel.
				yield* inbox.post(inbox.channel, inbox.channelId, "Internal: who owns exports?")
				expect(inbox.objects.chatSyncCalls).toEqual([])

				// The team opens a thread on the email and answers at once, before the link arrives.
				const threadId = crypto.randomUUID() as ChannelId
				yield* ok(
					yield* callRpc(
						inbox.org,
						inbox.orgId,
						"channel.createThread",
						new CreateThreadRequest({
							id: threadId,
							messageId: root,
							organizationId: inbox.orgId,
							channelId: inbox.channelId,
						}),
						inbox.owner,
					),
				)
				const thread = yield* inbox.objects.get(channelTarget(threadId))
				yield* inbox.post(thread, threadId, "Looking into it now.")
				// The parent's outbox links the thread; the thread then sends what it holds.
				yield* inbox.channel.alarm
				yield* inbox.org.alarm
				yield* thread.alarm
				expect(inbox.objects.chatSyncCalls).toEqual([
					{
						op: "createThread",
						externalChannelId: inbox.mailboxId,
						externalMessageId: "root-1@customer.dev",
						content: "Exports are failing",
					},
					{
						op: "createMessage",
						externalChannelId: `${inbox.mailboxId}/root-1@customer.dev`,
						content: "Looking into it now.",
					},
				])
				// A later reply goes straight out.
				yield* inbox.post(thread, threadId, "Fixed.")
				expect(inbox.objects.chatSyncCalls.at(-1)).toEqual({
					op: "createMessage",
					externalChannelId: `${inbox.mailboxId}/root-1@customer.dev`,
					content: "Fixed.",
				})
			}),
		))
})
