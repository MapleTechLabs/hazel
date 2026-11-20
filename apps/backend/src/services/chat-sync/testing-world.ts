/**
 * For tests: an org on the in-memory objects with an owner, a public channel, a Discord connection
 * and a link for the channel, plus a readable transcript of what Hazel ended up holding.
 */
import { CurrentUser } from "@hazel/domain"
import type {
	ChannelId,
	ExternalChannelId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Exit, Layer } from "effect"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { encodeInvokePrincipal } from "../../worker/objects/principal"
import { ObjectStubs } from "../../worker/objects/protocol"
import { makeTestObjects, type TestObject, type TestObjects } from "../../worker/objects/testing"
import { type ChatSyncInbound, routeChatSyncInbound } from "./chat-sync-inbound"

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

export const callRpc = (
	object: TestObject,
	objectId: string,
	tag: HazelRpcTag,
	payload: unknown,
	user: string,
) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	})

const ok = <A>(exit: Exit.Exit<A, unknown>) =>
	Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.die(Cause.pretty(exit.cause))

export const rows = <T>(object: TestObject, sql: string, ...params: Array<string>) =>
	object.storage.db.prepare(sql).all(...params) as Array<T>

export interface ChatSyncWorld {
	readonly objects: TestObjects
	readonly org: TestObject
	readonly channel: TestObject
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly channelId: ChannelId
	readonly syncConnectionId: SyncConnectionId
	readonly channelLinkId: SyncChannelLinkId
	/** Route an inbound event the way the provider's gateway or webhook does. */
	readonly inbound: (event: ChatSyncInbound) => Effect.Effect<void>
	/** Runs the org's and the linked channel's pending outbox deliveries. */
	readonly settle: Effect.Effect<void>
	/**
	 * The linked channel as a reader sees it, one line per live message, oldest first:
	 * `Author: content`, then `[reactions]`, with each thread's messages indented under its parent.
	 */
	readonly transcript: Effect.Effect<ReadonlyArray<string>>
}

/** An org with an owner, a public channel, a Discord connection for `guildId` and a link to `externalChannelId`. */
export const makeDiscordChatSyncWorld = (params: {
	readonly guildId: string
	readonly externalChannelId: ExternalChannelId
}) =>
	Effect.gen(function* () {
		const objects = yield* makeTestObjects
		const orgId = crypto.randomUUID() as OrganizationId
		const owner = crypto.randomUUID() as UserId
		const org = yield* objects.get(orgTarget(orgId))
		const db = org.storage.db
		db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
		db.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Olive', 'Owner')`,
		).run(owner, `ext-${owner}`, `${owner}@example.com`)
		db.prepare(
			`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, 'owner')`,
		).run(orgId, owner)
		db.prepare(
			`INSERT INTO integration_connections (provider, organizationId, level, status, connectedBy)
			 VALUES ('discord', ?, 'organization', 'active', ?)`,
		).run(orgId, owner)

		const created = (yield* ok(
			yield* callRpc(
				org,
				orgId,
				"channel.create",
				{
					name: "general",
					icon: null,
					type: "public",
					organizationId: orgId,
					parentChannelId: null,
					sectionId: null,
				},
				owner,
			),
		)) as { data: { id: ChannelId } }
		const channelId = created.data.id

		const connection = (yield* ok(
			yield* callRpc(
				org,
				orgId,
				"chatSync.connection.create",
				{
					organizationId: orgId,
					provider: "discord",
					externalWorkspaceId: params.guildId,
					externalWorkspaceName: "Guild",
				},
				owner,
			),
		)) as { data: { id: SyncConnectionId } }
		const link = (yield* ok(
			yield* callRpc(
				org,
				orgId,
				"chatSync.channelLink.create",
				{
					organizationId: orgId,
					syncConnectionId: connection.data.id,
					hazelChannelId: channelId,
					externalChannelId: params.externalChannelId,
				},
				owner,
			),
		)) as { data: { id: SyncChannelLinkId } }

		const stubs = Layer.succeed(ObjectStubs, objects.stubs)
		const inbound = (event: ChatSyncInbound) =>
			routeChatSyncInbound(event).pipe(
				Effect.provide(stubs),
				Effect.provideContext(objects.directory),
				Effect.orDie,
			)
		const channel = yield* objects.get(channelTarget(channelId))

		const nameOf = (userId: string) => {
			const [user] = rows<{ firstName: string; lastName: string }>(
				org,
				`SELECT firstName, lastName FROM users WHERE id = ?`,
				userId,
			)
			return user ? `${user.firstName} ${user.lastName}`.trim() : userId
		}

		const linesOf = (object: TestObject, indent: string): Effect.Effect<Array<string>> =>
			Effect.gen(function* () {
				const lines: Array<string> = []
				const messages = rows<{
					id: string
					authorId: string
					content: string
					threadChannelId: string | null
				}>(
					object,
					`SELECT id, authorId, content, threadChannelId FROM messages
					 WHERE deletedAt IS NULL ORDER BY createdAt, rowid`,
				)
				for (const message of messages) {
					const reactions = rows<{ emoji: string }>(
						object,
						`SELECT emoji FROM message_reactions WHERE messageId = ? ORDER BY createdAt, rowid`,
						message.id,
					).map((reaction) => reaction.emoji)
					lines.push(
						`${indent}${nameOf(message.authorId)}: ${message.content}` +
							(reactions.length > 0 ? ` [${reactions.join(" ")}]` : ""),
					)
					if (message.threadChannelId !== null) {
						const [thread] = rows<{ name: string }>(
							org,
							`SELECT name FROM channels WHERE id = ?`,
							message.threadChannelId,
						)
						lines.push(`${indent}  thread "${thread?.name ?? "?"}":`)
						const threadObject = yield* objects.get(
							channelTarget(message.threadChannelId as ChannelId),
						)
						lines.push(...(yield* linesOf(threadObject, `${indent}    `)))
					}
				}
				return lines
			})

		return {
			objects,
			org,
			channel,
			orgId,
			owner,
			channelId,
			syncConnectionId: connection.data.id,
			channelLinkId: link.data.id,
			inbound,
			settle: Effect.gen(function* () {
				yield* org.alarm
				yield* channel.alarm
			}),
			transcript: Effect.suspend(() => linesOf(channel, "")),
		} satisfies ChatSyncWorld
	})
