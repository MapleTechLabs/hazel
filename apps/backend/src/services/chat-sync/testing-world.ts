/**
 * For chat-sync tests: an org on the in-memory objects with an owner, a public channel and a
 * provider connection (`makeChatSyncOrg`), linked to an external channel (`makeChatSyncWorld`),
 * plus a readable transcript of what Hazel ended up holding.
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
import { Cause, Effect, Exit, Layer, type Scope } from "effect"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { encodeInvokePrincipal } from "../../worker/objects/principal"
import { ObjectStubs } from "../../worker/objects/protocol"
import { makeTestObjects, type TestObject, type TestObjects } from "../../worker/objects/testing"
import { type ChatSyncInbound, routeChatSyncInbound } from "./chat-sync-inbound"
import type { ChatSyncProviderId } from "./provider"

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

/** An RPC on an object as `user`, its exit decoded. */
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

/** The exit's value; a failure fails the test with its cause. */
export const ok = <A>(exit: Exit.Exit<A, unknown>) =>
	Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.die(Cause.pretty(exit.cause))

export const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

export const rows = <T>(object: TestObject, sql: string, ...params: Array<string>) =>
	object.storage.db.prepare(sql).all(...params) as Array<T>

export interface ChatSyncOrgOptions {
	readonly provider: ChatSyncProviderId
	/** The workspace (Discord guild, Slack team) the connection is for. */
	readonly workspaceId: string
	/**
	 * The workspace the provider app is installed in (the integration's external account), for a
	 * provider that only connects to that one (Slack).
	 */
	readonly installedIn?: string
}

/** An org with an owner, a public channel and a connection to the provider's workspace. */
export const makeChatSyncOrg = (objects: TestObjects, options: ChatSyncOrgOptions) =>
	Effect.gen(function* () {
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
			`INSERT INTO integration_connections (provider, organizationId, level, status, connectedBy, externalAccountId)
			 VALUES (?, ?, 'organization', 'active', ?, ?)`,
		).run(options.provider, orgId, owner, options.installedIn ?? null)

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

		/** Connects the org to a workspace; the exit, since a refusal is what some tests want. */
		const connectTo = (externalWorkspaceId: string) =>
			callRpc(
				org,
				orgId,
				"chatSync.connection.create",
				{
					organizationId: orgId,
					provider: options.provider,
					externalWorkspaceId,
					externalWorkspaceName: "Workspace",
				},
				owner,
			)
		const connection = (yield* ok(yield* connectTo(options.workspaceId))) as {
			data: { id: SyncConnectionId }
		}

		/** Links the org's channel to `externalChannelId`; the exit. */
		const linkChannel = (externalChannelId: ExternalChannelId, historyLimit?: number) => {
			const payload = {
				organizationId: orgId,
				syncConnectionId: connection.data.id,
				hazelChannelId: channelId,
				externalChannelId,
			}
			// Left out, the link takes the default history.
			const withLimit = historyLimit === undefined ? payload : { ...payload, historyLimit }
			return callRpc(org, orgId, "chatSync.channelLink.create", withLimit, owner)
		}

		const stubs = Layer.succeed(ObjectStubs, objects.stubs)
		/** Routes an inbound event the way the provider's gateway or webhook does. */
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
					const files = rows<{ fileName: string }>(
						object,
						`SELECT fileName FROM attachments WHERE messageId = ? ORDER BY rowid`,
						message.id,
					).map((file) => file.fileName)
					lines.push(
						`${indent}${nameOf(message.authorId)}: ${message.content}` +
							(files.length > 0 ? ` {${files.join(", ")}}` : "") +
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
			orgId,
			owner,
			channel,
			channelId,
			syncConnectionId: connection.data.id,
			connectTo,
			linkChannel,
			inbound,
			/** Runs the org's and the channel's pending outbox deliveries. */
			settle: Effect.gen(function* () {
				yield* org.alarm
				yield* channel.alarm
			}),
			/**
			 * The channel as a reader sees it, one line per live message, oldest first:
			 * `Author: content {files} [reactions]`, each thread's messages indented under its parent.
			 */
			transcript: Effect.suspend(() => linesOf(channel, "")),
		}
	})

export type ChatSyncOrg = Effect.Success<ReturnType<typeof makeChatSyncOrg>>

/** An org (on fresh objects unless given) with its channel linked to `externalChannelId`. */
export const makeChatSyncWorld = (
	options: ChatSyncOrgOptions & {
		readonly externalChannelId: ExternalChannelId
		readonly objects?: TestObjects
	},
) =>
	Effect.gen(function* () {
		const org = yield* makeChatSyncOrg(options.objects ?? (yield* makeTestObjects), options)
		const link = (yield* ok(yield* org.linkChannel(options.externalChannelId))) as {
			data: { id: SyncChannelLinkId }
		}
		return { ...org, channelLinkId: link.data.id }
	})

export type ChatSyncWorld = Effect.Success<ReturnType<typeof makeChatSyncWorld>>
