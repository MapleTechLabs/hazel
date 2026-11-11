import { Option, Schema } from "effect"

// ---------------------------------------------------------------------------------------------
// Envelopes: what the Events API POSTs to the request URL
// ---------------------------------------------------------------------------------------------

const OptionalString = Schema.optional(Schema.NullOr(Schema.String))

const SlackUrlVerificationPayload = Schema.Struct({
	type: Schema.Literal("url_verification"),
	challenge: Schema.String,
})

export const SlackAuthorization = Schema.Struct({
	enterprise_id: OptionalString,
	team_id: OptionalString,
	user_id: OptionalString,
	is_bot: Schema.optional(Schema.Boolean),
	is_enterprise_install: Schema.optional(Schema.Boolean),
})

export type SlackAuthorization = typeof SlackAuthorization.Type

const SlackEventCallbackPayload = Schema.Struct({
	type: Schema.Literal("event_callback"),
	team_id: Schema.String,
	api_app_id: Schema.String,
	event_id: Schema.String,
	event_time: Schema.Number,
	event: Schema.Unknown,
	authorizations: Schema.optional(Schema.Array(SlackAuthorization)),
	is_ext_shared_channel: Schema.optional(Schema.Boolean),
	context_team_id: OptionalString,
})

/** Any other delivery (`app_rate_limited`, ...). */
const SlackOtherPayload = Schema.Struct({ type: Schema.String })

/** The raw Events API body, one of the three shapes. */
export const SlackEnvelopePayload = Schema.Union([
	SlackUrlVerificationPayload,
	SlackEventCallbackPayload,
	SlackOtherPayload,
])

export type SlackEnvelope =
	| { readonly _tag: "UrlVerification"; readonly challenge: string }
	| ({ readonly _tag: "EventCallback" } & Omit<typeof SlackEventCallbackPayload.Type, "type">)
	| { readonly _tag: "Other"; readonly type: string; readonly payload: unknown }

/** Decode an Events API request body (already JSON-parsed). None when it is not one. */
export const decodeSlackEnvelope = (body: unknown): Option.Option<SlackEnvelope> =>
	Option.map(Schema.decodeUnknownOption(SlackEnvelopePayload)(body), (payload): SlackEnvelope => {
		if (payload.type === "url_verification" && "challenge" in payload) {
			return { _tag: "UrlVerification", challenge: payload.challenge }
		}
		if (payload.type === "event_callback" && "event_id" in payload) {
			const { type: _type, ...callback } = payload
			return { _tag: "EventCallback", ...callback }
		}
		return { _tag: "Other", type: payload.type, payload: body }
	})

// ---------------------------------------------------------------------------------------------
// Inner events
// ---------------------------------------------------------------------------------------------

const RawFile = Schema.Struct({
	id: Schema.String,
	name: OptionalString,
	title: OptionalString,
	mimetype: OptionalString,
	size: Schema.optional(Schema.NullOr(Schema.Number)),
	url_private: OptionalString,
	permalink: OptionalString,
})

const RawMessageFields = {
	subtype: Schema.optional(Schema.String),
	user: OptionalString,
	text: OptionalString,
	ts: Schema.String,
	thread_ts: OptionalString,
	bot_id: OptionalString,
	app_id: OptionalString,
	username: OptionalString,
	files: Schema.optional(Schema.Array(RawFile)),
	edited: Schema.optional(Schema.Struct({ user: OptionalString, ts: Schema.String })),
	channel: OptionalString,
	channel_type: OptionalString,
}

/** A message as nested in message_changed (`message`, `previous_message`). */
const RawInnerMessage = Schema.Struct(RawMessageFields)

const RawMessageEvent = Schema.Struct({
	...RawMessageFields,
	type: Schema.Literal("message"),
	ts: Schema.String,
	hidden: Schema.optional(Schema.Boolean),
	deleted_ts: OptionalString,
	message: Schema.optional(RawInnerMessage),
	previous_message: Schema.optional(RawInnerMessage),
})

const RawReactionEvent = Schema.Struct({
	type: Schema.Literals(["reaction_added", "reaction_removed"]),
	user: Schema.String,
	reaction: Schema.String,
	item_user: OptionalString,
	item: Schema.Struct({
		type: Schema.String,
		channel: OptionalString,
		ts: OptionalString,
	}),
	event_ts: Schema.String,
})

const RawAppUninstalledEvent = Schema.Struct({ type: Schema.Literal("app_uninstalled") })

const RawTokensRevokedEvent = Schema.Struct({
	type: Schema.Literal("tokens_revoked"),
	tokens: Schema.Struct({
		oauth: Schema.optional(Schema.Array(Schema.String)),
		bot: Schema.optional(Schema.Array(Schema.String)),
	}),
})

const RawChannelRenameEvent = Schema.Struct({
	type: Schema.Literal("channel_rename"),
	channel: Schema.Struct({ id: Schema.String, name: Schema.String }),
})

export interface SlackFile {
	readonly id: string
	readonly name: string | null
	readonly title: string | null
	readonly mimetype: string | null
	readonly size: number | null
	/** Needs the bot token (`files:read`) to download. */
	readonly urlPrivate: string | null
	readonly permalink: string | null
}

export interface SlackMessage {
	readonly channel: string
	readonly channelType: string | null
	/** Absent on `bot_message`. */
	readonly user: string | null
	readonly botId: string | null
	readonly appId: string | null
	/** A bot message's display name (`bot_message`, or a post with a custom `username`). */
	readonly username: string | null
	/** Slack mrkdwn; see `slackMrkdwnToMarkdown`. */
	readonly text: string
	readonly ts: string
	/** The parent's ts for a thread reply; equal to `ts` on a thread's parent. */
	readonly threadTs: string | null
	readonly files: ReadonlyArray<SlackFile>
	readonly edited: { readonly user: string | null; readonly ts: string } | null
}

/** The message subtypes reported as `MessagePosted`; `message` is a plain message. */
export type SlackPostedSubtype = "message" | "thread_broadcast" | "file_share" | "bot_message" | "me_message"

export type SlackEvent =
	| { readonly _tag: "MessagePosted"; readonly subtype: SlackPostedSubtype; readonly message: SlackMessage }
	| {
			readonly _tag: "MessageChanged"
			readonly channel: string
			/** The edit's own ts; `message.ts` is the edited message's. */
			readonly eventTs: string
			readonly message: SlackMessage
			readonly previousMessage: SlackMessage | null
	  }
	| {
			readonly _tag: "MessageDeleted"
			readonly channel: string
			readonly deletedTs: string
			readonly threadTs: string | null
			readonly previousMessage: SlackMessage | null
	  }
	| {
			readonly _tag: "ReactionAdded" | "ReactionRemoved"
			readonly user: string
			/** Slack's emoji name, without colons (`thumbsup`, `+1::skin-tone-2`, a custom emoji). */
			readonly reaction: string
			readonly itemUser: string | null
			readonly item: { readonly type: "message"; readonly channel: string; readonly ts: string }
			readonly eventTs: string
	  }
	| { readonly _tag: "AppUninstalled" }
	| {
			readonly _tag: "TokensRevoked"
			readonly oauth: ReadonlyArray<string>
			readonly bot: ReadonlyArray<string>
	  }
	| { readonly _tag: "ChannelRenamed"; readonly channelId: string; readonly name: string }

export type SlackEventTag = SlackEvent["_tag"]

const POSTED_SUBTYPES: ReadonlySet<string> = new Set([
	"thread_broadcast",
	"file_share",
	"bot_message",
	"me_message",
])

const toFile = (file: typeof RawFile.Type): SlackFile => ({
	id: file.id,
	name: file.name ?? null,
	title: file.title ?? null,
	mimetype: file.mimetype ?? null,
	size: file.size ?? null,
	urlPrivate: file.url_private ?? null,
	permalink: file.permalink ?? null,
})

const toMessage = (
	raw: typeof RawInnerMessage.Type,
	channel: string,
	channelType: string | null,
): SlackMessage => ({
	channel: raw.channel ?? channel,
	channelType: raw.channel_type ?? channelType,
	user: raw.user ?? null,
	botId: raw.bot_id ?? null,
	appId: raw.app_id ?? null,
	username: raw.username ?? null,
	text: raw.text ?? "",
	ts: raw.ts,
	threadTs: raw.thread_ts ?? null,
	files: (raw.files ?? []).map(toFile),
	edited: raw.edited ? { user: raw.edited.user ?? null, ts: raw.edited.ts } : null,
})

const decodeMessageEvent = (raw: typeof RawMessageEvent.Type): Option.Option<SlackEvent> => {
	const channel = raw.channel
	if (!channel) return Option.none()
	const channelType = raw.channel_type ?? null
	const subtype = raw.subtype

	if (subtype === undefined || POSTED_SUBTYPES.has(subtype)) {
		// file_share events can arrive without a subtype, with `files` (and `upload: true`).
		const postedSubtype = (subtype ??
			(raw.files?.length ? "file_share" : "message")) as SlackPostedSubtype
		return Option.some({
			_tag: "MessagePosted",
			subtype: postedSubtype,
			message: toMessage(raw, channel, channelType),
		})
	}
	if (subtype === "message_changed") {
		if (!raw.message) return Option.none()
		return Option.some({
			_tag: "MessageChanged",
			channel,
			eventTs: raw.ts,
			message: toMessage(raw.message, channel, channelType),
			previousMessage: raw.previous_message
				? toMessage(raw.previous_message, channel, channelType)
				: null,
		})
	}
	if (subtype === "message_deleted") {
		const deletedTs = raw.deleted_ts ?? raw.previous_message?.ts
		if (!deletedTs) return Option.none()
		return Option.some({
			_tag: "MessageDeleted",
			channel,
			deletedTs,
			threadTs: raw.previous_message?.thread_ts ?? raw.thread_ts ?? null,
			previousMessage: raw.previous_message
				? toMessage(raw.previous_message, channel, channelType)
				: null,
		})
	}
	// channel_join, message_replied, tombstones, ...: nothing to bridge.
	return Option.none()
}

const decodeAs =
	<A>(schema: Schema.Decoder<A>, toEvent: (raw: A) => Option.Option<SlackEvent>) =>
	(event: unknown): Option.Option<SlackEvent> =>
		Option.flatMap(Schema.decodeUnknownOption(schema)(event), toEvent)

const decodeReactionEvent = decodeAs(RawReactionEvent, (raw) =>
	raw.item.type === "message" && raw.item.channel && raw.item.ts
		? Option.some({
				_tag: raw.type === "reaction_added" ? "ReactionAdded" : "ReactionRemoved",
				user: raw.user,
				reaction: raw.reaction,
				itemUser: raw.item_user ?? null,
				item: { type: "message", channel: raw.item.channel, ts: raw.item.ts },
				eventTs: raw.event_ts,
			})
		: Option.none(),
)

const DECODERS: Record<string, (event: unknown) => Option.Option<SlackEvent>> = {
	message: decodeAs(RawMessageEvent, decodeMessageEvent),
	reaction_added: decodeReactionEvent,
	reaction_removed: decodeReactionEvent,
	app_uninstalled: decodeAs(RawAppUninstalledEvent, () => Option.some({ _tag: "AppUninstalled" })),
	tokens_revoked: decodeAs(RawTokensRevokedEvent, (raw) =>
		Option.some({ _tag: "TokensRevoked", oauth: raw.tokens.oauth ?? [], bot: raw.tokens.bot ?? [] }),
	),
	channel_rename: decodeAs(RawChannelRenameEvent, (raw) =>
		Option.some({ _tag: "ChannelRenamed", channelId: raw.channel.id, name: raw.channel.name }),
	),
}

/**
 * Decode the `event` of an `event_callback`. None for an event type or message subtype the bridge
 * does not handle, a reaction on a file, or a malformed event.
 */
export const decodeSlackEvent = (event: unknown): Option.Option<SlackEvent> => {
	if (typeof event !== "object" || event === null || !("type" in event) || typeof event.type !== "string") {
		return Option.none()
	}
	const decoder = Object.hasOwn(DECODERS, event.type) ? DECODERS[event.type] : undefined
	return decoder ? decoder(event) : Option.none()
}
