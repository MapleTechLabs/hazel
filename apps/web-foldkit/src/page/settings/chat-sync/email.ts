import { EmailMailboxDisplayName, SupportEmailAddress } from "@hazel/domain/rpc"
import { ChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Render } from "foldkit"
import { catchCommon } from "../../../data/actions"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { HazelRpc } from "../../../rpc"
import { type EmailForm, type EmailInboxFailure, Message } from "./model"
import { emailInboxOf } from "./rpc"

/** The Email support inbox section: an inbox's form rules and its server calls (`docs/customers/email.md`). */

export const EMAIL_MODAL_ID = "chat-sync-email-inbox"
export const EMAIL_NAME_ID = `${EMAIL_MODAL_ID}-name`
export const EMAIL_SUPPORT_ADDRESS_ID = `${EMAIL_MODAL_ID}-support-address`
export const EMAIL_CHANNEL_SEARCH_ID = `${EMAIL_MODAL_ID}-channel-search`
export const EMAIL_INBOUND_ADDRESS_ID = `${EMAIL_MODAL_ID}-inbound-address`
export const NAME_MAX_LENGTH = 80

const isDisplayName = Schema.is(EmailMailboxDisplayName)
const isSupportAddress = Schema.is(SupportEmailAddress)

/** Why the name is refused, or null. */
export const nameError = (name: string): string | null => {
	const trimmed = name.trim()
	if (trimmed.length === 0) return "Enter a name for the inbox."
	if (trimmed.length > NAME_MAX_LENGTH) return `Use ${NAME_MAX_LENGTH} characters or fewer.`
	return isDisplayName(trimmed) ? null : "Enter a name for the inbox."
}

/** Why the support address is refused, or null (it is optional). */
export const supportAddressError = (address: string): string | null => {
	const trimmed = address.trim()
	return trimmed.length === 0 || isSupportAddress(trimmed)
		? null
		: "Enter an email address, like support@acme.com."
}

/** Whether the form can be sent: a name, a valid address or none, and (for a new inbox) a channel. */
export const isEmailFormValid = (form: EmailForm): boolean =>
	nameError(form.name) === null &&
	supportAddressError(form.supportAddress) === null &&
	(form.step._tag !== "Create" || form.channel !== null)

/** The trimmed support address, or null when left blank. */
export const supportAddressOf = (form: EmailForm): string | null => {
	const trimmed = form.supportAddress.trim()
	return trimmed.length === 0 ? null : trimmed
}

export const emailFailureMessage = (reason: EmailInboxFailure): UserErrorMessage =>
	failureMessage(reason, {
		ChannelNotFound: {
			title: "Channel not found",
			description: "Pick a public or private channel of this workspace.",
		},
		ChannelLinked: {
			title: "Channel already linked",
			description: "This channel already has an inbox. Pick another channel.",
		},
		NotFound: {
			title: "Inbox not found",
			description: "This inbox may have been removed.",
		},
	})

/** `chatSync.email.create`: answers the new inbox with its forwarding address. */
export const CreateEmailInbox = Command.define("CreateEmailInbox", {
	args: {
		organizationId: OrganizationId,
		displayName: Schema.String,
		supportAddress: Schema.NullOr(Schema.String),
		hazelChannelId: ChannelId,
	},
	messages: [Message.SucceededCreateEmailInbox, Message.FailedSaveEmailInbox],
	execute: ({ organizationId, displayName, supportAddress, hazelChannelId }) =>
		Effect.gen(function* () {
			yield* Render.afterCommit
			const client = yield* HazelRpc
			const payload = { organizationId, displayName, hazelChannelId }
			const response = yield* client(
				"chatSync.email.create",
				supportAddress === null ? payload : { ...payload, supportAddress },
			)
			return Message.SucceededCreateEmailInbox({
				inbox: emailInboxOf(response.connection, response.link, response.inboundAddress),
			})
		}).pipe(
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedSaveEmailInbox({ reason: "ChannelNotFound" })),
				ChatSyncChannelLinkExistsError: () =>
					Effect.succeed(Message.FailedSaveEmailInbox({ reason: "ChannelLinked" })),
			}),
			catchCommon((reason) => Message.FailedSaveEmailInbox({ reason })),
		),
})

/** `chatSync.email.update`: the name and the support address (`null` clears it). */
export const UpdateEmailInbox = Command.define("UpdateEmailInbox", {
	args: {
		organizationId: OrganizationId,
		syncConnectionId: SyncConnectionId,
		displayName: Schema.String,
		supportAddress: Schema.NullOr(Schema.String),
	},
	messages: [Message.SucceededUpdateEmailInbox, Message.FailedSaveEmailInbox],
	execute: (payload) =>
		Effect.gen(function* () {
			yield* Render.afterCommit
			const client = yield* HazelRpc
			yield* client("chatSync.email.update", payload)
			return Message.SucceededUpdateEmailInbox()
		}).pipe(
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(Message.FailedSaveEmailInbox({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedSaveEmailInbox({ reason })),
		),
})

/** Removing an inbox is removing its connection (`chatSync.connection.delete`). */
export const RemoveEmailInbox = Command.define("RemoveEmailInbox", {
	args: { organizationId: OrganizationId, syncConnectionId: SyncConnectionId },
	messages: [Message.SucceededRemoveEmailInbox, Message.FailedRemoveEmailInbox],
	execute: (payload) =>
		HazelRpc.use((rpc) => rpc("chatSync.connection.delete", payload)).pipe(
			Effect.as(Message.SucceededRemoveEmailInbox()),
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(Message.FailedRemoveEmailInbox({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedRemoveEmailInbox({ reason })),
		),
})

/** `navigator.clipboard.writeText` rejected (permission, insecure context). */
class ClipboardWriteError extends Schema.TaggedError<
	ClipboardWriteError,
	{ readonly brand: unique symbol }
>()("ClipboardWriteError", {}) {}

export const CopyInboundAddress = Command.define("CopyInboundAddress", {
	args: { address: Schema.String },
	messages: [Message.SucceededCopyInboundAddress, Message.FailedCopyInboundAddress],
	execute: ({ address }) =>
		Effect.tryPromise({
			try: () => navigator.clipboard.writeText(address),
			catch: () => new ClipboardWriteError(),
		}).pipe(
			Effect.as(Message.SucceededCopyInboundAddress()),
			Effect.catchTags({
				ClipboardWriteError: () => Effect.succeed(Message.FailedCopyInboundAddress()),
			}),
		),
})
