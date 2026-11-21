/**
 * Email's chat-sync facts (`docs/customers/email.md`). A connection is a support mailbox, its one
 * channel link is keyed by the mailbox id, and a conversation's replies are a thread keyed
 * `<mailbox>/<root Message-ID>` (`emailTarget` takes such an id apart). Email has no mentions,
 * reactions or edits, and nothing to post at the top level of a channel.
 */
import type { ChatSyncProviderDefinition } from "../../provider"

/** A link's external channel id as its mailbox and, for a conversation's thread, its root message. */
export const emailTarget = (externalChannelId: string) => {
	const slash = externalChannelId.indexOf("/")
	return slash === -1
		? { mailboxId: externalChannelId, rootMessageId: undefined }
		: {
				mailboxId: externalChannelId.slice(0, slash),
				rootMessageId: externalChannelId.slice(slash + 1) || undefined,
			}
}

/** A mailbox id: what the inbound address's local part names (`<mailbox>@<INBOUND_EMAIL_DOMAIN>`). */
export const MAILBOX_ID_PATTERN = /^[a-z0-9]{16}$/

/** A new mailbox id: 16 characters of `[a-z0-9]`, from 80 random bits. */
export const newMailboxId = () => {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

export const email: ChatSyncProviderDefinition = {
	id: "email",
	displayName: "Email",
	threadsOnly: true,
	workspaceIsInstall: false,
	// Nothing in email limits a body this short; it keeps one message within Hazel's own.
	maxMessageLength: 100_000,
	maxThreadNameLength: 100,
	threadChannelId: (parent, rootMessageId) => `${emailTarget(parent).mailboxId}/${rootMessageId}`,
	// An email names nobody by id: a Hazel mention goes out as `@Name`.
	mention: (externalUserId) => externalUserId,
	mentionPattern: /(?!)/g,
	emojiToProvider: (emoji) => emoji,
	emojiFromProvider: (emoji) => emoji,
	// Hazel's own replies never come back through the mailbox (the inbound handler drops its domain).
	isOwnEcho: () => false,
	// A mailbox starts empty: there is no history to import.
	history: { maxMessages: 0, pageSize: 1, pageDelayMs: 0 },
}
