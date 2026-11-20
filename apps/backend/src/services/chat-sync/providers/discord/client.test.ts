import { describe, expect, it } from "@effect/vitest"
import { Discord } from "@hazel/integrations"
import {
	ExternalChannelId,
	ExternalMessageId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
} from "@hazel/schema"
import { ConfigProvider, Effect, Layer } from "effect"
import { type ChatSyncLinkContext, NOT_IN_WORKSPACE } from "../../provider"
import { GUILD_VERIFIED, makeDiscordClient, withAuthorHeader } from "./client"

const channelId = ExternalChannelId.make("100000000000000001")
const messageId = ExternalMessageId.make("100000000000000002")

const context: ChatSyncLinkContext = {
	link: {
		channelLinkId: SyncChannelLinkId.make(crypto.randomUUID()),
		syncConnectionId: SyncConnectionId.make(crypto.randomUUID()),
		organizationId: OrganizationId.make(crypto.randomUUID()),
		provider: "discord",
		externalChannelId: channelId,
		direction: "both",
		settings: null,
	},
	saveSettings: () => Effect.void,
}

const registryWith = (createThread: () => Effect.Effect<string, Discord.DiscordApiError>) =>
	Layer.mergeAll(
		Layer.succeed(Discord.DiscordApiClient, {
			createThread,
		} as unknown as Discord.DiscordApiClient["Service"]),
		ConfigProvider.layer(ConfigProvider.fromUnknown({ DISCORD_BOT_TOKEN: "bot-token" })),
	)

const createThread = Effect.gen(function* () {
	const client = yield* makeDiscordClient
	return yield* client.createThread(context, { externalMessageId: messageId, name: "Hi" })
})

describe("Discord thread creation", () => {
	it.effect("returns the thread Discord made", () =>
		createThread.pipe(
			Effect.map((threadId) => expect(threadId).toBe("100000000000000003")),
			Effect.provide(registryWith(() => Effect.succeed("100000000000000003"))),
		),
	)

	it.effect("a retry after the thread was made takes the existing one (the message's id)", () =>
		createThread.pipe(
			Effect.map((threadId) => expect(threadId).toBe(messageId)),
			Effect.provide(
				registryWith(() =>
					Effect.fail(
						new Discord.DiscordApiError({
							message: "A thread has already been created for this message",
							status: 400,
							code: Discord.DISCORD_THREAD_ALREADY_CREATED,
						}),
					),
				),
			),
		),
	)

	it.effect("other refusals still fail", () =>
		createThread.pipe(
			Effect.flip,
			Effect.map((error) => expect(error._tag).toBe("ChatSyncProviderApiError")),
			Effect.provide(
				registryWith(() =>
					Effect.fail(new Discord.DiscordApiError({ message: "Missing Access", status: 403 })),
				),
			),
		),
	)
})

describe("Discord per-author identity", () => {
	const author = { name: "Olive Owner", avatarUrl: "https://example.com/olive.png" }
	const message = { content: "hi", attachments: [], replyToExternalMessageId: undefined, author }
	const identityOn = (providers: Record<string, unknown> = {}) => ({
		outboundIdentity: { strategy: "webhook", providers },
	})

	/** The client over a fake Discord API; records calls and the settings the client saved. */
	const harness = (options: {
		readonly settings: Record<string, unknown>
		readonly createWebhook?: () => Effect.Effect<
			{ webhookId: string; webhookToken: string },
			Discord.DiscordApiError
		>
		readonly executeWebhook?: () => Effect.Effect<string, Discord.DiscordApiError>
		/** The link is a thread's, under this parent channel. */
		readonly threadOf?: ExternalChannelId
	}) => {
		const calls: Array<string> = []
		const contents: Array<string> = []
		const saved: Array<Record<string, unknown>> = []
		const api = {
			createWebhook: (params: { channelId: string }) => {
				calls.push(`createWebhook:${params.channelId}`)
				return (
					options.createWebhook?.() ??
					Effect.succeed({ webhookId: "700000000000000001", webhookToken: "t" })
				)
			},
			executeWebhookMessage: (params: { username: string; threadId?: string }) => {
				calls.push(
					`executeWebhook:${params.username}${params.threadId === undefined ? "" : `@${params.threadId}`}`,
				)
				return options.executeWebhook?.() ?? Effect.succeed("100000000000000010")
			},
			createMessage: (params: { content: string }) => {
				calls.push("createMessage")
				contents.push(params.content)
				return Effect.succeed("100000000000000020")
			},
		}
		const layer = Layer.mergeAll(
			Layer.succeed(Discord.DiscordApiClient, api as unknown as Discord.DiscordApiClient["Service"]),
			ConfigProvider.layer(ConfigProvider.fromUnknown({ DISCORD_BOT_TOKEN: "bot-token" })),
		)
		const post = Effect.gen(function* () {
			const client = yield* makeDiscordClient
			return yield* client.postMessage(
				{
					link: {
						...context.link,
						settings: options.settings,
						parent:
							options.threadOf === undefined
								? undefined
								: {
										channelLinkId: SyncChannelLinkId.make(crypto.randomUUID()),
										externalChannelId: options.threadOf,
									},
					},
					saveSettings: (settings) => Effect.sync(() => void saved.push(settings)),
				},
				message,
			)
		}).pipe(Effect.provide(layer))
		return { post, calls, contents, saved }
	}

	const permissionOf = (settings: Record<string, unknown> | undefined) =>
		(settings?.webhookPermission as { status: string } | undefined)?.status

	it.effect("provisions a webhook on first use, saves it, and posts as the author", () =>
		Effect.gen(function* () {
			const h = harness({ settings: identityOn() })
			expect(yield* h.post).toBe("100000000000000010")
			expect(h.calls).toEqual([`createWebhook:${channelId}`, "executeWebhook:Olive Owner"])
			expect(permissionOf(h.saved[0])).toBe("allowed")
			expect(
				(h.saved[0]!.outboundIdentity as { providers: Record<string, unknown> }).providers.discord,
			).toEqual({ kind: "discord.webhook", webhookId: "700000000000000001", webhookToken: "t" })
		}),
	)

	it.effect("a refused webhook (403) falls back to the bot and remembers the refusal", () =>
		Effect.gen(function* () {
			const h = harness({
				settings: identityOn(),
				createWebhook: () =>
					Effect.fail(new Discord.DiscordApiError({ message: "Missing Permissions", status: 403 })),
			})
			expect(yield* h.post).toBe("100000000000000020")
			expect(h.calls).toEqual([`createWebhook:${channelId}`, "createMessage"])
			expect(permissionOf(h.saved[0])).toBe("denied")
			expect((h.saved[0]!.outboundIdentity as { strategy: string }).strategy).toBe("fallback_bot")
		}),
	)

	it.effect("a failing webhook create (5xx) posts as the bot and leaves the permission unknown", () =>
		Effect.gen(function* () {
			const h = harness({
				settings: identityOn(),
				createWebhook: () =>
					Effect.fail(new Discord.DiscordApiError({ message: "Down", status: 503 })),
			})
			expect(yield* h.post).toBe("100000000000000020")
			expect(permissionOf(h.saved[0])).toBe("unknown")
		}),
	)

	it.effect("a webhook Discord fails mid-post falls back to the bot, without reprovisioning", () =>
		Effect.gen(function* () {
			const h = harness({
				settings: identityOn({
					discord: { kind: "discord.webhook", webhookId: "700000000000000001", webhookToken: "t" },
				}),
				executeWebhook: () =>
					Effect.fail(new Discord.DiscordApiError({ message: "Unknown Webhook", status: 404 })),
			})
			expect(yield* h.post).toBe("100000000000000020")
			expect(h.calls).toEqual(["executeWebhook:Olive Owner", "createMessage"])
			expect(h.saved).toEqual([])
		}),
	)

	it.effect("a new link with no identity settings posts as the author", () =>
		Effect.gen(function* () {
			const h = harness({ settings: {} })
			expect(yield* h.post).toBe("100000000000000010")
			expect(h.calls).toEqual([`createWebhook:${channelId}`, "executeWebhook:Olive Owner"])
		}),
	)

	it.effect("a link saved with the old `enabled: false` default posts as the author", () =>
		Effect.gen(function* () {
			const h = harness({
				settings: { outboundIdentity: { enabled: false, strategy: "webhook", providers: {} } },
			})
			yield* h.post
			expect(h.calls).toEqual([`createWebhook:${channelId}`, "executeWebhook:Olive Owner"])
			const saved = h.saved[0]!.outboundIdentity as Record<string, unknown>
			expect("enabled" in saved).toBe(false)
		}),
	)

	it.effect("a link Discord refused posts as the bot, naming the author", () =>
		Effect.gen(function* () {
			const h = harness({ settings: { outboundIdentity: { strategy: "fallback_bot", providers: {} } } })
			yield* h.post
			expect(h.calls).toEqual(["createMessage"])
			expect(h.contents).toEqual(["**Olive Owner**\nhi"])
		}),
	)

	it.effect("a thread posts through its parent channel's webhook, into the thread", () =>
		Effect.gen(function* () {
			const parentId = ExternalChannelId.make("100000000000000099")
			const provisioned = harness({
				settings: identityOn({
					discord: { kind: "discord.webhook", webhookId: "700000000000000001", webhookToken: "t" },
				}),
				threadOf: parentId,
			})
			yield* provisioned.post
			expect(provisioned.calls).toEqual([`executeWebhook:Olive Owner@${channelId}`])
		}),
	)

	it.effect(
		"a thread never provisions its parent's webhook: it posts as the bot until the parent has one",
		() =>
			Effect.gen(function* () {
				const h = harness({
					settings: identityOn(),
					threadOf: ExternalChannelId.make("100000000000000099"),
				})
				yield* h.post
				expect(h.calls).toEqual(["createMessage"])
				expect(h.contents).toEqual(["**Olive Owner**\nhi"])
				expect(h.saved).toEqual([])
			}),
	)
})

describe("Discord bot attribution header", () => {
	const author = (name: string) => ({ name, avatarUrl: null })

	it("names the author on a first line", () => {
		expect(withAuthorHeader(author("Olive Owner"), "hi")).toBe("**Olive Owner**\nhi")
	})

	it("leaves the content alone without a name", () => {
		expect(withAuthorHeader(author("  "), "hi")).toBe("hi")
	})

	it("escapes markdown and keeps @ from pinging", () => {
		expect(withAuthorHeader(author("*@everyone*"), "hi")).toBe("**\\*@\u200beveryone\\***\nhi")
	})

	it("cuts a body the header would push past the limit", () => {
		const out = withAuthorHeader(author("Olive"), "x".repeat(2000))
		expect(out.length).toBe(2000)
		expect(out.startsWith("**Olive**\n")).toBe(true)
		expect(out.endsWith("…")).toBe(true)
	})
})

describe("Discord edits", () => {
	it.effect("an edited message keeps its attachment links", () =>
		Effect.gen(function* () {
			const sent: Array<string> = []
			const api = {
				updateMessage: (params: { content: string }) =>
					Effect.sync(() => void sent.push(params.content)).pipe(Effect.as({})),
			}
			const client = yield* makeDiscordClient.pipe(
				Effect.provide(
					Layer.mergeAll(
						Layer.succeed(
							Discord.DiscordApiClient,
							api as unknown as Discord.DiscordApiClient["Service"],
						),
						ConfigProvider.layer(ConfigProvider.fromUnknown({ DISCORD_BOT_TOKEN: "bot-token" })),
					),
				),
			)
			const refused = { outboundIdentity: { strategy: "fallback_bot", providers: {} } }
			yield* client.updateMessage(
				{ ...context, link: { ...context.link, settings: refused } },
				{
					externalMessageId: messageId,
					content: "edited",
					author: { name: "Olive Owner", avatarUrl: null },
					attachments: [
						{
							id: "00000000-0000-0000-0000-000000000001" as never,
							fileName: "plan.pdf",
							fileSize: 2048,
							publicUrl: "https://files.test/plan.pdf",
						},
					],
				},
			)
			expect(sent).toHaveLength(1)
			expect(sent[0]!.startsWith("**Olive Owner**\nedited")).toBe(true)
			expect(sent[0]).toContain("https://files.test/plan.pdf")
		}),
	)
})

describe("Discord posts only into the link's own guild", () => {
	const guildId = "200000000000000001"
	const message = {
		content: "hi",
		attachments: [],
		replyToExternalMessageId: undefined,
		author: { name: "Olive Owner", avatarUrl: null },
	}
	const botOnly = { outboundIdentity: { strategy: "fallback_bot", providers: {} } }

	const harness = (options: {
		readonly guildChannels: ReadonlyArray<string>
		readonly settings: Record<string, unknown>
	}) => {
		const calls: Array<string> = []
		const saved: Array<Record<string, unknown>> = []
		const api = {
			getChannelGuildId: (channel: string) => {
				calls.push(`getChannel:${channel}`)
				return Effect.succeed(
					options.guildChannels.includes(channel) ? guildId : "200000000000000999",
				)
			},
			createMessage: () => {
				calls.push("createMessage")
				return Effect.succeed("100000000000000030")
			},
		}
		const post = Effect.gen(function* () {
			const client = yield* makeDiscordClient
			return yield* client.postMessage(
				{
					link: { ...context.link, externalWorkspaceId: guildId, settings: options.settings },
					saveSettings: (settings) => Effect.sync(() => void saved.push(settings)),
				},
				message,
			)
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(
						Discord.DiscordApiClient,
						api as unknown as Discord.DiscordApiClient["Service"],
					),
					ConfigProvider.layer(ConfigProvider.fromUnknown({ DISCORD_BOT_TOKEN: "bot-token" })),
				),
			),
		)
		return { post, calls, saved }
	}

	it.effect("a channel of another guild is refused before anything is posted", () =>
		Effect.gen(function* () {
			const h = harness({ guildChannels: ["100000000000000077"], settings: botOnly })
			const error = yield* Effect.flip(h.post)
			expect(error).toMatchObject({ _tag: "ChatSyncProviderApiError", detail: NOT_IN_WORKSPACE })
			expect(h.calls).toEqual([`getChannel:${channelId}`])
			expect(h.saved).toEqual([])
		}),
	)

	it.effect("the first post checks once and remembers it; a checked link posts straight away", () =>
		Effect.gen(function* () {
			const first = harness({ guildChannels: [channelId], settings: botOnly })
			yield* first.post
			expect(first.calls).toEqual([`getChannel:${channelId}`, "createMessage"])
			expect(first.saved).toEqual([{ ...botOnly, [GUILD_VERIFIED]: true }])

			const checked = harness({ guildChannels: [], settings: { ...botOnly, [GUILD_VERIFIED]: true } })
			yield* checked.post
			expect(checked.calls).toEqual(["createMessage"])
		}),
	)
})
