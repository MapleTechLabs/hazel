// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web's chat sync hosts: `ChatSyncBackend` for the settings pages and `ChatMigrationBackend` for
 * the migration wizard, over `HazelRpc` and the HTTP API client (today's `chat-sync/{rpc,email,
 * add-connection}.ts` and `shared/chat-migration/command.ts`).
 */
import { HazelRpc } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import { ClipboardWeb } from "@hazel/client-data/web"
import type { ChatSyncChannelLink, ChatSyncConnection } from "@hazel/domain/models"
import { EMAIL_CHAT_SYNC_PROVIDER, EmailMailboxMetadata, EmailMailboxSettings } from "@hazel/domain/rpc"
import type { OrganizationId } from "@hazel/schema"
import {
	ChatMigrationBackend,
	type ListFailure,
	type OAuthReturn,
} from "@hazel/shared-screens/chat/migration/backend"
import type { ExternalChannel, Problem } from "@hazel/shared-screens/chat/migration/model"
import { ChatSyncBackend } from "@hazel/shared-screens/settings/chat-sync/backend"
import {
	type ChatSyncProvider,
	type CommonReason,
	type Connection,
	type ConnectionStatus,
	type EmailInbox,
	isChatSyncProvider,
	PROVIDERS,
	type Workspace,
} from "@hazel/shared-screens/settings/chat-sync/model"
import { Cause, Effect, Layer, Option, Predicate, Schema } from "effect"
import { IntegrationResourceError } from "@hazel/domain/http"
import { commonMessage, isRetryableReason, reasonOfUnknown } from "~/lib/error-messages"
import { toDate } from "~/lib/utils"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

/** A failure already in the page's words: a named string, or a wizard `Problem` (no `_tag`). */
const isOwn = (error: unknown): boolean => typeof error === "string" || !Predicate.hasProperty(error, "_tag")

/** Every failure as the page's words: its own named ones, else a common reason. */
const settle =
	<Own>() =>
	<A, R>(effect: Effect.Effect<A, unknown, R>): Effect.Effect<A, Own | CommonReason, R> =>
		Effect.catchCause(effect, (cause) =>
			Option.match(Cause.findErrorOption(cause), {
				onSome: (error) => Effect.fail(isOwn(error) ? (error as Own) : reasonOfUnknown(error)),
				onNone: () =>
					Cause.hasInterruptsOnly(cause)
						? Effect.interrupt
						: Effect.logError("chat sync request failed", cause).pipe(
								Effect.andThen(Effect.fail("Unexpected" as const)),
							),
			}),
		)

const isStatus = Schema.is(Schema.Literals(["active", "paused", "error", "disabled"]))
const statusOf = (status: string): ConnectionStatus => (isStatus(status) ? status : "active")
const decodeMetadata = Schema.decodeUnknownOption(EmailMailboxMetadata)
const decodeEmailSettings = Schema.decodeUnknownOption(EmailMailboxSettings)

/** An email inbox from its connection and its one channel link (`settings.email`). */
export const emailInboxOf = (
	connection: ChatSyncConnection.Type,
	link: ChatSyncChannelLink.Type | undefined,
	inboundAddress: string | null = Option.getOrNull(
		Option.map(decodeMetadata(connection.metadata), (decoded) => decoded.inboundAddress),
	),
): EmailInbox => {
	const settings = Option.flatMap(Option.fromNullishOr(link?.settings), (raw) =>
		decodeEmailSettings(raw.email),
	)
	return {
		id: connection.id,
		displayName:
			connection.externalWorkspaceName ||
			Option.getOrElse(
				Option.map(settings, (email) => email.displayName),
				() => "Email inbox",
			),
		status: statusOf(connection.status),
		errorMessage: connection.errorMessage ?? null,
		inboundAddress,
		supportAddress: Option.getOrNull(
			Option.flatMap(settings, (email) => Option.fromNullishOr(email.replyTo)),
		),
		hazelChannelId: link?.hazelChannelId ?? null,
	}
}

/** A Slack or Discord connection; a provider this client does not know is not listed. */
const connectionOf = (connection: ChatSyncConnection.Type): ReadonlyArray<Connection> => {
	const provider = connection.provider
	if (!isChatSyncProvider(provider)) return []
	return [
		{
			id: connection.id,
			provider,
			displayName: connection.externalWorkspaceName || PROVIDERS[provider].workspaceTitle,
			status: statusOf(connection.status),
			externalWorkspaceId: connection.externalWorkspaceId,
			errorMessage: connection.errorMessage ?? null,
			lastSyncedAtMs: connection.lastSyncedAt ? toDate(connection.lastSyncedAt).getTime() : null,
		},
	]
}

/** The org's Slack install: its workspace and the channels the bot can see. */
const slackInstall = (client: HazelApiClient["Service"], orgId: OrganizationId) =>
	client["integration-resources"].getSlackChannels({ params: { orgId } })

const fetchWorkspaces = (
	client: HazelApiClient["Service"],
	orgId: OrganizationId,
	provider: ChatSyncProvider,
): Effect.Effect<ReadonlyArray<Workspace>, unknown> =>
	provider === "discord"
		? client["integration-resources"]
				.getDiscordGuilds({ params: { orgId } })
				.pipe(
					Effect.map((response) =>
						response.guilds.map(({ id, name, owner }) => ({ id, name, owner })),
					),
				)
		: slackInstall(client, orgId).pipe(
				Effect.map(({ workspace }) => [
					{ id: workspace.id, name: workspace.name ?? "Slack Workspace", owner: false },
				]),
			)

/** Slack's channels only while the install is still this workspace's (else they never sync here). */
const fetchChannels = (
	client: HazelApiClient["Service"],
	orgId: OrganizationId,
	provider: ChatSyncProvider,
	workspaceId: string,
): Effect.Effect<ReadonlyArray<ExternalChannel>, unknown> =>
	provider === "discord"
		? client["integration-resources"]
				.getDiscordGuildChannels({ params: { orgId, guildId: workspaceId } })
				.pipe(
					Effect.map((response) =>
						response.channels.map(({ id, name }) => ({ id, name, isPrivate: false })),
					),
				)
		: slackInstall(client, orgId).pipe(
				Effect.flatMap((response) =>
					response.workspace.id === workspaceId
						? Effect.succeed(
								response.channels.map(({ id, name, isPrivate }) => ({ id, name, isPrivate })),
							)
						: Effect.fail(
								new IntegrationResourceError({
									url: "slack://conversations",
									message: "Slack is installed in another workspace",
									provider: "slack",
								}),
							),
				),
			)

const OAUTH_KEYS = ["connection_status", "provider", "error_code"] as const

const readReturn = () => {
	const url = new URL(globalThis.location?.href ?? "http://localhost/")
	const status = url.searchParams.get("connection_status")
	const provider = url.searchParams.get("provider")
	return { url, status, provider: provider !== null && isChatSyncProvider(provider) ? provider : null }
}

const copyText = (clipboard: Clipboard["Service"], text: string) =>
	clipboard.write(text).pipe(Effect.mapError(() => "CopyFailed" as const))

export const chatSyncBackendLayer = Layer.effect(
	ChatSyncBackend,
	Effect.gen(function* () {
		const rpc = yield* HazelRpc
		const api = yield* HazelApiClient
		const clipboard = yield* Clipboard
		return {
			list: (organizationId) =>
				Effect.gen(function* () {
					const response = yield* rpc("chatSync.connection.list", { organizationId })
					const mailboxes = response.data.filter(
						(each) => each.provider === EMAIL_CHAT_SYNC_PROVIDER,
					)
					// Each inbox's one link holds its channel and reply-to; one deleted meanwhile has none.
					const emailInboxes = yield* Effect.forEach(
						mailboxes,
						(connection) =>
							rpc("chatSync.channelLink.list", {
								organizationId,
								syncConnectionId: connection.id,
							}).pipe(
								Effect.map((links) => emailInboxOf(connection, links.data[0])),
								Effect.catchTags({
									ChatSyncConnectionNotFoundError: () =>
										Effect.succeed(emailInboxOf(connection, undefined)),
								}),
							),
						{ concurrency: "unbounded" },
					)
					return { connections: response.data.flatMap(connectionOf), emailInboxes }
				}).pipe(settle<never>()),
			listWorkspaces: (organizationId, provider) =>
				fetchWorkspaces(api, organizationId, provider).pipe(
					Effect.catchTags({
						IntegrationNotConnectedForPreviewError: () => Effect.fail("NotConnected" as const),
						IntegrationResourceError: () => Effect.fail("ProviderError" as const),
					}),
					settle<"NotConnected" | "ProviderError">(),
				),
			createConnection: (payload) =>
				rpc("chatSync.connection.create", payload).pipe(
					Effect.asVoid,
					Effect.catchTags({
						ChatSyncConnectionExistsError: () => Effect.fail("AlreadyExists" as const),
						ChatSyncIntegrationNotConnectedError: () => Effect.fail("NotConnected" as const),
					}),
					settle<"AlreadyExists" | "NotConnected">(),
				),
			deleteConnection: (organizationId, syncConnectionId) =>
				rpc("chatSync.connection.delete", { organizationId, syncConnectionId }).pipe(
					Effect.asVoid,
					Effect.catchTags({
						ChatSyncConnectionNotFoundError: () => Effect.fail("NotFound" as const),
					}),
					settle<"NotFound">(),
				),
			createEmailInbox: ({ organizationId, displayName, supportAddress, hazelChannelId }) => {
				const payload = { organizationId, displayName, hazelChannelId }
				return rpc(
					"chatSync.email.create",
					supportAddress === null ? payload : { ...payload, supportAddress },
				).pipe(
					Effect.map((response) =>
						emailInboxOf(response.connection, response.link, response.inboundAddress),
					),
					Effect.catchTags({
						ChannelNotFoundError: () => Effect.fail("ChannelNotFound" as const),
						ChatSyncChannelLinkExistsError: () => Effect.fail("ChannelLinked" as const),
					}),
					settle<"ChannelNotFound" | "ChannelLinked">(),
				)
			},
			updateEmailInbox: (payload) =>
				rpc("chatSync.email.update", payload).pipe(
					Effect.asVoid,
					Effect.catchTags({
						ChatSyncConnectionNotFoundError: () => Effect.fail("NotFound" as const),
					}),
					settle<"NotFound">(),
				),
			hasMigrationReturn: Effect.sync(() => {
				const { status, provider } = readReturn()
				return status !== null && provider !== null
			}),
			copy: (text) => copyText(clipboard, text),
		}
	}),
)

const commonProblem = (reason: CommonReason): Problem => {
	const message = commonMessage(reason)
	return {
		title: message.title,
		description: message.description ?? "",
		canRetry: isRetryableReason(reason),
	}
}

/** A failure the wizard names itself, or the common reason's copy. */
const problemOf = (failure: Problem | CommonReason): Problem =>
	typeof failure === "string" ? commonProblem(failure) : failure

export const chatMigrationBackendLayer = Layer.effect(
	ChatMigrationBackend,
	Effect.gen(function* () {
		const rpc = yield* HazelRpc
		const api = yield* HazelApiClient
		return {
			// Read once: a reload must not resume (or toast) the same return again.
			readOAuthReturn: Effect.sync((): OAuthReturn => {
				const { url, status, provider } = readReturn()
				if (status === null || provider === null) return { _tag: "None" }
				const errorCode = url.searchParams.get("error_code")
				for (const key of OAUTH_KEYS) url.searchParams.delete(key)
				globalThis.history?.replaceState(
					globalThis.history.state,
					"",
					url.pathname + url.search + url.hash,
				)
				return status === "success"
					? { _tag: "Returned", provider }
					: { _tag: "Refused", provider, errorCode }
			}),
			listWorkspaces: (organizationId, provider) =>
				fetchWorkspaces(api, organizationId, provider).pipe(
					Effect.catchTags({
						IntegrationNotConnectedForPreviewError: () => Effect.fail("NotConnected" as const),
						IntegrationResourceError: () =>
							Effect.fail<Problem>({
								title: `Could not load ${PROVIDERS[provider].name} ${PROVIDERS[provider].workspacesResource}`,
								description: PROVIDERS[provider].copy.providerError,
								canRetry: true,
							}),
					}),
					settle<"NotConnected" | Problem>(),
					Effect.mapError((failure): ListFailure =>
						failure === "NotConnected"
							? { _tag: "NotConnected" }
							: { _tag: "Problem", problem: problemOf(failure) },
					),
				),
			prepare: (organizationId, provider, workspace) => {
				const { name, copy } = PROVIDERS[provider]
				return Effect.gen(function* () {
					const existing = (yield* rpc("chatSync.connection.list", { organizationId })).data.find(
						(connection) =>
							connection.provider === provider &&
							connection.externalWorkspaceId === workspace.id,
					)
					const syncConnectionId =
						existing?.id ??
						(yield* rpc("chatSync.connection.create", {
							organizationId,
							provider,
							externalWorkspaceId: workspace.id,
							externalWorkspaceName: workspace.name,
						})).data.id
					const channels = yield* fetchChannels(api, organizationId, provider, workspace.id)
					return {
						syncConnectionId,
						channels: [...channels].sort((a, b) => a.name.localeCompare(b.name)),
					}
				}).pipe(
					Effect.catchTags({
						ChatSyncConnectionExistsError: () =>
							Effect.fail<Problem>({
								title: "Already connected",
								description: copy.alreadyConnected,
								canRetry: true,
							}),
						ChatSyncIntegrationNotConnectedError: () =>
							Effect.fail<Problem>({
								title: `${name} not connected`,
								description: copy.createNotConnected,
								canRetry: false,
							}),
						IntegrationNotConnectedForPreviewError: () =>
							Effect.fail<Problem>({
								title: `Connect ${name} first`,
								description: copy.notConnected("channels"),
								canRetry: false,
							}),
						IntegrationResourceError: () =>
							Effect.fail<Problem>({
								title: `Could not load ${name} channels`,
								description: copy.providerError,
								canRetry: true,
							}),
					}),
					settle<Problem>(),
					Effect.mapError(problemOf),
				)
			},
			authorizationUrl: (organizationId, provider, returnTo) =>
				api.integrations
					.getOAuthUrl({
						params: { orgId: organizationId, provider },
						query: { level: "organization", returnTo },
					})
					.pipe(
						Effect.map((response) => response.authorizationUrl),
						Effect.catchTags({
							UnsupportedProviderError: () =>
								Effect.fail<Problem>({
									title: `${PROVIDERS[provider].name} is not available`,
									description: "This Hazel deployment has no app set up for it.",
									canRetry: false,
								}),
						}),
						settle<Problem>(),
						Effect.mapError(problemOf),
					),
			redirect: (url) => Effect.sync(() => globalThis.location?.assign(url)),
			migrate: (payload) =>
				rpc("chatSync.migrate", payload).pipe(
					Effect.map((response) => ({
						linked: response.linked.length,
						created: response.linked.filter((link) => link.createdChannel).length,
						skipped: response.skipped.length,
						takenElsewhere: response.takenElsewhere.length,
					})),
					Effect.catchTags({
						ChatSyncConnectionNotFoundError: () =>
							Effect.fail<Problem>({
								title: "Connection not found",
								description: "The connection was removed meanwhile. Start again.",
								canRetry: false,
							}),
					}),
					settle<Problem>(),
					Effect.mapError(problemOf),
				),
		}
	}),
)

/** Both hosts, on the app's RPC client (provided by the root) and the HTTP API client. */
export const chatSyncWebLayer = Layer.mergeAll(chatSyncBackendLayer, chatMigrationBackendLayer).pipe(
	Layer.provide(Layer.mergeAll(HazelApiClientLive, ClipboardWeb)),
)
