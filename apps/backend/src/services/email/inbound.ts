/**
 * Email → Hazel (`docs/customers/email.md` § Inbound). Cloudflare Email Routing hands the api Worker
 * each message to `<mailbox>[+tag]@<INBOUND_EMAIL_DOMAIN>`; this finds the mailbox's org, places the
 * email in its conversation (`threads.ts`), and routes it like any chat-sync event
 * (`routeChatSyncInbound`): a new conversation is a top-level message of the mailbox's channel, a
 * reply goes in that message's thread.
 *
 * A failure past the mailbox check propagates: Cloudflare answers a temporary SMTP error and the
 * sender retries (the dedupe key makes the retry land once). What can never succeed is rejected
 * (a bounce) or dropped.
 */
import { Email } from "@hazel/integrations"
import { ExternalChannelId, ExternalMessageId, ExternalThreadId, ExternalUserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { indexedLinks } from "../chat-sync/chat-sync-index"
import { routeChatSyncInbound } from "../chat-sync/chat-sync-inbound"
import { MAILBOX_ID_PATTERN } from "../chat-sync/providers/email/definition"
import { EmailDomainsConfig } from "./config"
import { conversationRootOf, type EmailParticipant, recordThreadMessage, upsertThread } from "./threads"

/** Larger messages are bounced. */
export const MAX_INBOUND_EMAIL_BYTES = 10 * 1024 * 1024
/** A message's text in Hazel is cut here. */
export const MAX_INBOUND_TEXT = 20_000

/** What the handler reads of Cloudflare's `ForwardableEmailMessage`. */
export interface InboundEmailMessage {
	/** Envelope recipient. */
	readonly to: string
	readonly rawSize: number
	readonly raw: () => Promise<ArrayBuffer>
	readonly setReject: (reason: string) => void
}

export type InboundEmailOutcome =
	| "rejected_address"
	| "rejected_size"
	| "rejected_unknown_mailbox"
	| "rejected_malformed"
	| "dropped_automatic"
	| "dropped_no_sender"
	| "dropped_loop"
	| "routed"

/** The mailbox a recipient names: the local part before any `+tag`, on the inbound domain. */
export const mailboxOfRecipient = (recipient: string, inboundDomain: string): string | null => {
	const address = recipient.trim().toLowerCase()
	const at = address.lastIndexOf("@")
	if (at <= 0 || address.slice(at + 1) !== inboundDomain.toLowerCase()) return null
	const mailboxId = address.slice(0, at).split("+")[0] ?? ""
	return MAILBOX_ID_PATTERN.test(mailboxId) ? mailboxId : null
}

/** The message as Hazel shows it: a new conversation opens with its subject. */
export const inboundContentOf = (email: {
	readonly subject: string
	readonly text: string
	readonly attachments: ReadonlyArray<{ readonly filename: string }>
	readonly isReply: boolean
}) => {
	const body = Email.stripQuotedReply(email.text).trim()
	const clipped =
		body.length > MAX_INBOUND_TEXT ? `${body.slice(0, MAX_INBOUND_TEXT).trimEnd()}\n\n…` : body
	const files =
		email.attachments.length === 0
			? null
			: `_Attachments not imported: ${email.attachments.map((file) => file.filename || "unnamed").join(", ")}_`
	const parts = [
		email.isReply ? null : `**${email.subject.replace(/\*/g, "\\*")}**`,
		clipped.length > 0 ? clipped : null,
		files,
	].filter((part): part is string => part !== null)
	return parts.length === 0 ? "_(empty email)_" : parts.join("\n\n")
}

/** A conversation's Hazel thread name: its subject without reply and forward prefixes. */
export const threadNameOf = (subject: string) =>
	subject.replace(/^(\s*(re|fwd?|aw|sv|wg|tr)(\[\d+\])?\s*:\s*)+/i, "").trim() || "(no subject)"

export const receiveInboundEmail = Effect.fn("Email.receiveInbound")(function* (
	message: InboundEmailMessage,
) {
	const outcome = (value: InboundEmailOutcome) =>
		Effect.as(Effect.annotateCurrentSpan({ "email.outcome": value }), value)
	const reject = (value: InboundEmailOutcome, reason: string) =>
		Effect.andThen(
			Effect.sync(() => message.setReject(reason)),
			outcome(value),
		)

	const domains = yield* EmailDomainsConfig
	const mailboxId = mailboxOfRecipient(message.to, domains.inbound)
	if (mailboxId === null) return yield* reject("rejected_address", "No such mailbox")
	yield* Effect.annotateCurrentSpan({ "email.mailbox_id": mailboxId, "email.bytes": message.rawSize })
	if (message.rawSize > MAX_INBOUND_EMAIL_BYTES) return yield* reject("rejected_size", "Message too large")

	const links = yield* indexedLinks("email", ExternalChannelId.make(mailboxId), [mailboxId])
	const owner = links[0]
	if (owner === undefined) return yield* reject("rejected_unknown_mailbox", "No such mailbox")

	const raw = yield* Effect.promise(message.raw)
	const parsed = yield* Effect.tryPromise(() => Email.parseEmail(raw)).pipe(Effect.option)
	if (Option.isNone(parsed)) return yield* reject("rejected_malformed", "Malformed message")
	const email = parsed.value
	if (email.automatic) return yield* outcome("dropped_automatic")
	if (email.from === null) return yield* outcome("dropped_no_sender")
	const fromDomain = Email.domainOf(email.from.address)
	const ownDomains = new Set([domains.inbound.toLowerCase(), domains.sending.toLowerCase()])
	if (fromDomain !== null && ownDomains.has(fromDomain)) return yield* outcome("dropped_loop")

	// In-Reply-To first, then References newest first: the closest known message names the conversation.
	const root = yield* conversationRootOf(mailboxId, [
		...email.inReplyTo,
		...[...email.references].reverse(),
	])
	const rootMessageId = Option.getOrElse(root, () => email.messageId)
	const isReply = rootMessageId !== email.messageId
	const subject = email.subject.trim() || "(no subject)"
	const participants: ReadonlyArray<EmailParticipant> = [
		email.from,
		...email.replyTo,
		...email.to,
		...email.cc,
	]
		.map((address) => ({ address: address.address, name: address.name }))
		.filter((participant) => {
			const domain = Email.domainOf(participant.address)
			return domain !== null && !ownDomains.has(domain)
		})

	yield* recordThreadMessage({ mailboxId, messageId: email.messageId, rootMessageId, direction: "inbound" })
	yield* upsertThread({
		mailboxId,
		rootMessageId,
		organizationId: owner.organizationId,
		subject,
		messageId: email.messageId,
		references: [...email.references, ...email.inReplyTo],
		participants,
	})
	yield* Effect.annotateCurrentSpan({ "email.is_reply": isReply })

	yield* routeChatSyncInbound({
		provider: "email",
		externalChannelId: ExternalChannelId.make(mailboxId),
		externalWorkspaceIds: [mailboxId],
		dedupeKey: `email:${mailboxId}:${email.messageId}`,
		author: {
			externalUserId: ExternalUserId.make(email.from.address),
			displayName: email.from.name?.trim() || email.from.address,
			avatarUrl: null,
			email: email.from.address,
			externalWorkspaceId: fromDomain,
		},
		event: {
			_tag: "MessageCreate",
			externalMessageId: ExternalMessageId.make(email.messageId),
			externalWebhookId: null,
			content: inboundContentOf({ ...email, subject, isReply }),
			externalReplyToMessageId: null,
			attachments: [],
			// A reply goes in its conversation's thread, named by the subject.
			inExternalThreadId: isReply ? ExternalThreadId.make(rootMessageId) : undefined,
			externalThreadName: isReply ? threadNameOf(subject) : undefined,
		},
	})
	return yield* outcome("routed")
})
