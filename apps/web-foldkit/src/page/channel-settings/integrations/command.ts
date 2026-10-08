import { ChannelId, ChannelWebhookId, GitHubSubscriptionId, RssSubscriptionId } from "@hazel/schema"
import { type Cause, Duration, Effect, Exit, Schema } from "effect"
import { Command } from "foldkit"
import { toDate } from "~/lib/utils"
import { HazelRpc } from "../../../rpc"
import { type ErrorHandlers, failureToast } from "../../../ui/toast-exit"
import { Message } from "./message"
import { INTEGRATION_CONFIG, Provider, RowKind } from "./model"

const channelNotFound: ErrorHandlers = {
	ChannelNotFoundError: {
		title: "Channel not found",
		description: "This channel may have been deleted.",
		isRetryable: false,
	},
}

const failure = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers) => {
	const toast = failureToast(cause, handlers)
	return { title: toast.title, description: toast.description }
}

const msOf = (date: Parameters<typeof toDate>[0] | null) => (date ? toDate(date).getTime() : null)

// LISTS (`listChannelWebhooksMutation`, `listRssSubscriptionsMutation`, `listGitHubSubscriptionsMutation`)

export const ListWebhooks = Command.define("ListWebhooks", {
	args: { channelId: ChannelId, version: Schema.Number },
	messages: [Message.SucceededListWebhooks, Message.FailedList],
	execute: ({ channelId, version }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("channelWebhook.list", { channelId }))
			return Exit.match(exit, {
				onSuccess: (response) =>
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
				onFailure: (cause) =>
					Message.FailedList({ list: "webhooks", version, ...failure(cause, channelNotFound) }),
			})
		}),
})

export const ListRss = Command.define("ListRss", {
	args: { channelId: ChannelId, version: Schema.Number },
	messages: [Message.SucceededListRss, Message.FailedList],
	execute: ({ channelId, version }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("rssSubscription.list", { channelId }))
			return Exit.match(exit, {
				onSuccess: (response) =>
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
				onFailure: (cause) =>
					Message.FailedList({ list: "rss", version, ...failure(cause, channelNotFound) }),
			})
		}),
})

export const ListGitHub = Command.define("ListGitHub", {
	args: { channelId: ChannelId, version: Schema.Number },
	messages: [Message.SucceededListGitHub, Message.FailedList],
	execute: ({ channelId, version }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("githubSubscription.list", { channelId }))
			return Exit.match(exit, {
				onSuccess: (response) =>
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
				onFailure: (cause) =>
					Message.FailedList({ list: "github", version, ...failure(cause, channelNotFound) }),
			})
		}),
})

// ROW ACTIONS (each row's toggle and delete, with its own messages)

const notFound = (title: string, description: string): ErrorHandlers[string] => ({
	title,
	description,
	isRetryable: false,
})

const rowCopy = {
	webhook: {
		tag: "ChannelWebhookNotFoundError",
		title: "Webhook not found",
		toggled: (isEnabled: boolean) => (isEnabled ? "Webhook enabled" : "Webhook disabled"),
		deleted: "Webhook deleted",
		noun: "webhook",
	},
	rss: {
		tag: "RssSubscriptionNotFoundError",
		title: "Subscription not found",
		toggled: (isEnabled: boolean) => (isEnabled ? "Feed resumed" : "Feed paused"),
		deleted: "Feed removed",
		noun: "subscription",
	},
	github: {
		tag: "GitHubSubscriptionNotFoundError",
		title: "Subscription not found",
		toggled: (isEnabled: boolean) => (isEnabled ? "Subscription enabled" : "Subscription disabled"),
		deleted: "Subscription removed",
		noun: "subscription",
	},
} as const

const rowRequest = (kind: RowKind, id: string, isEnabled: boolean | null) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		if (kind === "webhook") {
			const webhookId = ChannelWebhookId.make(id)
			return isEnabled === null
				? yield* client("channelWebhook.delete", { id: webhookId })
				: yield* client("channelWebhook.update", { id: webhookId, isEnabled })
		}
		if (kind === "rss") {
			const rssId = RssSubscriptionId.make(id)
			return isEnabled === null
				? yield* client("rssSubscription.delete", { id: rssId })
				: yield* client("rssSubscription.update", { id: rssId, isEnabled })
		}
		const githubId = GitHubSubscriptionId.make(id)
		return isEnabled === null
			? yield* client("githubSubscription.delete", { id: githubId })
			: yield* client("githubSubscription.update", { id: githubId, isEnabled })
	})

/** `isEnabled: null` deletes the row; otherwise it sets the row's enabled flag. */
export const RunRowAction = Command.define("RunRowAction", {
	args: { kind: RowKind, id: Schema.String, isEnabled: Schema.NullOr(Schema.Boolean) },
	messages: [Message.SucceededRowAction, Message.FailedRowAction],
	execute: ({ kind, id, isEnabled }) =>
		Effect.gen(function* () {
			const copy = rowCopy[kind]
			const exit = yield* Effect.exit(rowRequest(kind, id, isEnabled))
			const description =
				isEnabled === null
					? `This ${copy.noun} may have already been deleted.`
					: `This ${copy.noun} may have been deleted.`
			return Exit.match(exit, {
				onSuccess: () =>
					Message.SucceededRowAction({
						kind,
						id,
						successMessage: isEnabled === null ? copy.deleted : copy.toggled(isEnabled),
					}),
				onFailure: (cause) =>
					Message.FailedRowAction({
						kind,
						id,
						...failure(cause, { [copy.tag]: notFound(copy.title, description) }),
					}),
			})
		}),
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
	execute: ({ channelId, provider }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const config = INTEGRATION_CONFIG[provider]
			const exit = yield* Effect.exit(
				client("channelWebhook.create", {
					channelId,
					name: config.name,
					description: config.webhookDescription,
					avatarUrl: PROVIDER_LOGOS[provider],
					integrationProvider: provider,
				}),
			)
			return Exit.match(exit, {
				onSuccess: (result) => Message.SucceededConnectProvider({ provider, token: result.token }),
				onFailure: (cause) =>
					Message.FailedConnectProvider({ provider, ...failure(cause, channelNotFound) }),
			})
		}),
})

/** The provider card's Enable/Disable and Delete (`isEnabled: null`). */
export const RunProviderAction = Command.define("RunProviderAction", {
	args: { provider: Provider, webhookId: ChannelWebhookId, isEnabled: Schema.NullOr(Schema.Boolean) },
	messages: [Message.SucceededProviderAction, Message.FailedProviderAction],
	execute: ({ provider, webhookId, isEnabled }) =>
		Effect.gen(function* () {
			const name = INTEGRATION_CONFIG[provider].name
			const exit = yield* Effect.exit(rowRequest("webhook", webhookId, isEnabled))
			return Exit.match(exit, {
				onSuccess: () =>
					Message.SucceededProviderAction({
						provider,
						isDelete: isEnabled === null,
						successMessage:
							isEnabled === null
								? `${name} disconnected`
								: `${name} ${isEnabled ? "enabled" : "disabled"}`,
					}),
				onFailure: (cause) =>
					Message.FailedProviderAction({
						provider,
						isDelete: isEnabled === null,
						...failure(cause, {
							ChannelWebhookNotFoundError: notFound(
								"Webhook not found",
								"This webhook may have been deleted.",
							),
						}),
					}),
			})
		}),
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
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(
				client("channelWebhook.create", {
					channelId,
					name,
					description: description || undefined,
					avatarUrl: avatarUrl || undefined,
				}),
			)
			return Exit.match(exit, {
				onSuccess: (result) =>
					Message.SucceededCreateWebhook({ token: result.token, webhookUrl: result.webhookUrl }),
				onFailure: (cause) => Message.FailedCreateWebhook(failure(cause, channelNotFound)),
			})
		}),
})

// CLIPBOARD

export const CopyText = Command.define("CopyText", {
	args: {
		id: Schema.String,
		value: Schema.String,
		successMessage: Schema.String,
		failureMessage: Schema.String,
	},
	messages: [Message.CompletedCopy],
	execute: ({ id, value, successMessage, failureMessage }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(value)).pipe(
			Effect.match({
				onSuccess: () => Message.CompletedCopy({ id, isCopied: true, toastTitle: successMessage }),
				onFailure: () => Message.CompletedCopy({ id, isCopied: false, toastTitle: failureMessage }),
			}),
		),
})

export const WaitForCopiedReset = Command.define("WaitForCopiedReset", {
	args: { id: Schema.String },
	messages: [Message.ElapsedCopiedDelay],
	execute: ({ id }) =>
		Effect.sleep(Duration.seconds(2)).pipe(Effect.as(Message.ElapsedCopiedDelay({ id }))),
})
