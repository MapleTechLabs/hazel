/**
 * Provider → Hazel, the shared front half. A provider's source (Discord's gateway, Slack's events
 * webhook) turns each event into one `ChatSyncInbound` and calls `routeChatSyncInbound`: the
 * directory's `chat_sync_index` names the orgs linked to the external channel, the actor is
 * upserted into the directory as a shadow user, then `org.chatSyncIngest` is applied at each
 * `OrgObject` (keyed by the dedupe key, so a redelivered event is applied once).
 */
import type { ExternalChannelId, ExternalUserId } from "@hazel/schema"
import { Effect } from "effect"
import { applyNow } from "../../worker/objects/fanout"
import { orgTarget } from "../../worker/objects/kinds"
import {
	ChatSyncOrgEffects,
	type ChatSyncInboundEvent,
	type OrgChatSyncIngestPayload,
} from "./chat-sync-effects"
import { indexedLinks, upsertIntegrationBot, upsertShadowUser } from "./chat-sync-index"
import type { ChatSyncProviderId } from "./provider"

/** Who an event names as its actor. */
export interface ChatSyncInboundAuthor {
	readonly externalUserId: ExternalUserId
	readonly displayName: string
	readonly avatarUrl: string | null
}

/** One validated provider event, ready to route. `author: null`: the event named nobody. */
export interface ChatSyncInbound {
	readonly provider: ChatSyncProviderId
	readonly externalChannelId: ExternalChannelId
	/**
	 * The provider workspaces the event happened in (Discord's guild; Slack's team, and the
	 * other team of a shared channel). Only links under one of them get it; none: nobody does.
	 */
	readonly externalWorkspaceIds: ReadonlyArray<string>
	/** Stable across redeliveries of the same event, and unique per provider. */
	readonly dedupeKey: string
	readonly author: ChatSyncInboundAuthor | null
	readonly event: ChatSyncInboundEvent
}

/** Route one provider event to every org whose link indexes its channel. */
export const routeChatSyncInbound = Effect.fn("ChatSync.routeInbound")(function* (inbound: ChatSyncInbound) {
	const { provider } = inbound
	const targets = yield* indexedLinks(provider, inbound.externalChannelId, inbound.externalWorkspaceIds)
	yield* Effect.annotateCurrentSpan({
		"chat_sync.provider": provider,
		"chat_sync.event": inbound.event._tag,
		"chat_sync.external_channel_id": inbound.externalChannelId,
		"chat_sync.orgs": targets.length,
	})
	if (targets.length === 0) return
	const author: OrgChatSyncIngestPayload["author"] =
		inbound.author !== null
			? {
					externalUserId: inbound.author.externalUserId,
					user: yield* upsertShadowUser(
						provider,
						inbound.author.externalUserId,
						inbound.author.displayName,
						inbound.author.avatarUrl,
					),
				}
			: inbound.event._tag === "MessageCreate"
				? { externalUserId: null, user: yield* upsertIntegrationBot(provider) }
				: null
	const payload: OrgChatSyncIngestPayload = {
		provider,
		externalChannelId: inbound.externalChannelId,
		externalWorkspaceIds: inbound.externalWorkspaceIds,
		dedupeKey: inbound.dedupeKey,
		author,
		event: inbound.event,
	}
	const organizations = [...new Set(targets.map((target) => target.organizationId))]
	yield* Effect.forEach(
		organizations,
		(organizationId) =>
			applyNow(
				ChatSyncOrgEffects.chatSyncIngest,
				orgTarget(organizationId),
				payload,
				inbound.dedupeKey,
			),
		{ concurrency: 4, discard: true },
	)
})
