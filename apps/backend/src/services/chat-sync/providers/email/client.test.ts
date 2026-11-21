/**
 * Email's chat-sync client (`client.ts`) over an in-memory directory and a recording sender: who a
 * reply goes to, how it threads, and what it records for the customer's answer.
 */
import { layerMemory } from "@hazel/db/node"
import {
	ExternalChannelId,
	ExternalMessageId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
} from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { Directory } from "../../../directory"
import { EmailSender, type OutboundEmail } from "../../../email/sender"
import { conversationRootOf, threadOf, upsertThread } from "../../../email/threads"
import type { ChatSyncLinkContext } from "../../provider"
import { emailSettingsOf, makeEmailClient, senderNameOf } from "./client"

const MAILBOX = "abcdefgh12345678"
const ORG = OrganizationId.make(crypto.randomUUID())

const run = <A, E>(effect: Effect.Effect<A, E, Directory | Scope.Scope>) =>
	Effect.runPromise(
		Effect.scoped(
			effect.pipe(Effect.provide(Directory.layerDatabase.pipe(Layer.provide(layerMemory)))),
		) as Effect.Effect<A, E>,
	)

const contextOf = (externalChannelId: string, replyTo: string | null): ChatSyncLinkContext => ({
	link: {
		channelLinkId: SyncChannelLinkId.make(crypto.randomUUID()),
		syncConnectionId: SyncConnectionId.make(crypto.randomUUID()),
		organizationId: ORG,
		provider: "email",
		externalWorkspaceId: MAILBOX,
		externalChannelId: ExternalChannelId.make(externalChannelId),
		direction: "both",
		settings: { email: { displayName: "Acme Support", replyTo } },
		parent: {
			channelLinkId: SyncChannelLinkId.make(crypto.randomUUID()),
			externalChannelId: ExternalChannelId.make(MAILBOX),
		},
	},
	saveSettings: () => Effect.void,
})

const makeClient = (answer: { messageId: string | null } = { messageId: "<sent-1@mail.hazel.sh>" }) =>
	Effect.gen(function* () {
		const sent: Array<OutboundEmail> = []
		const client = yield* makeEmailClient.pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(EmailSender, {
						send: (email) => Effect.sync(() => (sent.push(email), answer)),
					}),
					ConfigProvider.layer(ConfigProvider.fromUnknown({})),
				),
			),
		)
		return { client, sent }
	})

const message = {
	content: "We shipped a fix. **Please retry.**",
	attachments: [],
	replyToExternalMessageId: undefined,
	author: { name: "Olive Owner", avatarUrl: null },
}

const seedConversation = upsertThread({
	mailboxId: MAILBOX,
	rootMessageId: "root-1@customer.dev",
	organizationId: ORG,
	subject: "Exports are failing",
	messageId: "root-1@customer.dev",
	references: [],
	participants: [
		{ address: "ana@customer.dev", name: "Ana" },
		{ address: "support@acme.com", name: null },
		{ address: "bob@customer.dev", name: "Bob" },
		{ address: `${MAILBOX}@inbound.hazel.sh`, name: null },
	],
})

describe("email chat-sync client", () => {
	it("replies to the conversation's people in its email thread, from the mailbox", () =>
		run(
			Effect.gen(function* () {
				yield* seedConversation
				const { client, sent } = yield* makeClient()
				const id = yield* client.postMessage(
					contextOf(`${MAILBOX}/root-1@customer.dev`, "support@acme.com"),
					message,
				)
				expect(id).toBe("sent-1@mail.hazel.sh")
				expect(sent).toHaveLength(1)
				expect(sent[0]).toMatchObject({
					from: { email: `${MAILBOX}@mail.hazel.sh`, name: "Olive Owner from Acme Support" },
					// The mailbox's own addresses (the support address, the inbound one) are not recipients.
					to: ["ana@customer.dev", "bob@customer.dev"],
					replyTo: "support@acme.com",
					subject: "Re: Exports are failing",
					headers: {
						"In-Reply-To": "<root-1@customer.dev>",
						References: "<root-1@customer.dev>",
					},
				})
				expect(sent[0]!.text).toContain("We shipped a fix.")
				expect(sent[0]!.html).toContain("<strong>Please retry.</strong>")

				// The customer's answer to the sent message finds the conversation, and the next
				// reply continues the chain.
				expect(Option.getOrNull(yield* conversationRootOf(MAILBOX, ["sent-1@mail.hazel.sh"]))).toBe(
					"root-1@customer.dev",
				)
				const thread = yield* threadOf(MAILBOX, "root-1@customer.dev")
				expect(thread._tag === "Some" && thread.value.lastMessageId).toBe("sent-1@mail.hazel.sh")
				expect(thread._tag === "Some" && thread.value.referenceIds).toEqual([
					"root-1@customer.dev",
					"sent-1@mail.hazel.sh",
				])
			}),
		))

	it("replies to the inbound address when the mailbox has no support address", () =>
		run(
			Effect.gen(function* () {
				yield* seedConversation
				const { client, sent } = yield* makeClient({ messageId: null })
				const id = yield* client.postMessage(
					contextOf(`${MAILBOX}/root-1@customer.dev`, null),
					message,
				)
				// Without an id from the provider, Hazel names the message itself.
				expect(id).toMatch(/^hazel-.+@mail\.hazel\.sh$/)
				expect(sent[0]!.replyTo).toBe(`${MAILBOX}@inbound.hazel.sh`)
				// The support address is a participant like any other when it is not the mailbox's.
				expect(sent[0]!.to).toEqual(["ana@customer.dev", "support@acme.com", "bob@customer.dev"])
			}),
		))

	it("refuses, without retrying, an unknown conversation or a top-level post", () =>
		run(
			Effect.gen(function* () {
				const { client, sent } = yield* makeClient()
				const unknown = yield* Effect.exit(
					client.postMessage(contextOf(`${MAILBOX}/nope@customer.dev`, null), message),
				)
				expect(Exit.isFailure(unknown) && JSON.stringify(unknown.cause)).toContain(
					"unknown_conversation",
				)
				const topLevel = yield* Effect.exit(client.postMessage(contextOf(MAILBOX, null), message))
				expect(Exit.isFailure(topLevel) && JSON.stringify(topLevel.cause)).toContain(
					"ChatSyncProviderConfigurationError",
				)
				expect(sent).toEqual([])
			}),
		))

	it("treats edits, deletes and reactions as no-ops and threads by the root's id", () =>
		run(
			Effect.gen(function* () {
				const { client, sent } = yield* makeClient()
				const context = contextOf(`${MAILBOX}/root-1@customer.dev`, null)
				const externalMessageId = ExternalMessageId.make("root-1@customer.dev")
				yield* client.updateMessage(context, { ...message, externalMessageId })
				yield* client.deleteMessage(context, { externalMessageId })
				yield* client.addReaction(context, { externalMessageId, emoji: "👍" })
				expect(sent).toEqual([])
				expect(yield* client.createThread(context, { externalMessageId, name: "x" })).toBe(
					"root-1@customer.dev",
				)
			}),
		))

	it("names the sender and reads the mailbox's settings", () => {
		expect(senderNameOf("Olive\r\nBcc: x", "Acme Support")).toBe("Olive  Bcc: x from Acme Support")
		expect(senderNameOf("  ", "Acme Support")).toBe("Acme Support")
		expect(emailSettingsOf(null)).toEqual({ displayName: "Support", replyTo: null })
	})
})
