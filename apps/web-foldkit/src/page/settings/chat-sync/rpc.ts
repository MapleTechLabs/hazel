import { EMAIL_CHAT_SYNC_PROVIDER, EmailMailboxMetadata, EmailMailboxSettings } from "@hazel/domain/rpc"
import type { ChatSyncChannelLink, ChatSyncConnection } from "@hazel/domain/models"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { toDate } from "~/lib/utils"
import { HazelRpc } from "../../../rpc"
import { type Connection, ConnectionStatus, type EmailInbox } from "./model"
import { isChatSyncProvider, PROVIDERS } from "./providers"

const isStatus = Schema.is(ConnectionStatus)
const statusOf = (status: string) => (isStatus(status) ? status : "active")

const decodeMetadata = Schema.decodeUnknownOption(EmailMailboxMetadata)
const decodeEmailSettings = Schema.decodeUnknownOption(EmailMailboxSettings)

/** The connection's `metadata.inboundAddress`, if the server wrote one. */
export const inboundAddressOf = (metadata: ChatSyncConnection.Type["metadata"]): string | null =>
	Option.getOrNull(Option.map(decodeMetadata(metadata), (decoded) => decoded.inboundAddress))

/** An email inbox from its connection and its one channel link (`settings.email`). */
export const emailInboxOf = (
	connection: ChatSyncConnection.Type,
	link: ChatSyncChannelLink.Type | undefined,
	inboundAddress: string | null = inboundAddressOf(connection.metadata),
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

const toConnection = (connection: ChatSyncConnection.Type): ReadonlyArray<Connection> => {
	const provider = connection.provider
	// A provider this client does not know has no page to manage it, so it is not listed.
	if (!isChatSyncProvider(provider)) return []
	return [
		{
			id: connection.id,
			provider,
			displayName: connection.externalWorkspaceName || PROVIDERS[provider].workspaceTitle,
			// `(connection.status as ConnectionStatus) || "active"`
			status: statusOf(connection.status),
			externalWorkspaceId: connection.externalWorkspaceId,
			errorMessage: connection.errorMessage ?? null,
			lastSyncedAtMs: connection.lastSyncedAt ? toDate(connection.lastSyncedAt).getTime() : null,
		},
	]
}

/** `chatSync.connection.list`: the Slack and Discord connections, and the email inboxes with their links. */
export const fetchChatSync = (organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const response = yield* client("chatSync.connection.list", { organizationId })
		const mailboxes = response.data.filter(
			(connection) => connection.provider === EMAIL_CHAT_SYNC_PROVIDER,
		)
		// Each inbox's one link holds its channel and reply-to; an inbox deleted meanwhile has none.
		const emailInboxes = yield* Effect.forEach(
			mailboxes,
			(connection) =>
				client("chatSync.channelLink.list", { organizationId, syncConnectionId: connection.id }).pipe(
					Effect.map((links) => emailInboxOf(connection, links.data[0])),
					Effect.catchTags({
						ChatSyncConnectionNotFoundError: () =>
							Effect.succeed(emailInboxOf(connection, undefined)),
					}),
				),
			{ concurrency: "unbounded" },
		)
		return { connections: response.data.flatMap(toConnection), emailInboxes }
	})

/** `chatSync.connection.list`, shaped the way both chat sync pages read it. */
export const fetchConnections = (organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const response = yield* client("chatSync.connection.list", { organizationId })
		return response.data.flatMap(toConnection)
	})

/** `toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })` */
export const formatSyncedAt = (ms: number) =>
	new Date(ms).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
