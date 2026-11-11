import { HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { Context, Duration, Effect, Layer, Option, Result, Schema } from "effect"

/**
 * A failed Slack Web API call.
 *
 * - `api`: Slack answered `ok: false`; `message` is its error code (`channel_not_found`).
 * - `http`: a non-2xx status (`status` set; `retryAfterSeconds` from `Retry-After` on 429).
 * - `transport`: the request failed, timed out or the answer was not a Slack response (no `status`).
 */
export class SlackApiError extends Schema.TaggedError<SlackApiError>()("SlackApiError", {
	method: Schema.String,
	reason: Schema.Literals(["api", "http", "transport"]),
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	retryAfterSeconds: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

/** Error codes meaning the token no longer works: the install is gone or must be redone. */
export const SLACK_TOKEN_ERRORS: ReadonlySet<string> = new Set([
	"invalid_auth",
	"not_authed",
	"account_inactive",
	"token_revoked",
	"token_expired",
])

/** Error codes worth retrying later. */
export const SLACK_TRANSIENT_ERRORS: ReadonlySet<string> = new Set([
	"ratelimited",
	"rate_limited",
	"internal_error",
	"fatal_error",
	"service_unavailable",
	"request_timeout",
])

/** `markdown_text` is limited to 12,000 characters (chat.postMessage, chat.update). */
export const SLACK_MARKDOWN_TEXT_LIMIT = 12_000

export interface SlackOAuthAccess {
	/** The bot token (`xoxb-`). */
	readonly accessToken: string | null
	readonly scope: string | null
	readonly botUserId: string | null
	readonly appId: string | null
	readonly team: { readonly id: string; readonly name: string } | null
	readonly authedUser: {
		readonly id: string
		readonly accessToken: string | null
		readonly scope: string | null
	}
}

export interface SlackAuthTest {
	readonly teamId: string
	readonly team: string
	readonly userId: string
	readonly botId: string | null
}

export interface SlackChannel {
	readonly id: string
	readonly name: string
	readonly isPrivate: boolean
	readonly isMember: boolean
}

export interface SlackUser {
	readonly id: string
	readonly displayName: string
	readonly avatarUrl: string | null
	readonly isBot: boolean
}

export interface SlackPostedMessage {
	readonly ts: string
	readonly channel: string
}

const SLACK_API_BASE_URL = "https://slack.com/api"
const DEFAULT_TIMEOUT = Duration.seconds(30)
/** conversations.list: Slack recommends no more than 200 per page. */
const CHANNELS_PAGE_SIZE = 200
/** A guard against a cursor that never ends. */
const MAX_CHANNEL_PAGES = 100

const SlackResponseStatus = Schema.Struct({
	ok: Schema.Boolean,
	error: Schema.optional(Schema.String),
})

const OptionalString = Schema.optional(Schema.NullOr(Schema.String))

const OAuthAccessResponse = Schema.Struct({
	access_token: OptionalString,
	scope: OptionalString,
	bot_user_id: OptionalString,
	app_id: OptionalString,
	team: Schema.optional(
		Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) })),
	),
	authed_user: Schema.Struct({
		id: Schema.String,
		access_token: OptionalString,
		scope: OptionalString,
	}),
})

const AuthTestResponse = Schema.Struct({
	team_id: Schema.String,
	team: Schema.String,
	user_id: Schema.String,
	bot_id: OptionalString,
})

const ConversationsListResponse = Schema.Struct({
	channels: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			name: Schema.optional(Schema.String),
			is_private: Schema.optional(Schema.Boolean),
			is_member: Schema.optional(Schema.Boolean),
			is_archived: Schema.optional(Schema.Boolean),
		}),
	),
	response_metadata: Schema.optional(Schema.Struct({ next_cursor: OptionalString })),
})

const PostMessageResponse = Schema.Struct({
	channel: Schema.String,
	ts: Schema.String,
})

const UsersInfoResponse = Schema.Struct({
	user: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		real_name: OptionalString,
		is_bot: Schema.optional(Schema.Boolean),
		profile: Schema.optional(
			Schema.Struct({
				display_name: OptionalString,
				real_name: OptionalString,
				image_512: OptionalString,
				image_192: OptionalString,
				image_72: OptionalString,
				image_48: OptionalString,
			}),
		),
	}),
})

const nonEmpty = (value: string | null | undefined): string | null =>
	value === undefined || value === null || value.trim() === "" ? null : value

const parseRetryAfter = (value: string | undefined): number | undefined => {
	if (value === undefined) return undefined
	const seconds = Number(value)
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** Truncate to `markdown_text`'s limit without splitting a surrogate pair. */
const fitMarkdownText = (text: string): string => {
	if (text.length <= SLACK_MARKDOWN_TEXT_LIMIT) return text
	let end = SLACK_MARKDOWN_TEXT_LIMIT - 1
	const last = text.charCodeAt(end - 1)
	if (last >= 0xd800 && last <= 0xdbff) end -= 1
	return `${text.slice(0, end)}…`
}

/** True when the error is Slack answering `ok: false` with one of `codes`. */
const isApiError =
	(...codes: ReadonlyArray<string>) =>
	(error: SlackApiError): boolean =>
		error.reason === "api" && codes.includes(error.message)

export class SlackApiClient extends Context.Service<SlackApiClient>()("SlackApiClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		const transportError = (method: string, message: string, cause: unknown) =>
			new SlackApiError({ method, reason: "transport", message, cause })

		/**
		 * Send one Web API call and return its JSON body once Slack answered `ok: true`.
		 * Slack answers most failures with 200 and `{"ok": false, "error": "<code>"}`.
		 */
		const send = (method: string, request: HttpClientRequest.HttpClientRequest) =>
			Effect.gen(function* () {
				const response: HttpClientResponse.HttpClientResponse = yield* httpClient.execute(
					request.pipe(HttpClientRequest.acceptJson),
				)
				yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
				const body = yield* response.json.pipe(Effect.result)

				if (response.status < 200 || response.status >= 300) {
					const code = Result.isSuccess(body)
						? Option.flatMap(Schema.decodeUnknownOption(SlackResponseStatus)(body.success), (b) =>
								Option.fromNullishOr(b.error),
							)
						: Option.none()
					const retryAfterSeconds = parseRetryAfter(response.headers["retry-after"])
					return yield* new SlackApiError({
						method,
						reason: "http",
						message: Option.getOrElse(code, () => `Slack answered HTTP ${response.status}`),
						status: response.status,
						...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
					})
				}

				if (Result.isFailure(body)) {
					return yield* transportError(method, "Slack's answer was not JSON", body.failure)
				}
				const status = yield* Schema.decodeUnknownEffect(SlackResponseStatus)(body.success)
				if (!status.ok) {
					return yield* new SlackApiError({
						method,
						reason: "api",
						message: status.error ?? "unknown_error",
					})
				}
				return body.success
			}).pipe(
				Effect.timeout(DEFAULT_TIMEOUT),
				Effect.catchTags({
					TimeoutError: (cause) =>
						Effect.fail(transportError(method, `${method} timed out`, cause)),
					HttpClientError: (cause) =>
						Effect.fail(transportError(method, `${method} request failed`, cause)),
					SchemaError: (cause) =>
						Effect.fail(
							transportError(method, "Slack's answer was not a Web API response", cause),
						),
				}),
				Effect.withSpan("SlackApiClient.send", {
					attributes: { "slack.method": method, "peer.service": "slack" },
				}),
			)

		const decode = <A>(method: string, schema: Schema.Decoder<A>, body: unknown) =>
			Schema.decodeUnknownEffect(schema)(body).pipe(
				Effect.mapError((cause) => transportError(method, `Unexpected ${method} answer`, cause)),
			)

		/** A write method: JSON body, bot token as Bearer. */
		const postJson = (method: string, token: string, body: Record<string, unknown>) =>
			send(
				method,
				HttpClientRequest.post(`${SLACK_API_BASE_URL}/${method}`).pipe(
					HttpClientRequest.bearerToken(token),
					HttpClientRequest.setBody(
						HttpBody.text(JSON.stringify(body), "application/json; charset=utf-8"),
					),
				),
			)

		/** A read method: arguments in the query string, token as Bearer (never in the query). */
		const getQuery = (method: string, token: string, params: Record<string, string>) =>
			send(
				method,
				HttpClientRequest.get(`${SLACK_API_BASE_URL}/${method}`).pipe(
					HttpClientRequest.bearerToken(token),
					HttpClientRequest.setUrlParams(params),
				),
			)

		/** oauth.v2.access: exchange the authorization code; client credentials via HTTP Basic. */
		const oauthAccess = Effect.fn("SlackApiClient.oauthAccess")(function* (params: {
			code: string
			clientId: string
			clientSecret: string
			redirectUri: string
		}) {
			const method = "oauth.v2.access"
			const body = yield* send(
				method,
				HttpClientRequest.post(`${SLACK_API_BASE_URL}/${method}`).pipe(
					HttpClientRequest.basicAuth(params.clientId, params.clientSecret),
					HttpClientRequest.bodyUrlParams({ code: params.code, redirect_uri: params.redirectUri }),
				),
			)
			const access = yield* decode(method, OAuthAccessResponse, body)
			return {
				accessToken: nonEmpty(access.access_token),
				scope: nonEmpty(access.scope),
				botUserId: nonEmpty(access.bot_user_id),
				appId: nonEmpty(access.app_id),
				team: access.team ? { id: access.team.id, name: access.team.name ?? "" } : null,
				authedUser: {
					id: access.authed_user.id,
					accessToken: nonEmpty(access.authed_user.access_token),
					scope: nonEmpty(access.authed_user.scope),
				},
			} satisfies SlackOAuthAccess
		})

		const authTest = Effect.fn("SlackApiClient.authTest")(function* (token: string) {
			const body = yield* postJson("auth.test", token, {})
			const auth = yield* decode("auth.test", AuthTestResponse, body)
			return {
				teamId: auth.team_id,
				team: auth.team,
				userId: auth.user_id,
				botId: nonEmpty(auth.bot_id),
			} satisfies SlackAuthTest
		})

		/** Every unarchived public and private channel the token can see, following the cursor. */
		const listChannels = Effect.fn("SlackApiClient.listChannels")(function* (token: string) {
			const channels: Array<SlackChannel> = []
			let cursor: string | null = null
			for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
				const body = yield* getQuery("conversations.list", token, {
					types: "public_channel,private_channel",
					exclude_archived: "true",
					limit: String(CHANNELS_PAGE_SIZE),
					...(cursor ? { cursor } : {}),
				})
				const list = yield* decode("conversations.list", ConversationsListResponse, body)
				for (const channel of list.channels) {
					if (channel.is_archived) continue
					channels.push({
						id: channel.id,
						name: channel.name ?? channel.id,
						isPrivate: channel.is_private ?? false,
						isMember: channel.is_member ?? false,
					})
				}
				// Slack filters after paging, so a short or empty page does not mean the end.
				cursor = nonEmpty(list.response_metadata?.next_cursor)
				if (cursor === null) break
			}
			return channels as ReadonlyArray<SlackChannel>
		})

		/** conversations.join; joining a channel the bot is in is a success (Slack warns `already_in_channel`). */
		const joinChannel = Effect.fn("SlackApiClient.joinChannel")(function* (
			token: string,
			channelId: string,
		) {
			yield* postJson("conversations.join", token, { channel: channelId }).pipe(
				Effect.catchIf(isApiError("already_in_channel"), () => Effect.void),
			)
		})

		/** chat.postMessage with `text` as standard markdown (`markdown_text`). */
		const postMessage = Effect.fn("SlackApiClient.postMessage")(function* (
			token: string,
			params: { channel: string; text: string; threadTs?: string; username?: string; iconUrl?: string },
		) {
			const body = yield* postJson("chat.postMessage", token, {
				channel: params.channel,
				markdown_text: fitMarkdownText(params.text),
				...(params.threadTs ? { thread_ts: params.threadTs } : {}),
				...(params.username ? { username: params.username } : {}),
				...(params.iconUrl ? { icon_url: params.iconUrl } : {}),
			})
			const posted = yield* decode("chat.postMessage", PostMessageResponse, body)
			return { ts: posted.ts, channel: posted.channel } satisfies SlackPostedMessage
		})

		const updateMessage = Effect.fn("SlackApiClient.updateMessage")(function* (
			token: string,
			params: { channel: string; ts: string; text: string },
		) {
			yield* postJson("chat.update", token, {
				channel: params.channel,
				ts: params.ts,
				markdown_text: fitMarkdownText(params.text),
			})
		})

		/** chat.delete; a message that is already gone is a success. */
		const deleteMessage = Effect.fn("SlackApiClient.deleteMessage")(function* (
			token: string,
			params: { channel: string; ts: string },
		) {
			yield* postJson("chat.delete", token, { channel: params.channel, ts: params.ts }).pipe(
				Effect.catchIf(isApiError("message_not_found"), () => Effect.void),
			)
		})

		/** reactions.add; `name` without colons (`thumbsup`, `+1::skin-tone-3`). Already reacted is a success. */
		const addReaction = Effect.fn("SlackApiClient.addReaction")(function* (
			token: string,
			params: { channel: string; ts: string; name: string },
		) {
			yield* postJson("reactions.add", token, {
				channel: params.channel,
				timestamp: params.ts,
				name: params.name,
			}).pipe(Effect.catchIf(isApiError("already_reacted"), () => Effect.void))
		})

		/** reactions.remove; a reaction that is not there is a success. */
		const removeReaction = Effect.fn("SlackApiClient.removeReaction")(function* (
			token: string,
			params: { channel: string; ts: string; name: string },
		) {
			yield* postJson("reactions.remove", token, {
				channel: params.channel,
				timestamp: params.ts,
				name: params.name,
			}).pipe(Effect.catchIf(isApiError("no_reaction"), () => Effect.void))
		})

		const getUser = Effect.fn("SlackApiClient.getUser")(function* (token: string, userId: string) {
			const body = yield* getQuery("users.info", token, { user: userId })
			const { user } = yield* decode("users.info", UsersInfoResponse, body)
			const profile = user.profile
			return {
				id: user.id,
				displayName:
					nonEmpty(profile?.display_name) ??
					nonEmpty(profile?.real_name) ??
					nonEmpty(user.real_name) ??
					nonEmpty(user.name) ??
					user.id,
				avatarUrl:
					nonEmpty(profile?.image_192) ??
					nonEmpty(profile?.image_512) ??
					nonEmpty(profile?.image_72) ??
					nonEmpty(profile?.image_48),
				isBot: user.is_bot ?? false,
			} satisfies SlackUser
		})

		return {
			oauthAccess,
			authTest,
			listChannels,
			joinChannel,
			postMessage,
			updateMessage,
			deleteMessage,
			addReaction,
			removeReaction,
			getUser,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
