/**
 * Hazel's MCP server end to end, on node SQLite (`makeTestObjects`): an MCP client discovers the
 * OAuth metadata, registers, exchanges a PKCE code, calls tools as the user (a message it sends is
 * marked as the agent's), refreshes, and loses access when the user revokes it. Personal tokens
 * work the same; a read-only one has no write tools.
 */
import { createHash } from "node:crypto"
import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { SQLite, schema } from "@hazel/db"
import type { AgentClientId, ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Context, Effect, Layer, type Scope } from "effect"
import { HttpRouter } from "effect/http"
import { describe, expect, it } from "vitest"
import { AgentAccess } from "../services/agent-access"
import { Directory } from "../services/directory"
import { RateLimiterAllowAll } from "../services/rate-limiter"
import { channelTarget, orgTarget } from "../worker/objects/kinds"
import { ObjectStubs } from "../worker/objects/protocol"
import { makeTestObjects, type TestObject } from "../worker/objects/testing"
import { AgentOAuthRoutes } from "./agent-oauth"
import { McpRoute } from "./mcp"

const uuid = () => crypto.randomUUID()
const API = "https://api.hazel.test"
const base64Url = (bytes: Buffer) => bytes.toString("base64url")
const verifier = "a-pkce-code-verifier-that-is-long-enough-to-be-valid-0123456789"
const challenge = base64Url(createHash("sha256").update(verifier).digest())

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/** An org with alice in one public channel, the directory rows the api Worker reads, and the routes. */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const alice = uuid() as UserId
	const channelId = uuid() as ChannelId
	const org = yield* objects.get(orgTarget(orgId))
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	db.prepare(
		`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
	).run(uuid(), orgId, alice)
	db.prepare(
		`INSERT INTO channels (id, name, type, organizationId) VALUES (?, 'general', 'public', ?)`,
	).run(channelId, orgId)
	db.prepare(
		`INSERT INTO channel_members (channelId, userId, isMuted, notificationCount) VALUES (?, ?, 0, 2)`,
	).run(channelId, alice)
	db.prepare(`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`).run(
		alice,
		channelId,
		orgId,
	)
	const channel = yield* objects.get(channelTarget(channelId))
	yield* channel.applyEffect({
		objectId: channelId,
		kind: "channel.setViewers",
		payload: {
			organizationId: orgId,
			conversationId: null,
			viewers: [{ userId: alice, organizationId: orgId, role: "member" }],
			bots: [],
		},
		key: `viewers:${channelId}`,
		sender: { kind: "org", id: orgId },
	})
	const directory = Context.get(objects.directory, Directory)
	yield* directory.upsertChannel({ channelId, organizationId: orgId, hostChannelId: null, deletedAt: null })
	yield* directory.upsertOrg({ id: orgId, slug: "acme", name: "Acme", deletedAt: null })
	yield* directory.upsertMembership({ userId: alice, organizationId: orgId, deletedAt: null })
	yield* directory.db.run(
		SQLite.insertInto(schema.usersTable).values({
			id: alice,
			externalId: `ext-${alice}`,
			email: "alice@example.com",
			firstName: "Alice",
			lastName: "Liddell",
		}),
	)

	const services = Layer.mergeAll(
		AgentAccess.layer.pipe(Layer.provide(Layer.succeedContext(objects.directory))),
		Layer.succeedContext(objects.directory),
		Layer.succeed(ObjectStubs, objects.stubs),
		RateLimiterAllowAll,
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ API_BASE_URL: API, FRONTEND_URL: "https://app.hazel.test" }),
		),
	)
	const app = Layer.mergeAll(AgentOAuthRoutes, McpRoute).pipe(
		Layer.provideMerge(services),
		Layer.provideMerge(HttpRouter.layer),
		Layer.provideMerge(NodeServices.layer),
		Layer.provideMerge(NodeHttpPlatform.layer),
	)
	const { handler, dispose } = HttpRouter.toWebHandler(app as never, { disableLogger: true })
	yield* Effect.addFinalizer(() => Effect.promise(() => dispose()))
	const fetch = (path: string, init: RequestInit = {}) =>
		Effect.promise(() =>
			handler(new Request(`${API}${path}`, init), Context.empty() as Context.Context<any>),
		)
	const access = Context.get(
		yield* Layer.build(AgentAccess.layer.pipe(Layer.provide(Layer.succeedContext(objects.directory)))),
		AgentAccess,
	)
	return { objects, orgId, alice, channelId, channel, fetch, access }
}).pipe(Effect.orDie)

type World = Effect.Success<typeof makeWorld>

const json = (response: Response) => Effect.promise(() => response.json() as Promise<any>)

const form = (params: Record<string, string>) => ({
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams(params).toString(),
})

let nextId = 1
const mcp = (world: World, token: string, method: string, params?: Record<string, unknown>) =>
	world
		.fetch("/mcp", {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
		})
		.pipe(Effect.flatMap(json))

const callTool = (world: World, token: string, name: string, args: Record<string, unknown> = {}) =>
	mcp(world, token, "tools/call", { name, arguments: args }).pipe(Effect.map((response) => response.result))

const messagesIn = (object: TestObject) =>
	object.storage.db
		.prepare(`SELECT id, authorId, content FROM messages ORDER BY createdAt`)
		.all() as Array<{
		id: string
		authorId: string
		content: string
	}>

describe("MCP server", () => {
	it("OAuth: discover, register, exchange, act, refresh, revoke", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld

				// Unauthenticated: 401 pointing at the resource metadata.
				const anonymous = yield* world.fetch("/mcp", { method: "POST", body: "{}" })
				expect(anonymous.status).toBe(401)
				expect(anonymous.headers.get("www-authenticate")).toContain(
					`resource_metadata="${API}/.well-known/oauth-protected-resource"`,
				)
				const resource = yield* json(yield* world.fetch("/.well-known/oauth-protected-resource"))
				expect(resource).toMatchObject({ resource: `${API}/mcp`, authorization_servers: [API] })
				const server = yield* json(yield* world.fetch("/.well-known/oauth-authorization-server"))
				expect(server).toMatchObject({
					token_endpoint: `${API}/oauth/token`,
					registration_endpoint: `${API}/oauth/register`,
					code_challenge_methods_supported: ["S256"],
				})

				// Registration: a script redirect is refused; a loopback one is fine.
				const refused = yield* world.fetch("/oauth/register", {
					method: "POST",
					body: JSON.stringify({ client_name: "Evil", redirect_uris: ["javascript:alert(1)"] }),
				})
				expect(refused.status).toBe(400)
				const registered = yield* json(
					yield* world.fetch("/oauth/register", {
						method: "POST",
						body: JSON.stringify({
							client_name: "Claude",
							redirect_uris: ["http://127.0.0.1:33418/callback"],
						}),
					}),
				)
				const clientId = registered.client_id as AgentClientId

				// The authorize endpoint hands the browser to the web app's consent page.
				const authorize = yield* world.fetch(`/oauth/authorize?client_id=${clientId}&state=s`)
				expect(authorize.status).toBe(302)
				expect(authorize.headers.get("location")).toBe(
					`https://app.hazel.test/oauth/authorize?client_id=${clientId}&state=s`,
				)

				// The consent page's approval (a loopback redirect matches any port).
				const redirectUri = "http://127.0.0.1:50123/callback"
				expect((yield* world.access.clientFor(clientId, redirectUri))._tag).toBe("Some")
				expect((yield* world.access.clientFor(clientId, "https://evil.test/cb"))._tag).toBe("None")
				const code = yield* world.access.createCode({
					clientId,
					userId: world.alice,
					redirectUri,
					codeChallenge: challenge,
					scopes: ["messages:read", "messages:write"],
				})

				const exchange = (params: Record<string, string>) => world.fetch("/oauth/token", form(params))
				const wrongVerifier = yield* exchange({
					grant_type: "authorization_code",
					code,
					client_id: clientId,
					redirect_uri: redirectUri,
					code_verifier: "wrong",
				})
				expect(wrongVerifier.status).toBe(400)
				expect((yield* json(wrongVerifier)).error).toBe("invalid_grant")

				// The failed attempt spent the code; a fresh one exchanges.
				const code2 = yield* world.access.createCode({
					clientId,
					userId: world.alice,
					redirectUri,
					codeChallenge: challenge,
					scopes: ["messages:read", "messages:write"],
				})
				const tokens = yield* json(
					yield* exchange({
						grant_type: "authorization_code",
						code: code2,
						client_id: clientId,
						redirect_uri: redirectUri,
						code_verifier: verifier,
					}),
				)
				expect(tokens).toMatchObject({
					token_type: "Bearer",
					expires_in: 3600,
					scope: "messages:read messages:write",
				})
				const replay = yield* exchange({
					grant_type: "authorization_code",
					code: code2,
					client_id: clientId,
					redirect_uri: redirectUri,
					code_verifier: verifier,
				})
				expect((yield* json(replay)).error).toBe("invalid_grant")

				// MCP: initialize, list tools, act.
				const init = yield* mcp(world, tokens.access_token, "initialize", {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "test", version: "1" },
				})
				expect(init.result.protocolVersion).toBe("2025-06-18")
				expect(init.result.serverInfo.name).toBe("hazel")
				const listed = yield* mcp(world, tokens.access_token, "tools/list")
				expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain(
					"send_message",
				)

				const channels = yield* callTool(world, tokens.access_token, "list_channels")
				expect(channels.structuredContent.channels).toEqual([
					{
						id: world.channelId,
						organization_id: world.orgId,
						name: "general",
						type: "public",
						unread_count: 2,
					},
				])

				const sent = yield* callTool(world, tokens.access_token, "send_message", {
					channel_id: world.channelId,
					content: "On it, will send the doc by 5",
				})
				expect(sent.isError).toBeUndefined()
				expect(sent.structuredContent.message.author).toEqual({
					id: world.alice,
					name: "Alice Liddell",
				})
				const [message] = messagesIn(world.channel)
				expect(message).toMatchObject({
					authorId: world.alice,
					content: "On it, will send the doc by 5",
				})
				expect(
					world.channel.storage.db.prepare(`SELECT id, agentName FROM message_agent_marks`).all(),
				).toEqual([{ id: message!.id, agentName: "Claude" }])

				const read = yield* callTool(world, tokens.access_token, "read_messages", {
					channel_id: world.channelId,
				})
				expect(read.structuredContent.messages.map((m: { content: string }) => m.content)).toEqual([
					"On it, will send the doc by 5",
				])

				// A tool failure is a tool result, not a protocol error.
				const bad = yield* callTool(world, tokens.access_token, "send_message", {
					channel_id: "not-a-uuid",
					content: "x",
				})
				expect(bad.isError).toBe(true)

				// Refresh rotates: the old refresh token is spent.
				const refreshed = yield* json(
					yield* exchange({
						grant_type: "refresh_token",
						refresh_token: tokens.refresh_token,
						client_id: clientId,
					}),
				)
				expect(refreshed.access_token).not.toBe(tokens.access_token)
				const reused = yield* exchange({
					grant_type: "refresh_token",
					refresh_token: tokens.refresh_token,
					client_id: clientId,
				})
				expect((yield* json(reused)).error).toBe("invalid_grant")

				// Revoking the grant ends every token at once.
				const [grant] = yield* world.access.listGrants(world.alice)
				expect(grant).toMatchObject({ kind: "oauth", name: "Claude" })
				expect(yield* world.access.revokeGrant(world.alice, grant!.id)).toBe(true)
				const after = yield* world.fetch("/mcp", {
					method: "POST",
					headers: { authorization: `Bearer ${refreshed.access_token}` },
					body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
				})
				expect(after.status).toBe(401)
			}),
		))

	it("personal tokens: a read-only one cannot write; edits stay on the user's own messages", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const readOnly = yield* world.access.createPersonalToken({
					userId: world.alice,
					name: "Reader",
					scopes: ["messages:read"],
				})
				expect(readOnly.token.startsWith("hzl_pat_")).toBe(true)
				const listed = yield* mcp(world, readOnly.token, "tools/list")
				const names = listed.result.tools.map((tool: { name: string }) => tool.name)
				expect(names).toContain("read_messages")
				expect(names).not.toContain("send_message")
				const refused = yield* callTool(world, readOnly.token, "send_message", {
					channel_id: world.channelId,
					content: "hi",
				})
				expect(refused.isError).toBe(true)
				expect(messagesIn(world.channel)).toEqual([])

				// Someone else's message: the agent may not edit it.
				const bob = uuid() as UserId
				world.channel.storage.db
					.prepare(
						`INSERT INTO messages (id, channelId, authorId, content) VALUES (?, ?, ?, 'bob says hi')`,
					)
					.run(uuid(), world.channelId, bob)
				const writer = yield* world.access.createPersonalToken({
					userId: world.alice,
					name: "Writer",
					scopes: ["messages:read", "messages:write"],
				})
				const [bobs] = messagesIn(world.channel)
				const edit = yield* callTool(world, writer.token, "edit_message", {
					channel_id: world.channelId,
					message_id: bobs!.id,
					content: "hijacked",
				})
				expect(edit.isError).toBe(true)
				expect(messagesIn(world.channel)[0]!.content).toBe("bob says hi")

				// Notifications are a JSON-RPC notification: 202, no body.
				const note = yield* world.fetch("/mcp", {
					method: "POST",
					headers: { authorization: `Bearer ${writer.token}` },
					body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
				})
				expect(note.status).toBe(202)
			}),
		))
})
