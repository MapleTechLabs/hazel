/**
 * What differs between Slack and Discord in the wizard's words (today's
 * `web-foldkit/src/page/settings/chat-sync/providers.ts`, the copy only).
 */
import type { ChatSyncProvider } from "./model"

export interface ProviderFacts {
	readonly name: string
	/** What the platform calls the place a connection syncs. */
	readonly workspaceKind: string
	/** Discord lists every server to pick from; Slack has the one workspace the org installed Hazel in. */
	readonly picksWorkspace: boolean
	/** The provider card's line on the first step. */
	readonly blurb: string
	/** Under the channel picker, when the platform has a rule worth knowing. */
	readonly channelNote: string | null
}

export const PROVIDERS = {
	discord: {
		name: "Discord",
		workspaceKind: "server",
		picksWorkspace: true,
		blurb: "Bring over the channels of a server you manage.",
		channelNote: null,
	},
	slack: {
		name: "Slack",
		workspaceKind: "workspace",
		picksWorkspace: false,
		blurb: "Bring over your workspace's public channels.",
		channelNote: "Hazel joins the channel when you link it. Private channels are not supported yet.",
	},
} satisfies Record<ChatSyncProvider, ProviderFacts>

/** The order the first step offers them in. */
export const PROVIDER_ORDER: ReadonlyArray<ChatSyncProvider> = ["discord", "slack"]
