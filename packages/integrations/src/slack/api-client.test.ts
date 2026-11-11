import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, type HttpClientRequest, HttpClientResponse, UrlParams } from "effect/http"
import { SlackApiClient, SlackApiError } from "./api-client"

interface SentRequest {
	readonly method: string
	readonly url: string
	readonly query: string
	readonly headers: Record<string, string>
	readonly contentType: string | null
	readonly body: string | null
}

type Handler = (request: SentRequest) => Response

const readBody = (request: HttpClientRequest.HttpClientRequest): string | null =>
	request.body._tag === "Uint8Array"
		? (request.body.text ?? new TextDecoder().decode(request.body.body))
		: null

/** A Slack answering each Web API method with `routes[method]`; records what was sent. */
const fakeSlack = (routes: Record<string, Handler>) => {
	const sent: Array<SentRequest> = []
	const layer = SlackApiClient.layer.pipe(
		Layer.provide(
			Layer.succeed(
				HttpClient.HttpClient,
				HttpClient.make((request) =>
					Effect.sync(() => {
						const recorded: SentRequest = {
							method: request.method,
							url: request.url,
							query: UrlParams.toString(request.urlParams),
							headers: request.headers,
							contentType: request.body._tag === "Uint8Array" ? request.body.contentType : null,
							body: readBody(request),
						}
						sent.push(recorded)
						const method = request.url.replace("https://slack.com/api/", "")
						const handler = routes[method]
						return HttpClientResponse.fromWeb(
							request,
							handler ? handler(recorded) : new Response("not found", { status: 404 }),
						)
					}),
				),
			),
		),
	)
	return { layer, sent }
}

const ok =
	(body: Record<string, unknown> = {}) =>
	() =>
		Response.json({ ok: true, ...body })
const slackError = (error: string) => () => Response.json({ ok: false, error })

const failureOf = <A>(exit: Exit.Exit<A, SlackApiError>): SlackApiError => {
	if (Exit.isSuccess(exit)) throw new Error("expected a failure")
	const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
	if (!error || error._tag !== "Fail") throw new Error("expected a typed failure")
	return error.error
}

describe("SlackApiClient", () => {
	it.effect("turns ok:false into an api SlackApiError carrying the code", () => {
		const { layer } = fakeSlack({ "chat.postMessage": slackError("channel_not_found") })
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const error = failureOf(
				yield* Effect.exit(slack.postMessage("xoxb-1", { channel: "C1", text: "hi" })),
			)
			expect(error).toBeInstanceOf(SlackApiError)
			expect(error.reason).toBe("api")
			expect(error.method).toBe("chat.postMessage")
			expect(error.message).toBe("channel_not_found")
			expect(error.status).toBeUndefined()
		}).pipe(Effect.provide(layer))
	})

	it.effect("turns a 429 into an http error with Retry-After", () => {
		const { layer } = fakeSlack({
			"reactions.add": () =>
				new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
					status: 429,
					headers: { "Retry-After": "30", "Content-Type": "application/json" },
				}),
		})
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const error = failureOf(
				yield* Effect.exit(slack.addReaction("xoxb-1", { channel: "C1", ts: "1.2", name: "+1" })),
			)
			expect(error.reason).toBe("http")
			expect(error.status).toBe(429)
			expect(error.retryAfterSeconds).toBe(30)
			expect(error.message).toBe("ratelimited")
		}).pipe(Effect.provide(layer))
	})

	it.effect("turns a 5xx without a JSON body into an http error", () => {
		const { layer } = fakeSlack({ "auth.test": () => new Response("<html>", { status: 503 }) })
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const error = failureOf(yield* Effect.exit(slack.authTest("xoxb-1")))
			expect(error.reason).toBe("http")
			expect(error.status).toBe(503)
			expect(error.retryAfterSeconds).toBeUndefined()
		}).pipe(Effect.provide(layer))
	})

	it.effect("turns a body that is not a Slack answer into a transport error", () => {
		const { layer } = fakeSlack({ "auth.test": () => new Response("not json", { status: 200 }) })
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const error = failureOf(yield* Effect.exit(slack.authTest("xoxb-1")))
			expect(error.reason).toBe("transport")
			expect(error.status).toBeUndefined()
		}).pipe(Effect.provide(layer))
	})

	it.effect(
		"treats already_reacted, no_reaction, message_not_found and already_in_channel as success",
		() => {
			const { layer } = fakeSlack({
				"reactions.add": slackError("already_reacted"),
				"reactions.remove": slackError("no_reaction"),
				"chat.delete": slackError("message_not_found"),
				"conversations.join": ok({ warning: "already_in_channel", channel: { id: "C1" } }),
			})
			return Effect.gen(function* () {
				const slack = yield* SlackApiClient
				yield* slack.addReaction("xoxb-1", { channel: "C1", ts: "1.2", name: "+1" })
				yield* slack.removeReaction("xoxb-1", { channel: "C1", ts: "1.2", name: "+1" })
				yield* slack.deleteMessage("xoxb-1", { channel: "C1", ts: "1.2" })
				yield* slack.joinChannel("xoxb-1", "C1")
			}).pipe(Effect.provide(layer))
		},
	)

	it.effect("still fails other reaction errors", () => {
		const { layer } = fakeSlack({ "reactions.add": slackError("invalid_name") })
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const error = failureOf(
				yield* Effect.exit(slack.addReaction("xoxb-1", { channel: "C1", ts: "1.2", name: "nope" })),
			)
			expect(error.message).toBe("invalid_name")
		}).pipe(Effect.provide(layer))
	})

	it.effect("posts markdown_text as JSON with the bot token, thread and custom identity", () => {
		const { layer, sent } = fakeSlack({
			"chat.postMessage": ok({ channel: "C1", ts: "1503435956.000247", message: { text: "hi" } }),
			"chat.update": ok({ channel: "C1", ts: "1503435956.000247", text: "edited" }),
		})
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const posted = yield* slack.postMessage("xoxb-1", {
				channel: "C1",
				text: "**hi** <@U1>",
				threadTs: "1503435900.000001",
				username: "Alice (Hazel)",
				iconUrl: "https://hazel.example/a.png",
			})
			expect(posted).toEqual({ ts: "1503435956.000247", channel: "C1" })
			yield* slack.updateMessage("xoxb-1", { channel: "C1", ts: "1503435956.000247", text: "edited" })

			const [post, update] = sent
			expect(post?.method).toBe("POST")
			expect(post?.headers.authorization).toBe("Bearer xoxb-1")
			expect(post?.contentType).toBe("application/json; charset=utf-8")
			expect(JSON.parse(post?.body ?? "")).toEqual({
				channel: "C1",
				markdown_text: "**hi** <@U1>",
				thread_ts: "1503435900.000001",
				username: "Alice (Hazel)",
				icon_url: "https://hazel.example/a.png",
			})
			expect(JSON.parse(update?.body ?? "")).toEqual({
				channel: "C1",
				ts: "1503435956.000247",
				markdown_text: "edited",
			})
		}).pipe(Effect.provide(layer))
	})

	it.effect("cuts markdown_text to Slack's 12,000 characters", () => {
		const { layer, sent } = fakeSlack({ "chat.postMessage": ok({ channel: "C1", ts: "1.1" }) })
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			yield* slack.postMessage("xoxb-1", { channel: "C1", text: "a".repeat(20_000) })
			const markdown = JSON.parse(sent[0]?.body ?? "").markdown_text as string
			expect(markdown.length).toBe(12_000)
			expect(markdown.endsWith("…")).toBe(true)
		}).pipe(Effect.provide(layer))
	})

	it.effect("follows the conversations.list cursor, past empty pages", () => {
		const pages: Record<string, unknown> = {
			"": {
				channels: [
					{ id: "C1", name: "general", is_private: false, is_member: true, is_archived: false },
					{ id: "C2", name: "old", is_private: false, is_member: false, is_archived: true },
				],
				response_metadata: { next_cursor: "page2" },
			},
			page2: { channels: [], response_metadata: { next_cursor: "page3" } },
			page3: {
				channels: [{ id: "G1", name: "secret", is_private: true, is_member: true }],
				response_metadata: { next_cursor: "" },
			},
		}
		const { layer, sent } = fakeSlack({
			"conversations.list": (request) => {
				const cursor = new URLSearchParams(request.query).get("cursor") ?? ""
				return Response.json({ ok: true, ...(pages[cursor] as object) })
			},
		})
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const channels = yield* slack.listChannels("xoxb-1")
			expect(channels).toEqual([
				{ id: "C1", name: "general", isPrivate: false, isMember: true },
				{ id: "G1", name: "secret", isPrivate: true, isMember: true },
			])
			expect(sent).toHaveLength(3)
			const first = new URLSearchParams(sent[0]?.query)
			expect(sent[0]?.method).toBe("GET")
			expect(first.get("types")).toBe("public_channel,private_channel")
			expect(first.get("exclude_archived")).toBe("true")
			expect(first.get("limit")).toBe("200")
			expect(first.has("token")).toBe(false)
			expect(sent[0]?.headers.authorization).toBe("Bearer xoxb-1")
		}).pipe(Effect.provide(layer))
	})

	it.effect("decodes oauth.v2.access, sending client credentials with HTTP Basic", () => {
		// https://docs.slack.dev/reference/methods/oauth.v2.access
		const { layer, sent } = fakeSlack({
			"oauth.v2.access": ok({
				access_token: "xoxb-fake-bot-token",
				token_type: "bot",
				scope: "commands,incoming-webhook",
				bot_user_id: "U0KRQLJ9H",
				app_id: "A0KRD7HC3",
				team: { name: "Slack Softball Team", id: "T9TK3CUKW" },
				enterprise: { name: "slack-sports", id: "E12345678" },
				authed_user: {
					id: "U1234",
					scope: "chat:write",
					access_token: "xoxp-1234",
					token_type: "user",
				},
			}),
		})
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const access = yield* slack.oauthAccess({
				code: "code-1",
				clientId: "123.456",
				clientSecret: "shh",
				redirectUri: "https://hazel.example/slack/callback",
			})
			expect(access).toEqual({
				accessToken: "xoxb-fake-bot-token",
				scope: "commands,incoming-webhook",
				botUserId: "U0KRQLJ9H",
				appId: "A0KRD7HC3",
				team: { id: "T9TK3CUKW", name: "Slack Softball Team" },
				authedUser: { id: "U1234", accessToken: "xoxp-1234", scope: "chat:write" },
			})
			const request = sent[0]
			expect(request?.headers.authorization).toBe(`Basic ${btoa("123.456:shh")}`)
			expect(request?.contentType).toBe("application/x-www-form-urlencoded")
			const form = new URLSearchParams(request?.body ?? "")
			expect(form.get("code")).toBe("code-1")
			expect(form.get("redirect_uri")).toBe("https://hazel.example/slack/callback")
			expect(form.has("client_secret")).toBe(false)
		}).pipe(Effect.provide(layer))
	})

	it.effect("decodes an oauth.v2.access answer without a bot token or team name", () => {
		const { layer } = fakeSlack({
			"oauth.v2.access": ok({
				app_id: "A0118NQPZZC",
				authed_user: {
					id: "U065VRX1T0",
					scope: "identity.basic",
					access_token: "xoxp-yoda",
					token_type: "user",
				},
				team: { id: "T024BE7LD" },
				enterprise: null,
				is_enterprise_install: false,
			}),
		})
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			const access = yield* slack.oauthAccess({
				code: "c",
				clientId: "i",
				clientSecret: "s",
				redirectUri: "r",
			})
			expect(access.accessToken).toBeNull()
			expect(access.botUserId).toBeNull()
			expect(access.team).toEqual({ id: "T024BE7LD", name: "" })
		}).pipe(Effect.provide(layer))
	})

	it.effect("decodes auth.test and users.info", () => {
		const { layer, sent } = fakeSlack({
			"auth.test": ok({
				url: "https://subarachnoid.slack.com/",
				team: "Subarachnoid Workspace",
				user: "bot",
				team_id: "T0G9PQBBK",
				user_id: "W23456789",
				bot_id: "BZYBOTHED",
			}),
			"users.info": ok({
				user: {
					id: "W012A3CDE",
					team_id: "T012AB3C4",
					name: "spengler",
					real_name: "Egon Spengler",
					profile: {
						real_name: "Egon Spengler",
						display_name: "",
						image_72: "https://avatars.example/72.jpg",
						image_192: "https://avatars.example/192.jpg",
					},
					is_bot: false,
				},
			}),
		})
		return Effect.gen(function* () {
			const slack = yield* SlackApiClient
			expect(yield* slack.authTest("xoxb-1")).toEqual({
				teamId: "T0G9PQBBK",
				team: "Subarachnoid Workspace",
				userId: "W23456789",
				botId: "BZYBOTHED",
			})
			expect(yield* slack.getUser("xoxb-1", "W012A3CDE")).toEqual({
				id: "W012A3CDE",
				displayName: "Egon Spengler",
				avatarUrl: "https://avatars.example/192.jpg",
				isBot: false,
			})
			expect(new URLSearchParams(sent[1]?.query).get("user")).toBe("W012A3CDE")
		}).pipe(Effect.provide(layer))
	})
})
