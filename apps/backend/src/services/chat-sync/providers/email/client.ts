/**
 * Email's chat-sync client (`docs/customers/email.md`): a team reply in a conversation's thread is
 * sent to the conversation's participants, in the customer's email thread (`In-Reply-To`,
 * `References`), from the mailbox's sending address. The conversation's state is the directory's
 * (`services/email/threads.ts`), written by the inbound handler. Edits, deletes and reactions
 * cannot reach a sent email; there is no history to read.
 */
import { EmailMailboxSettings } from "@hazel/domain/rpc"
import { Email } from "@hazel/integrations"
import { ExternalMessageId, ExternalThreadId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { EmailDomainsConfig, inboundAddressOf, sendingAddressOf } from "../../../email/config"
import { Directory } from "../../../directory"
import { EmailSender } from "../../../email/sender"
import { recordThreadMessage, threadOf, upsertThread } from "../../../email/threads"
import {
	type ChatSyncClient,
	ChatSyncProviderApiError,
	ChatSyncProviderConfigurationError,
} from "../../provider"
import { emailTarget } from "./definition"

const apiError = (message: string, status?: number, detail?: string) =>
	new ChatSyncProviderApiError({ provider: "email", message, status, detail })

const decodeSettings = Schema.decodeUnknownOption(EmailMailboxSettings)

/** The mailbox's sender name and `Reply-To`, from its link's `settings.email`. */
export const emailSettingsOf = (settings: Record<string, unknown> | null) =>
	Option.getOrElse(decodeSettings(settings?.email), () => ({ displayName: "Support", replyTo: null }))

/** "Alice from Acme Support"; the mailbox's name alone when the author has none. */
export const senderNameOf = (authorName: string, displayName: string) => {
	const name = authorName.replace(/[\r\n"<>]/g, " ").trim()
	return name.length === 0 ? displayName : `${name} from ${displayName}`
}

/** A Hazel-made `Message-ID`, when the provider does not report the one it sent. */
const localMessageId = (domain: string) => `hazel-${crypto.randomUUID()}@${domain}`

export const makeEmailClient = Effect.gen(function* () {
	const sender = yield* EmailSender
	const domains = yield* EmailDomainsConfig
	const directory = yield* Directory

	const noop = () => Effect.void

	const client: ChatSyncClient = {
		prepareLink: noop,
		postMessage: (context, message) =>
			Effect.gen(function* () {
				const { mailboxId, rootMessageId } = emailTarget(context.link.externalChannelId)
				if (rootMessageId === undefined) {
					return yield* new ChatSyncProviderConfigurationError({
						provider: "email",
						message: "Only replies in an email conversation's thread are sent",
					})
				}
				const thread = yield* threadOf(mailboxId, rootMessageId).pipe(
					Effect.mapError((error) => apiError(error.message)),
				)
				if (Option.isNone(thread)) {
					return yield* apiError("The email conversation is unknown", 404, "unknown_conversation")
				}
				const settings = emailSettingsOf(context.link.settings)
				const inbound = inboundAddressOf(domains, mailboxId)
				const sending = sendingAddressOf(domains, mailboxId)
				const own = new Set([inbound, sending, settings.replyTo?.toLowerCase()].filter(Boolean))
				const to = thread.value.participants
					.map((participant) => participant.address)
					.filter((address) => !own.has(address) && !address.endsWith(`@${domains.inbound}`))
				if (to.length === 0) {
					return yield* apiError(
						"The email conversation has no one to reply to",
						422,
						"no_recipients",
					)
				}
				const references = thread.value.referenceIds
				const { text, html } = Email.renderOutboundEmail({
					content: message.content,
					attachments: message.attachments.map((file) => ({
						fileName: file.fileName,
						url: file.publicUrl,
					})),
				})
				const sent = yield* sender
					.send({
						from: {
							email: sending,
							name: senderNameOf(message.author.name, settings.displayName),
						},
						to,
						replyTo: settings.replyTo ?? inbound,
						subject: Email.replySubject(thread.value.subject),
						text,
						html,
						headers: {
							"In-Reply-To": Email.formatMessageId(thread.value.lastMessageId),
							References: references.map(Email.formatMessageId).join(" "),
						},
					})
					// A send that failed may be retried: the provider took nothing.
					.pipe(Effect.mapError((error) => apiError(error.message)))
				const messageId =
					(sent.messageId === null ? null : Email.normalizeMessageId(sent.messageId)) ??
					localMessageId(domains.sending)
				yield* Effect.annotateCurrentSpan({ "email.recipients": to.length })
				// The mail is out: recording it may fail without sending it twice.
				yield* Effect.all(
					[
						recordThreadMessage({ mailboxId, messageId, rootMessageId, direction: "outbound" }),
						upsertThread({
							mailboxId,
							rootMessageId,
							organizationId: context.link.organizationId,
							subject: thread.value.subject,
							messageId,
							references: [],
							participants: [],
						}),
					],
					{ discard: true },
				).pipe(
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.logWarning("Sent email not recorded on its conversation", {
								reason: error.message,
							}),
					}),
				)
				return ExternalMessageId.make(messageId)
			}).pipe(Effect.provideService(Directory, directory)),
		updateMessage: noop,
		deleteMessage: noop,
		addReaction: noop,
		removeReaction: noop,
		// A conversation's thread is keyed by its root, which is the message's own id.
		createThread: (_context, thread) => Effect.succeed(ExternalThreadId.make(thread.externalMessageId)),
		fetchHistory: () => Effect.succeed({ messages: [], cursor: null }),
	}
	return client
})
