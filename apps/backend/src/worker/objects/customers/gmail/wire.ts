/**
 * What Hazel sends to Google and what it reads back: the OAuth endpoints (consent, token) and the
 * three Gmail API reads the integration makes (`users.getProfile`, `users.messages.list`,
 * `users.messages.get` with `format=full`). Only the fields Hazel reads are declared; Google adds
 * fields freely, which decoding ignores.
 */
import { Schema } from "effect"

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GMAIL_API_URL = "https://gmail.googleapis.com"

/** Read-only access to the mailbox: messages and their bodies, nothing else. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

export const PROFILE_PATH = "/gmail/v1/users/me/profile"
export const MESSAGES_PATH = "/gmail/v1/users/me/messages"

const optional = Schema.optionalKey

/** `POST /token`'s answer, to an authorization code or a refresh token. */
export const TokenResponse = Schema.Struct({
	access_token: Schema.String,
	/** Seconds. */
	expires_in: Schema.Number,
	/** Only on the code exchange (with `access_type=offline`). */
	refresh_token: optional(Schema.String),
	/** Space-separated: what the person granted, which can be less than asked. */
	scope: optional(Schema.String),
})
export type TokenResponse = typeof TokenResponse.Type

/** `POST /token`'s refusal: `invalid_grant` is a refresh token revoked or expired. */
export const TokenError = Schema.Struct({
	error: Schema.String,
	error_description: optional(Schema.String),
})

export const Profile = Schema.Struct({ emailAddress: Schema.String })

export const MessageList = Schema.Struct({
	messages: optional(Schema.Array(Schema.Struct({ id: Schema.String, threadId: Schema.String }))),
	nextPageToken: optional(Schema.String),
	resultSizeEstimate: optional(Schema.Number),
})
export type MessageList = typeof MessageList.Type

export interface MessagePart {
	readonly mimeType?: string
	readonly filename?: string
	readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>
	/** `data` is base64url; a part too large to inline names an `attachmentId` instead. */
	readonly body?: { readonly data?: string; readonly attachmentId?: string; readonly size?: number }
	readonly parts?: ReadonlyArray<MessagePart>
}

export const MessagePart: Schema.Codec<MessagePart> = Schema.Struct({
	mimeType: optional(Schema.String),
	filename: optional(Schema.String),
	headers: optional(Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))),
	body: optional(
		Schema.Struct({
			data: optional(Schema.String),
			attachmentId: optional(Schema.String),
			size: optional(Schema.Number),
		}),
	),
	parts: optional(Schema.Array(Schema.suspend((): Schema.Codec<MessagePart> => MessagePart))),
})

/** One message, `format=full`. */
export const Message = Schema.Struct({
	id: Schema.String,
	threadId: Schema.String,
	labelIds: optional(Schema.Array(Schema.String)),
	snippet: optional(Schema.String),
	/** Milliseconds since the epoch, as a string: when Gmail received (or sent) it. */
	internalDate: Schema.String,
	payload: optional(MessagePart),
})
export type Message = typeof Message.Type

/** Google's API error body: `{ error: { code, message, status, errors: [{ reason }] } }`. */
export const GoogleErrorBody = Schema.Struct({
	error: optional(
		Schema.Struct({
			message: optional(Schema.String),
			errors: optional(Schema.Array(Schema.Struct({ reason: optional(Schema.String) }))),
		}),
	),
})

export const detailOf = ({ error }: typeof GoogleErrorBody.Type): string => {
	const reason = error?.errors?.[0]?.reason
	const message = error?.message?.trim() ?? ""
	return reason === undefined ? message : `${message} (${reason})`
}

/**
 * The thread in Gmail's web app, signed in as `mailbox` (`/mail/u/<address>/` picks the account
 * whatever its index in the browser), so whoever opens it sees it only if they hold that mailbox.
 */
export const threadUrl = (mailbox: string, threadId: string): string =>
	`https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${encodeURIComponent(threadId)}`
