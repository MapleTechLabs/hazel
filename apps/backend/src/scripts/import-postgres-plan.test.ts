import { SQLite, schema } from "@hazel/db"
import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import {
	canonicalRow,
	encodeImportRow,
	type ImportTable,
	importTableOf,
	upsertStatement,
} from "../lib/import-rows"
import {
	buildRouting,
	encodeRouted,
	participantIdFor,
	type Routed,
	routeRow,
	type SourceRow,
	targetKey,
} from "./import-postgres-plan"

const ORG = "00000000-0000-4000-8000-00000000000a"
const GUEST_ORG = "00000000-0000-4000-8000-00000000000b"
const HOST_CHANNEL = "00000000-0000-4000-8000-0000000000c1"
const GUEST_CHANNEL = "00000000-0000-4000-8000-0000000000c2"
const CONVERSATION = "00000000-0000-4000-8000-0000000000d1"
const ALICE = "00000000-0000-4000-8000-0000000000e1"
const BOB = "00000000-0000-4000-8000-0000000000e2"
const MEMBER = "00000000-0000-4000-8000-0000000000f1"
const BOT = "00000000-0000-4000-8000-000000000b01"
const LINK = "00000000-0000-4000-8000-000000000a01"
const CONNECTION = "00000000-0000-4000-8000-000000000a02"

const at = new Date("2026-01-02T03:04:05.678Z")

const routing = buildRouting({
	channels: [
		{ id: HOST_CHANNEL, organizationId: ORG },
		{ id: GUEST_CHANNEL, organizationId: GUEST_ORG },
	],
	organization_members: [
		{ id: MEMBER, organizationId: ORG, userId: ALICE, deletedAt: null },
		{ id: "removed", organizationId: GUEST_ORG, userId: ALICE, deletedAt: at },
	],
	connect_conversations: [{ id: CONVERSATION, hostOrganizationId: ORG, hostChannelId: HOST_CHANNEL }],
	connect_conversation_channels: [
		{ conversationId: CONVERSATION, organizationId: ORG, channelId: HOST_CHANNEL, role: "host" },
		{ conversationId: CONVERSATION, organizationId: GUEST_ORG, channelId: GUEST_CHANNEL, role: "guest" },
	],
	connect_participants: [{ conversationId: CONVERSATION, userId: BOB, deletedAt: null }],
	bot_installations: [{ botId: BOT, organizationId: ORG }],
	chat_sync_channel_links: [{ id: LINK, hazelChannelId: GUEST_CHANNEL }],
	chat_sync_connections: [{ id: CONNECTION, organizationId: GUEST_ORG }],
})

const targets = (routed: ReadonlyArray<Routed>) =>
	routed.map((entry) => `${targetKey(entry.target)}:${entry.table}`).sort()

const user = (id: string): SourceRow => ({
	id,
	externalId: `ext-${id}`,
	email: `${id}@example.com`,
	firstName: "A",
	lastName: "B",
	avatarUrl: null,
	userType: "user",
	settings: { theme: "dark" },
	isOnboarded: true,
	timezone: null,
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
})

describe("routeRow", () => {
	it("copies users to the directory and to the orgs that show them", () => {
		expect(targets(routeRow(routing, "users", user(ALICE)))).toEqual([
			"directory:users",
			`org/${ORG}:users`,
		])
		// Bob is a Connect participant of the host org only.
		expect(targets(routeRow(routing, "users", user(BOB)))).toEqual([
			"directory:users",
			`org/${ORG}:users`,
		])
	})

	it("routes a guest mount's messages to the host channel", () => {
		const message = { id: "m1", channelId: GUEST_CHANNEL }
		expect(targets(routeRow(routing, "messages", message))).toEqual([`channel/${HOST_CHANNEL}:messages`])
		expect(targets(routeRow(routing, "message_reactions", { channelId: HOST_CHANNEL }))).toEqual([
			`channel/${HOST_CHANNEL}:message_reactions`,
		])
		expect(targets(routeRow(routing, "chat_sync_message_links", { channelLinkId: LINK }))).toEqual([
			`channel/${HOST_CHANNEL}:chat_sync_message_links`,
		])
	})

	it("derives user_organizations from active memberships", () => {
		const routed = routeRow(routing, "organization_members", {
			id: MEMBER,
			organizationId: ORG,
			userId: ALICE,
			deletedAt: null,
		})
		expect(targets(routed)).toEqual([
			`org/${ORG}:organization_members`,
			`user/${ALICE}:user_organizations`,
		])
		expect(routed[1]!.row).toEqual({ organizationId: ORG })
		const removed = routeRow(routing, "organization_members", {
			organizationId: GUEST_ORG,
			userId: ALICE,
			deletedAt: at,
		})
		expect(targets(removed)).toEqual([`org/${GUEST_ORG}:organization_members`])
	})

	it("partitions org-owned rows through their parents", () => {
		expect(targets(routeRow(routing, "channel_members", { channelId: GUEST_CHANNEL }))).toEqual([
			`org/${GUEST_ORG}:channel_members`,
		])
		expect(
			targets(routeRow(routing, "chat_sync_channel_links", { syncConnectionId: CONNECTION })),
		).toEqual([`org/${GUEST_ORG}:chat_sync_channel_links`])
		expect(targets(routeRow(routing, "bots", { id: BOT }))).toEqual(["directory:bots", `org/${ORG}:bots`])
	})

	it("sends Connect rows to the host and the mounting orgs", () => {
		expect(targets(routeRow(routing, "connect_conversations", { id: CONVERSATION }))).toEqual([
			`org/${ORG}:connect_conversations`,
			`org/${GUEST_ORG}:connect_conversations`,
		])
		const participant = routeRow(routing, "connect_participants", {
			id: "old",
			conversationId: CONVERSATION,
			userId: BOB,
		})
		expect(targets(participant)).toEqual([`org/${ORG}:connect_participants`])
		expect(participant[0]!.row.id).toBe(participantIdFor(CONVERSATION, BOB))
	})

	it("routes notifications and presence to the user (and presence to their orgs)", () => {
		expect(targets(routeRow(routing, "notifications", { memberId: MEMBER }))).toEqual([
			`user/${ALICE}:notifications`,
		])
		expect(targets(routeRow(routing, "user_presence_status", { userId: ALICE }))).toEqual([
			`org/${ORG}:user_presence_status`,
			`user/${ALICE}:user_presence_status`,
		])
	})

	it("drops what has no owner, and tables the import skips", () => {
		expect(routeRow(routing, "attachments", { channelId: null })).toEqual([])
		expect(routeRow(routing, "notifications", { memberId: "unknown" })).toEqual([])
		expect(routeRow(routing, "channel_access", { channelId: HOST_CHANNEL })).toEqual([])
		expect(routeRow(routing, "typing_indicators", { channelId: HOST_CHANNEL })).toEqual([])
	})
})

describe("encoding", () => {
	it("encodes Postgres values into the stored form, and the receiver accepts it", async () => {
		const routed = routeRow(routing, "users", user(ALICE))[0]!
		const encoded = Option.getOrThrow(await Effect.runPromise(encodeRouted(routed)))
		expect(encoded).toMatchObject({
			id: ALICE,
			createdAt: "2026-01-02 03:04:05.678",
			settings: JSON.stringify({ theme: "dark" }),
			isOnboarded: 1,
			deletedAt: null,
		})
		// Columns Postgres lacked keep their defaults.
		expect("authActive" in encoded).toBe(false)

		const table = Option.getOrThrow(importTableOf("directory", "users"))
		const canonical = await Effect.runPromise(canonicalRow(table, encoded))
		expect(canonical).toEqual(encoded)
		const statement = upsertStatement(table, canonical)
		expect(statement.sql.startsWith('INSERT OR REPLACE INTO "users" (')).toBe(true)
		expect(statement.params).toHaveLength(Object.keys(canonical).length)
	})

	it("retries Postgres text forms (int8 as string, Date into a text column)", async () => {
		const table = {
			name: "t",
			columns: { count: SQLite.integer, note: SQLite.text },
			defaults: [],
		} as unknown as ImportTable
		const encoded = await Effect.runPromise(encodeImportRow(table, { count: "7", note: at }))
		expect(encoded).toEqual({ count: 7, note: at.toISOString() })
	})

	it("rejects a row its table refuses", async () => {
		const routed = routeRow(routing, "users", { ...user(ALICE), userType: "alien" })[0]!
		expect(Option.isNone(await Effect.runPromise(encodeRouted(routed)))).toBe(true)
	})

	it("knows every store table it routes to", () => {
		expect(Option.isSome(importTableOf("user", schema.userOrganizationsTable.name))).toBe(true)
		expect(Option.isNone(importTableOf("channel", "users"))).toBe(true)
	})
})
