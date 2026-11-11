import { ChannelId, ChannelWebhookId, GitHubSubscriptionId, RssSubscriptionId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { orgOfChannel } from "~/db/routing-hints"
import { toDate } from "~/lib/utils"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { Message } from "./message"
import { INTEGRATION_CONFIG, Provider, RowKind } from "./model"

const msOf = (date: Parameters<typeof toDate>[0] | null) => (date ? toDate(date).getTime() : null)

// LISTS (`listChannelWebhooksMutation`, `listRssSubscriptionsMutation`, `listGitHubSubscriptionsMutation`)

export const ListWebhooks = Command.define("ListWebhooks", {
	args: { channelId: ChannelId, version: Schema.Number },
	messages: [Message.SucceededListWebhooks, Message.FailedList],
	execute: ({ channelId, version }) =>
		HazelRpc.use((rpc) => rpc("channelWebhook.list", { channelId })).pipe(
			Effect.map((response) =>
				Message.SucceededListWebhooks({
					version,
					webhooks: response.data.map((webhook) => ({
						id: webhook.id,
						name: webhook.name,
						avatarUrl: webhook.avatarUrl ?? null,
						tokenSuffix: webhook.tokenSuffix,
						isEnabled: webhook.isEnabled,
						lastUsedAtMs: msOf(webhook.lastUsedAt),
					})),
				}),
			),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(
						Message.FailedList({ kind: "webhook", version, reason: "ChannelNotFound" }),
					),
			}),
			catchCommon((reason) => Message.FailedList({ kind: "webhook", version, reason })),
		),
})

export const ListRss = Command.define("ListRss", {
	args: { channelId: ChannelId, version: Schema.Number },
	messages: [Message.SucceededListRss, Message.FailedList],
	execute: ({ channelId, version }) =>
		HazelRpc.use((rpc) => rpc("rssSubscription.list", { channelId })).pipe(
			Effect.map((response) =>
				Message.SucceededListRss({
					version,
					feeds: response.data.map((feed) => ({
						id: feed.id,
						feedUrl: feed.feedUrl,
						feedTitle: feed.feedTitle,
						feedIconUrl: feed.feedIconUrl,
						consecutiveErrors: feed.consecutiveErrors,
						isEnabled: feed.isEnabled,
						pollingIntervalMinutes: feed.pollingIntervalMinutes,
					})),
				}),
			),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedList({ kind: "rss", version, reason: "ChannelNotFound" })),
			}),
			catchCommon((reason) => Message.FailedList({ kind: "rss", version, reason })),
		),
})

export const ListGitHub = Command.define("ListGitHub", {
	args: { channelId: ChannelId, version: Schema.Number },
	messages: [Message.SucceededListGitHub, Message.FailedList],
	execute: ({ channelId, version }) =>
		HazelRpc.use((rpc) => rpc("githubSubscription.list", { channelId })).pipe(
			Effect.map((response) =>
				Message.SucceededListGitHub({
					version,
					repos: response.data.map((repo) => ({
						id: repo.id,
						repositoryFullName: repo.repositoryFullName,
						enabledEvents: [...repo.enabledEvents],
						branchFilter: repo.branchFilter,
						isEnabled: repo.isEnabled,
					})),
				}),
			),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(
						Message.FailedList({ kind: "github", version, reason: "ChannelNotFound" }),
					),
			}),
			catchCommon((reason) => Message.FailedList({ kind: "github", version, reason })),
		),
})

// ROW ACTIONS (each row's toggle and delete, with its own messages)

/** Each row kind's success copy; update has the failure copy. */
const rowCopy = {
	webhook: {
		toggled: (isEnabled: boolean) => (isEnabled ? "Webhook enabled" : "Webhook disabled"),
		deleted: "Webhook deleted",
	},
	rss: {
		toggled: (isEnabled: boolean) => (isEnabled ? "Feed resumed" : "Feed paused"),
		deleted: "Feed removed",
	},
	github: {
		toggled: (isEnabled: boolean) => (isEnabled ? "Subscription enabled" : "Subscription disabled"),
		deleted: "Subscription removed",
	},
} as const

const rowRequest = (kind: RowKind, id: string, channelId: ChannelId, isEnabled: boolean | null) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const organizationId = orgOfChannel(channelId)
		if (kind === "webhook") {
			const webhookId = ChannelWebhookId.make(id)
			return isEnabled === null
				? yield* client("channelWebhook.delete", { id: webhookId, organizationId })
				: yield* client("channelWebhook.update", { id: webhookId, organizationId, isEnabled })
		}
		if (kind === "rss") {
			const rssId = RssSubscriptionId.make(id)
			return isEnabled === null
				? yield* client("rssSubscription.delete", { id: rssId, organizationId })
				: yield* client("rssSubscription.update", { id: rssId, organizationId, isEnabled })
		}
		const githubId = GitHubSubscriptionId.make(id)
		return isEnabled === null
			? yield* client("githubSubscription.delete", { id: githubId, organizationId })
			: yield* client("githubSubscription.update", { id: githubId, organizationId, isEnabled })
	})

/** `isEnabled: null` deletes the row; otherwise it sets the row's enabled flag. */
export const RunRowAction = Command.define("RunRowAction", {
	args: {
		kind: RowKind,
		id: Schema.String,
		channelId: ChannelId,
		isEnabled: Schema.NullOr(Schema.Boolean),
	},
	messages: [Message.SucceededRowAction, Message.FailedRowAction],
	execute: ({ kind, id, channelId, isEnabled }) => {
		const notFound = () => Effect.succeed(Message.FailedRowAction({ kind, id, reason: "NotFound" }))
		return rowRequest(kind, id, channelId, isEnabled).pipe(
			Effect.as(
				Message.SucceededRowAction({
					kind,
					id,
					successMessage:
						isEnabled === null ? rowCopy[kind].deleted : rowCopy[kind].toggled(isEnabled),
				}),
			),
			Effect.catchTags({
				ChannelWebhookNotFoundError: notFound,
				RssSubscriptionNotFoundError: notFound,
				GitHubSubscriptionNotFoundError: notFound,
			}),
			catchCommon((reason) => Message.FailedRowAction({ kind, id, reason })),
		)
	},
})

// INTEGRATION CARDS

/** `getProviderIconUrl(provider)`: Brandfetch at 64 px, dark theme. */
export const providerLogoUrl = (domain: string, type: "icon" | "symbol", theme: "light" | "dark" = "dark") =>
	`https://cdn.brandfetch.io/${domain}/w/64/h/64/theme/${theme}/${type}?token=1id0IQ-4i8Z46-n-DfQ`

export const PROVIDER_LOGOS: Readonly<Record<Provider, string>> = {
	openstatus: providerLogoUrl("openstatus.dev", "icon"),
	railway: providerLogoUrl("railway.com", "icon"),
}

export const ConnectProvider = Command.define("ConnectProvider", {
	args: { channelId: ChannelId, provider: Provider },
	messages: [Message.SucceededConnectProvider, Message.FailedConnectProvider],
	execute: ({ channelId, provider }) => {
		const config = INTEGRATION_CONFIG[provider]
		return HazelRpc.use((rpc) =>
			rpc("channelWebhook.create", {
				channelId,
				name: config.name,
				description: config.webhookDescription,
				avatarUrl: PROVIDER_LOGOS[provider],
				integrationProvider: provider,
			}),
		).pipe(
			Effect.map((result) => Message.SucceededConnectProvider({ provider, token: result.token })),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedConnectProvider({ provider, reason: "ChannelNotFound" })),
			}),
			catchCommon((reason) => Message.FailedConnectProvider({ provider, reason })),
		)
	},
})

/** The provider card's Enable/Disable and Delete (`isEnabled: null`). */
export const RunProviderAction = Command.define("RunProviderAction", {
	args: {
		provider: Provider,
		webhookId: ChannelWebhookId,
		channelId: ChannelId,
		isEnabled: Schema.NullOr(Schema.Boolean),
	},
	messages: [Message.SucceededProviderAction, Message.FailedProviderAction],
	execute: ({ provider, webhookId, channelId, isEnabled }) => {
		const name = INTEGRATION_CONFIG[provider].name
		const organizationId = orgOfChannel(channelId)
		return HazelRpc.use((rpc) =>
			isEnabled === null
				? rpc("channelWebhook.delete", { id: webhookId, organizationId })
				: rpc("channelWebhook.update", { id: webhookId, organizationId, isEnabled }),
		).pipe(
			Effect.as(
				Message.SucceededProviderAction({
					provider,
					successMessage:
						isEnabled === null
							? `${name} disconnected`
							: `${name} ${isEnabled ? "enabled" : "disabled"}`,
				}),
			),
			Effect.catchTags({
				ChannelWebhookNotFoundError: () =>
					Effect.succeed(Message.FailedProviderAction({ provider, reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedProviderAction({ provider, reason })),
		)
	},
})

export const WaitForConfirmReset = Command.define("WaitForConfirmReset", {
	args: { provider: Provider, version: Schema.Number },
	messages: [Message.ElapsedConfirmDelay],
	execute: ({ provider, version }) =>
		Effect.sleep(Duration.seconds(3)).pipe(Effect.as(Message.ElapsedConfirmDelay({ provider, version }))),
})

// CREATE WEBHOOK FORM

export const CreateWebhook = Command.define("CreateWebhook", {
	args: { channelId: ChannelId, name: Schema.String, description: Schema.String, avatarUrl: Schema.String },
	messages: [Message.SucceededCreateWebhook, Message.FailedCreateWebhook],
	execute: ({ channelId, name, description, avatarUrl }) =>
		HazelRpc.use((rpc) =>
			rpc("channelWebhook.create", {
				channelId,
				name,
				description: description || undefined,
				avatarUrl: avatarUrl || undefined,
			}),
		).pipe(
			Effect.map((result) =>
				Message.SucceededCreateWebhook({ token: result.token, webhookUrl: result.webhookUrl }),
			),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedCreateWebhook({ reason: "ChannelNotFound" })),
			}),
			catchCommon((reason) => Message.FailedCreateWebhook({ reason })),
		),
})

// CLIPBOARD

/** `navigator.clipboard.writeText` rejected (permission, insecure context). */
class ClipboardWriteError extends Schema.TaggedError<ClipboardWriteError>()("ClipboardWriteError", {}) {}

export const CopyText = Command.define("CopyText", {
	args: {
		id: Schema.String,
		value: Schema.String,
		successMessage: Schema.String,
		failureMessage: Schema.String,
	},
	messages: [Message.SucceededCopy, Message.FailedCopy],
	execute: ({ id, value, successMessage, failureMessage }) =>
		Effect.tryPromise({
			try: () => navigator.clipboard.writeText(value),
			catch: () => new ClipboardWriteError(),
		}).pipe(
			Effect.as(Message.SucceededCopy({ id, successMessage })),
			Effect.catchTags({
				ClipboardWriteError: () => Effect.succeed(Message.FailedCopy({ failureMessage })),
			}),
		),
})

export const WaitForCopiedReset = Command.define("WaitForCopiedReset", {
	args: { id: Schema.String },
	messages: [Message.ElapsedCopiedDelay],
	execute: ({ id }) =>
		Effect.sleep(Duration.seconds(2)).pipe(Effect.as(Message.ElapsedCopiedDelay({ id }))),
})
