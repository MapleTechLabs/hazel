// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Chat sync's data, shared by its pages (`/settings/chat-sync` and a connection's page): Slack and
 * Discord connections, the email support inboxes (`docs/customers/email.md`), and what differs
 * between the providers (today's `web-foldkit/src/page/settings/chat-sync/{model,providers}.ts`).
 */
import { EmailMailboxDisplayName, SupportEmailAddress } from "@hazel/domain/rpc"
import { ChannelId, SyncConnectionId } from "@hazel/schema"
import type { IconName, TextTone } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { ChatSyncProvider, Workspace } from "../../chat/migration/model"
import { CommonReason, type ErrorCopy, copyOf } from "../../modals/feedback"

export { ChatSyncProvider, CommonReason, Workspace }

export const ConnectionStatus = Schema.Literals(["active", "paused", "error", "disabled"])
export type ConnectionStatus = typeof ConnectionStatus.Type

export const Connection = Schema.Struct({
	id: SyncConnectionId,
	provider: ChatSyncProvider,
	/** `externalWorkspaceName`, or the provider's "Discord Server" / "Slack Workspace". */
	displayName: Schema.String,
	status: ConnectionStatus,
	externalWorkspaceId: Schema.String,
	errorMessage: Schema.NullOr(Schema.String),
	lastSyncedAtMs: Schema.NullOr(Schema.Finite),
})
export type Connection = typeof Connection.Type

/** An email support inbox: a connection with `provider: "email"` and its one channel link. */
export const EmailInbox = Schema.Struct({
	id: SyncConnectionId,
	/** The name replies are sent as. */
	displayName: Schema.String,
	status: ConnectionStatus,
	errorMessage: Schema.NullOr(Schema.String),
	/** Where the team forwards its support address; null until the server wrote it. */
	inboundAddress: Schema.NullOr(Schema.String),
	/** The team's own support address (Reply-To), if set. */
	supportAddress: Schema.NullOr(Schema.String),
	/** The channel its emails arrive in (null while the link is missing). */
	hazelChannelId: Schema.NullOr(ChannelId),
})
export type EmailInbox = typeof EmailInbox.Type

/** A Hazel channel as the inbox channel picker lists it. */
export const HazelChannel = Schema.Struct({ id: ChannelId, name: Schema.String })
export type HazelChannel = typeof HazelChannel.Type

/** What `chatSync.connection.list` gives the page: the connections and the inboxes. */
export const ChatSyncList = Schema.Struct({
	connections: Schema.Array(Connection),
	emailInboxes: Schema.Array(EmailInbox),
})
export type ChatSyncList = typeof ChatSyncList.Type

/** Why a provider resource list failed: not connected, the provider refused, or a common reason. */
export const ResourceFailure = Schema.Union([
	Schema.Literals(["NotConnected", "ProviderError"]),
	CommonReason,
])
export type ResourceFailure = typeof ResourceFailure.Type

export const CreateConnectionFailure = Schema.Union([
	Schema.Literals(["AlreadyExists", "NotConnected"]),
	CommonReason,
])
export type CreateConnectionFailure = typeof CreateConnectionFailure.Type

export const DeleteConnectionFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type DeleteConnectionFailure = typeof DeleteConnectionFailure.Type

export const EmailInboxFailure = Schema.Union([
	Schema.Literals(["ChannelNotFound", "ChannelLinked", "NotFound"]),
	CommonReason,
])
export type EmailInboxFailure = typeof EmailInboxFailure.Type

export interface StatusLook {
	readonly label: string
	readonly tone: TextTone
}

export const STATUS = {
	active: { label: "Active", tone: "success" },
	paused: { label: "Paused", tone: "warning" },
	error: { label: "Error", tone: "danger" },
	disabled: { label: "Disabled", tone: "muted" },
} satisfies Readonly<Record<ConnectionStatus, StatusLook>>

export interface ProviderDescriptor {
	readonly name: string
	readonly icon: IconName
	/** The integration page that connects it (`/settings/integrations/:id`). */
	readonly integrationId: string
	/** What the platform calls the place a connection syncs, and its title ("Discord Server"). */
	readonly workspaceKind: string
	readonly workspaceTitle: string
	readonly workspaceIdLabel: string
	/** The add dialog's list: "guilds" (any server the bot is in) or the one installed "workspace". */
	readonly workspacesResource: string
	/** Discord lists every server to pick from; Slack has the one workspace the org installed Hazel in. */
	readonly picksWorkspace: boolean
	readonly copy: {
		readonly notConnected: (resource: string) => string
		readonly providerError: string
		readonly createNotConnected: string
		readonly alreadyConnected: string
	}
}

export const PROVIDERS = {
	discord: {
		name: "Discord",
		icon: "discord",
		integrationId: "discord",
		workspaceKind: "server",
		workspaceTitle: "Discord Server",
		workspaceIdLabel: "Guild ID",
		workspacesResource: "guilds",
		picksWorkspace: true,
		copy: {
			notConnected: (resource) => `Authorize Discord in Integrations so we can load your ${resource}.`,
			providerError: "Make sure the bot is installed in this server and has channel access.",
			createNotConnected: "Connect Discord first to load your guilds.",
			alreadyConnected: "A connection to this Discord server already exists in your workspace.",
		},
	},
	slack: {
		name: "Slack",
		icon: "slack",
		integrationId: "slack",
		workspaceKind: "workspace",
		workspaceTitle: "Slack Workspace",
		workspaceIdLabel: "Workspace ID",
		workspacesResource: "workspace",
		picksWorkspace: false,
		copy: {
			notConnected: () => "Install Hazel in your Slack workspace from Integrations first.",
			providerError: "Slack refused the request. Try reconnecting Slack in Integrations.",
			createNotConnected: "Install Hazel in this Slack workspace from Integrations first.",
			alreadyConnected: "This Slack workspace is already connected to your workspace.",
		},
	},
} satisfies Readonly<Record<ChatSyncProvider, ProviderDescriptor>>

/** The add menu's order. */
export const PROVIDER_ORDER: ReadonlyArray<ChatSyncProvider> = ["discord", "slack"]

export const isChatSyncProvider = Schema.is(ChatSyncProvider)

/** Whether a failure is transient, so the page offers "Try again". */
export const isRetryable = (reason: string): boolean =>
	reason === "Offline" || reason === "Timeout" || reason === "Unavailable" || reason === "Unexpected"

/** The copy for a provider list (`resource`: "guilds", "channels") that failed to load. */
export const resourceFailureCopy = (
	provider: ChatSyncProvider,
	reason: ResourceFailure,
	resource: string,
): ErrorCopy => {
	const { name, copy } = PROVIDERS[provider]
	return copyOf(reason, {
		NotConnected: { title: `Connect ${name} first`, description: copy.notConnected(resource) },
		ProviderError: { title: `Could not load ${name} ${resource}`, description: copy.providerError },
	})
}

/** "Nov 26, 3:30 PM", as `toLocaleDateString` with the month, day and time. */
export const formatSyncedAt = (ms: number) =>
	new Date(ms).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})

// EMAIL INBOX FORM RULES

export const NAME_MAX_LENGTH = 80

const isDisplayName = Schema.is(EmailMailboxDisplayName)
const isSupportAddress = Schema.is(SupportEmailAddress)

/** Why the inbox name is refused, or null. */
export const nameError = (name: string): string | null => {
	const trimmed = name.trim()
	if (trimmed.length === 0) return "Enter a name for the inbox."
	if (trimmed.length > NAME_MAX_LENGTH) return `Use ${NAME_MAX_LENGTH} characters or fewer.`
	return isDisplayName(trimmed) ? null : "Enter a name for the inbox."
}

/** Why the support address is refused, or null (it is optional). */
export const supportAddressError = (address: string): string | null => {
	const trimmed = address.trim()
	return trimmed.length === 0 || isSupportAddress(trimmed)
		? null
		: "Enter an email address, like support@acme.com."
}

/** The trimmed support address, or null when left blank. */
export const supportAddressOf = (address: string): string | null => {
	const trimmed = address.trim()
	return trimmed.length === 0 ? null : trimmed
}

export const emailFailureCopy = (reason: EmailInboxFailure): ErrorCopy =>
	copyOf(reason, {
		ChannelNotFound: {
			title: "Channel not found",
			description: "Pick a public or private channel of this workspace.",
		},
		ChannelLinked: {
			title: "Channel already linked",
			description: "This channel already has an inbox. Pick another channel.",
		},
		NotFound: { title: "Inbox not found", description: "This inbox may have been removed." },
	})
