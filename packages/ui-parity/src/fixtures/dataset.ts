import type { CurrentUser } from "@hazel/domain"

/** A row as it lives in Postgres. Dates are `Date` objects; JSON columns are plain objects. */
export type Row = Record<string, unknown>

/** Electric table names synced by the web app (`apps/web/src/db/collections.ts`). */
export type TableName =
	| "attachments"
	| "bot_commands"
	| "bot_installations"
	| "bots"
	| "channel_members"
	| "channel_sections"
	| "channels"
	| "chat_sync_channel_links"
	| "chat_sync_connections"
	| "chat_sync_message_links"
	| "connect_conversation_channels"
	| "connect_conversations"
	| "connect_participants"
	| "custom_emojis"
	| "integration_connections"
	| "message_reactions"
	| "messages"
	| "notifications"
	| "organization_members"
	| "organizations"
	| "pinned_messages"
	| "typing_indicators"
	| "user_presence_status"
	| "users"

/**
 * Everything both frontends see during a parity run. The same dataset feeds the
 * legacy React app and the Foldkit app, so any visual difference is a UI difference.
 */
export interface Dataset {
	readonly name: string
	/** Frozen wall clock for the browser, so relative timestamps render identically. */
	readonly now: Date
	readonly currentUser: typeof CurrentUser.Schema.Type & { readonly clerkUserId: string }
	readonly clerkOrgId: string | null
	/** Anonymous visitor: Clerk has no session and authenticated RPCs fail as they would without a token. */
	readonly signedOut?: boolean
	readonly tables: Partial<Record<TableName, ReadonlyArray<Row>>>
	/** Canned RPC successes keyed by RPC tag. Values are the decoded (Type-side) success value. */
	readonly rpc: Readonly<Record<string, (payload: unknown) => unknown>>
	/** Third-party responses the fixture backend stands in for (`backend/network.ts`), keyed by request. */
	readonly network?: NetworkFixtures
	/** Rivet message actors (`backend/rivet.ts`) keyed by message id: the events each one streams. */
	readonly actors?: Readonly<Record<string, ActorScript>>
}

export interface NetworkFixtures {
	/** `link-preview.hazel.sh/link-preview?url=<key>`: the worker's `LinkPreviewData`. */
	readonly linkPreviews?: Readonly<Record<string, unknown>>
	/** `link-preview.hazel.sh/tweet?id=<key>`: the syndication API's tweet JSON. */
	readonly tweets?: Readonly<Record<string, unknown>>
}

/**
 * What a message actor sends after a client connects: its `getState` snapshot, then each event in
 * order. A script that stops before `completed` leaves the message streaming.
 */
export interface ActorScript {
	readonly state: Readonly<Record<string, unknown>>
	readonly events: ReadonlyArray<{ readonly name: string; readonly payload: Readonly<Record<string, unknown>> }>
}
