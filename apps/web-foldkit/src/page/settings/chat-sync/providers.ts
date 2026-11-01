import { type IntegrationNotConnectedForPreviewError, IntegrationResourceError } from "@hazel/domain/http"
import { ExternalChannelId, type OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	type CommonError,
	CommonReason,
	failureMessage,
	isRetryableReason,
	type UserErrorMessage,
} from "~/lib/error-messages"
import { catchCommon } from "../../../data/actions"
import { HazelApiClient } from "../../../rpc"
import { discordLogo, slackLogo } from "./brand-icons"

/** The chat platforms a sync connection bridges, and what differs between them. */

export const ChatSyncProvider = Schema.Literals(["discord", "slack"])
export type ChatSyncProvider = typeof ChatSyncProvider.Type
export const isChatSyncProvider = Schema.is(ChatSyncProvider)

/** Where a connection syncs: a Discord server or a Slack workspace. */
export const Workspace = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	/** Discord: the user owns the server (shown as a tag). */
	owner: Schema.Boolean,
})
export type Workspace = typeof Workspace.Type

/** A channel of the connected workspace, as the link picker lists it (Slack lists public ones only). */
export const ExternalChannel = Schema.Struct({
	id: ExternalChannelId,
	name: Schema.String,
	isPrivate: Schema.Boolean,
	/** Whether Hazel's bot is in the channel already. */
	isMember: Schema.Boolean,
})
export type ExternalChannel = typeof ExternalChannel.Type

/**
 * Why a provider resource list failed: the provider is not connected to the organization, the provider
 * itself refused (e.g. the bot lacks access), or a common reason.
 */
export const ResourceFailure = Schema.Union([
	Schema.Literals(["NotConnected", "ProviderError"]),
	CommonReason,
])
export type ResourceFailure = typeof ResourceFailure.Type

export const Workspaces = AsyncData.Schema(Schema.Array(Workspace), ResourceFailure)
export const ExternalChannels = AsyncData.Schema(Schema.Array(ExternalChannel), ResourceFailure)

type ResourceError = CommonError | IntegrationNotConnectedForPreviewError | IntegrationResourceError
type Resource<A> = Effect.Effect<ReadonlyArray<A>, ResourceError, HazelApiClient>

export interface ProviderDescriptor {
	readonly name: string
	/** The integration page that connects it (`/settings/integrations/:id`). */
	readonly integrationId: string
	/** What the platform calls the place a connection syncs, and its title ("Discord Server"). */
	readonly workspaceKind: string
	readonly workspaceTitle: string
	readonly workspaceIdLabel: string
	/** The add modal's list: "guilds" (any server the bot is in) or the one installed "workspace". */
	readonly workspacesResource: string
	/** Discord lists every server to pick from; Slack has the one workspace the org installed Hazel in. */
	readonly picksWorkspace: boolean
	/** Discord posts through a webhook per link and reports its permission; Slack always posts as the author. */
	readonly hasWebhookIdentity: boolean
	/** The logo tile's tint (a literal class, so Tailwind sees it). */
	readonly tintClass: string
	readonly logo: <M>(h: HtmlBuilder<M>, className: string) => Html
	readonly copy: {
		readonly notConnected: (resource: string) => string
		readonly providerError: string
		readonly createNotConnected: string
		readonly alreadyConnected: string
		/** Under the channel picker, when the platform has a rule worth knowing. */
		readonly channelNote: string | null
	}
	readonly fetchWorkspaces: (orgId: OrganizationId) => Resource<Workspace>
	readonly fetchChannels: (orgId: OrganizationId, workspaceId: string) => Resource<ExternalChannel>
}

/** The org's Slack install: its workspace and the channels the bot can see. */
const fetchSlack = (orgId: OrganizationId) =>
	HazelApiClient.use((client) => client["integration-resources"].getSlackChannels({ params: { orgId } }))

export const PROVIDERS: Readonly<Record<ChatSyncProvider, ProviderDescriptor>> = {
	discord: {
		name: "Discord",
		integrationId: "discord",
		workspaceKind: "server",
		workspaceTitle: "Discord Server",
		workspaceIdLabel: "Guild ID",
		workspacesResource: "guilds",
		picksWorkspace: true,
		hasWebhookIdentity: true,
		tintClass: "bg-[#5865F2]/[0.06]",
		logo: discordLogo,
		copy: {
			notConnected: (resource) => `Authorize Discord in Integrations so we can load your ${resource}.`,
			providerError: "Make sure the bot is installed in this server and has channel access.",
			createNotConnected: "Connect Discord first to load your guilds.",
			alreadyConnected: "A connection to this Discord server already exists in your workspace.",
			channelNote: null,
		},
		fetchWorkspaces: (orgId) =>
			HazelApiClient.use((client) =>
				client["integration-resources"].getDiscordGuilds({ params: { orgId } }),
			).pipe(
				Effect.map((response) =>
					response.guilds.map(({ id, name, owner }): Workspace => ({ id, name, owner })),
				),
			),
		fetchChannels: (orgId, guildId) =>
			HazelApiClient.use((client) =>
				client["integration-resources"].getDiscordGuildChannels({ params: { orgId, guildId } }),
			).pipe(
				Effect.map((response) =>
					response.channels.map(
						({ id, name }): ExternalChannel => ({ id, name, isPrivate: false, isMember: true }),
					),
				),
			),
	},
	slack: {
		name: "Slack",
		integrationId: "slack",
		workspaceKind: "workspace",
		workspaceTitle: "Slack Workspace",
		workspaceIdLabel: "Workspace ID",
		workspacesResource: "workspace",
		picksWorkspace: false,
		hasWebhookIdentity: false,
		tintClass: "bg-[#4A154B]/[0.06]",
		logo: slackLogo,
		copy: {
			notConnected: () => "Install Hazel in your Slack workspace from Integrations first.",
			providerError: "Slack refused the request. Try reconnecting Slack in Integrations.",
			createNotConnected: "Install Hazel in this Slack workspace from Integrations first.",
			alreadyConnected: "This Slack workspace is already connected to your workspace.",
			channelNote: "Hazel joins the channel when you link it. Private channels are not supported yet.",
		},
		// The org has one install, so the "list" is that workspace.
		fetchWorkspaces: (orgId) =>
			fetchSlack(orgId).pipe(
				Effect.map(
					({ workspace }): ReadonlyArray<Workspace> => [
						{ id: workspace.id, name: workspace.name ?? "Slack Workspace", owner: false },
					],
				),
			),
		// Only while the org's install is still this connection's workspace (Slack reconnected
		// elsewhere lists another workspace's channels, which would never sync here).
		fetchChannels: (orgId, workspaceId) =>
			fetchSlack(orgId).pipe(
				Effect.flatMap((response) =>
					response.workspace.id === workspaceId
						? Effect.succeed<ReadonlyArray<ExternalChannel>>(response.channels)
						: Effect.fail(
								new IntegrationResourceError({
									url: "slack://conversations",
									message: "Slack is installed in another workspace",
									provider: "slack",
								}),
							),
				),
			),
	},
}

/** A provider resource list as a Command's Message: its data, or why it failed. */
export const listResource = <A, Succeeded, Failed>(
	resource: Resource<A>,
	onSuccess: (data: ReadonlyArray<A>) => Succeeded,
	onFailure: (reason: ResourceFailure) => Failed,
): Effect.Effect<Succeeded | Failed, never, HazelApiClient> =>
	resource.pipe(
		Effect.map(onSuccess),
		Effect.catchTags({
			IntegrationNotConnectedForPreviewError: () => Effect.succeed(onFailure("NotConnected")),
			IntegrationResourceError: () => Effect.succeed(onFailure("ProviderError")),
		}),
		catchCommon(onFailure),
	)

const isCommonReason = Schema.is(CommonReason)

/** Whether a failure is transient, so the view offers "Try again". */
export const isRetryable = (reason: string): boolean => isCommonReason(reason) && isRetryableReason(reason)

/** The inline copy for a provider list (`resource`: e.g. "guilds" or "channels") that failed to load. */
export const resourceFailureMessage = (
	provider: ChatSyncProvider,
	reason: ResourceFailure,
	resource: string,
): UserErrorMessage => {
	const { name, copy } = PROVIDERS[provider]
	return failureMessage(reason, {
		NotConnected: { title: `Connect ${name} first`, description: copy.notConnected(resource) },
		ProviderError: { title: `Could not load ${name} ${resource}`, description: copy.providerError },
	})
}
