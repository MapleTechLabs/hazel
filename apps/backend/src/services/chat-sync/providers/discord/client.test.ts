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
import type { ChatSyncLinkContext } from "../../provider"
import { makeDiscordClient } from "./client"

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
		outboundIdentity: { enabled: true, strategy: "webhook", providers },
	})

	/** The client over a fake Discord API; records calls and the settings the client saved. */
	const harness = (options: {
		readonly settings: Record<string, unknown>
		readonly createWebhook?: () => Effect.Effect<
			{ webhookId: string; webhookToken: string },
			Discord.DiscordApiError
		>
		readonly executeWebhook?: () => Effect.Effect<string, Discord.DiscordApiError>
	}) => {
		const calls: Array<string> = []
		const saved: Array<Record<string, unknown>> = []
		const api = {
			createWebhook: () => {
				calls.push("createWebhook")
				return (
					options.createWebhook?.() ??
					Effect.succeed({ webhookId: "700000000000000001", webhookToken: "t" })
				)
			},
			executeWebhookMessage: (params: { username: string }) => {
				calls.push(`executeWebhook:${params.username}`)
				return options.executeWebhook?.() ?? Effect.succeed("100000000000000010")
			},
			createMessage: () => {
				calls.push("createMessage")
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
					link: { ...context.link, settings: options.settings },
					saveSettings: (settings) => Effect.sync(() => void saved.push(settings)),
				},
				message,
			)
		}).pipe(Effect.provide(layer))
		return { post, calls, saved }
	}

	const permissionOf = (settings: Record<string, unknown> | undefined) =>
		(settings?.webhookPermission as { status: string } | undefined)?.status

	it.effect("provisions a webhook on first use, saves it, and posts as the author", () =>
		Effect.gen(function* () {
			const h = harness({ settings: identityOn() })
			expect(yield* h.post).toBe("100000000000000010")
			expect(h.calls).toEqual(["createWebhook", "executeWebhook:Olive Owner"])
			expect(permissionOf(h.saved[0])).toBe("allowed")
			expect(
				(h.saved[0]?.outboundIdentity as { providers: Record<string, unknown> }).providers.discord,
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
			expect(h.calls).toEqual(["createWebhook", "createMessage"])
			expect(permissionOf(h.saved[0])).toBe("denied")
			expect((h.saved[0]?.outboundIdentity as { strategy: string }).strategy).toBe("fallback_bot")
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

	it.effect("identity off posts as the bot", () =>
		Effect.gen(function* () {
			const h = harness({ settings: {} })
			yield* h.post
			expect(h.calls).toEqual(["createMessage"])
		}),
	)
})
