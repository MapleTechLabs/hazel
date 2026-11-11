import {
	Channel,
	ChannelMember,
	ChannelSection,
	Message,
	MessageReaction,
	Notification,
	Organization,
	OrganizationMember,
	PinnedMessage,
	User,
	UserPresenceStatus,
} from "@hazel/domain/models"
import { type SyncSourceKind } from "@hazel/domain/sync"
import {
	type CollectionSources,
	createEffectCollection,
	type SourceKey,
	SyncHub,
	type SyncLogger,
} from "@hazel/effect-db-collection"
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { FIXTURE_TOKEN, fixtureFetch, makeFixtureWebSocket } from "./fixture-socket"
import {
	adaUserId,
	channelIds,
	designChannelId,
	generalChannelId,
	orgId,
	SOURCE_TABLES,
	snapshotFor,
} from "./snapshot"

/** The app's `parseTimestamps` (`core/db/collections.ts`): ISO strings become `Date`s before decoding. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const parseTimestamps = (row: unknown): Record<string, unknown> =>
	Object.fromEntries(
		(typeof row === "object" && row !== null ? Object.entries(row) : []).map(([key, value]) => [
			key,
			typeof value === "string" && ISO_TIMESTAMP.test(value) ? new Date(value) : value,
		]),
	)

const UserOrganization = Schema.Struct({
	organizationId: OrganizationId,
	joinedAt: Schema.Union([Schema.DateTimeUtcFromString, Schema.Date]),
})

/** The schema each table's collection decodes with in `collections.ts`. */
const TABLE_SCHEMAS = new Map<string, Schema.Decoder<unknown>>([
	["user_organizations", UserOrganization],
	["organizations", Organization.Schema],
	["users", User.Schema],
	["organization_members", OrganizationMember.Schema],
	["user_presence_status", UserPresenceStatus.Schema],
	["channels", Channel.Schema],
	["channel_members", ChannelMember.Schema],
	["channel_sections", ChannelSection.Schema],
	["notifications", Notification.Schema],
	["messages", Message.Schema],
	["message_reactions", MessageReaction.Schema],
	["pinned_messages", PinnedMessage.Schema],
])

const user = `user:${adaUserId}` as const
const org = `org:${orgId}` as const
const general = `channel:${generalChannelId}` as const

let cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
	for (const run of cleanup.reverse()) await run()
	cleanup = []
})

const setup = (WebSocket = makeFixtureWebSocket(), multiplex = true) => {
	const warnings: Array<string> = []
	const log: SyncLogger = (level, message) => {
		if (level !== "debug") warnings.push(message)
	}
	const hub = new SyncHub({
		baseUrl: "http://localhost:3003",
		getToken: async () => FIXTURE_TOKEN,
		WebSocket,
		multiplex,
		releaseGraceMs: 0,
		log,
	})
	cleanup.push(() => hub.close())
	let count = 0
	const collection = <A extends object>(
		table: string,
		schema: Schema.Schema<A>,
		sources: CollectionSources,
		getKey: (row: A) => string,
	) => {
		const created = createEffectCollection<A, string>({
			id: `fixture-${table}-${++count}`,
			table,
			schema,
			parseRow: parseTimestamps,
			getKey,
			hub,
			sources,
		})
		cleanup.push(() => created.cleanup())
		return created
	}
	const byId = (row: { readonly id: string }) => row.id
	return { hub, warnings, collection, byId }
}

describe("fixture snapshot", () => {
	it("decodes every row of every source with its collection's schema", () => {
		const sources: ReadonlyArray<readonly [SyncSourceKind, string]> = [
			["user", adaUserId],
			["org", orgId],
			...channelIds.map((id) => ["channel", id] as const),
		]
		for (const [kind, id] of sources) {
			const tables = snapshotFor(kind, id)
			expect(Object.keys(tables ?? {})).toEqual([...SOURCE_TABLES[kind]])
			for (const [table, rows] of Object.entries(tables ?? {})) {
				const schema = TABLE_SCHEMAS.get(table)
				if (rows.length > 0) expect(schema, table).toBeDefined()
				if (schema === undefined) continue
				const decode = Schema.decodeUnknownSync(schema)
				for (const row of rows) expect(() => decode(parseTimestamps(row)), table).not.toThrow()
			}
		}
		expect(snapshotFor("org", "00000000-0000-4000-8000-000000000999")).toBeUndefined()
	})
})

describe("fixture socket", () => {
	it("syncs the user, org and #general sources through the mux into collections", async () => {
		const { hub, warnings, collection, byId } = setup()
		const sources = (...keys: Array<SourceKey>) => keys
		const userOrganizations = collection("user_organizations", UserOrganization, sources(user), (row) =>
			String(row.organizationId),
		)
		const organizations = collection("organizations", Organization.Schema, sources(org), byId)
		const users = collection("users", User.Schema, sources(org), byId)
		const members = collection("organization_members", OrganizationMember.Schema, sources(org), byId)
		const channels = collection("channels", Channel.Schema, sources(org), byId)
		const channelMembers = collection("channel_members", ChannelMember.Schema, sources(org), byId)
		const sections = collection("channel_sections", ChannelSection.Schema, sources(org), byId)
		const presence = collection(
			"user_presence_status",
			UserPresenceStatus.Schema,
			sources(user, org),
			byId,
		)
		const notifications = collection("notifications", Notification.Schema, sources(user), byId)
		const messages = collection("messages", Message.Schema, sources(general), byId)
		const reactions = collection("message_reactions", MessageReaction.Schema, sources(general), byId)
		const pins = collection("pinned_messages", PinnedMessage.Schema, sources(general), byId)

		const all = [
			userOrganizations,
			organizations,
			users,
			members,
			channels,
			channelMembers,
			sections,
			presence,
			notifications,
			messages,
			reactions,
			pins,
		]
		await Promise.all(all.map((c) => c.preload()))

		expect(userOrganizations.toArray.map((row) => row.organizationId)).toEqual([orgId])
		expect(organizations.toArray.map((row) => [row.name, row.slug])).toEqual([["Hazel", "hazel"]])
		expect(users.size).toBe(6)
		const ada = users.toArray.find((row) => row.id === adaUserId)
		expect([ada?.firstName, ada?.lastName, ada?.email]).toEqual(["Ada", "Lovelace", "ada@hazel.test"])
		expect(members.toArray.find((row) => row.userId === adaUserId)?.role).toBe("owner")
		expect(channels.size).toBe(9)
		expect(sections.size).toBe(3)
		const adasChannels = channelMembers.toArray.filter((row) => row.userId === adaUserId)
		expect(new Set(adasChannels.map((row) => row.channelId))).toEqual(new Set(channelIds))
		expect(presence.size).toBe(6)
		expect(
			notifications.toArray.filter((row) => row.targetedResourceId === designChannelId),
		).toHaveLength(3)
		expect(messages.size).toBe(60)
		expect(messages.toArray.every((row) => row.createdAt instanceof Date)).toBe(true)
		expect(reactions.size).toBeGreaterThan(0)
		expect(pins.size).toBe(1)
		expect(hub.connectionOf(general)?.status.state).toBe("ready")
		expect(warnings).toEqual([])
	})

	it("serves with latency and refuses a source it does not know", async () => {
		const { hub, collection, byId } = setup(makeFixtureWebSocket({ latencyMs: 5 }))
		const missing = `channel:00000000-0000-4000-8000-000000000999` as const
		const messages = collection("messages", Message.Schema, [general, missing], byId)
		await messages.preload()
		expect(messages.size).toBe(60)
		expect(hub.connectionOf(missing)?.error?._tag).toBe("SyncSourceNotFoundError")
	})

	it("answers per-source sockets when the hub does not multiplex", async () => {
		const { hub, warnings, collection, byId } = setup(makeFixtureWebSocket(), false)
		const channels = collection("channels", Channel.Schema, [org], byId)
		const messages = collection("messages", Message.Schema, [general], byId)
		await Promise.all([channels.preload(), messages.preload()])
		expect(channels.size).toBe(9)
		expect(messages.size).toBe(60)
		expect(hub.connectionOf(org)?.status.state).toBe("ready")
		expect(warnings).toEqual([])
	})
})

describe("fixtureFetch", () => {
	it("exchanges a token and 404s everything else", async () => {
		const token = await fixtureFetch("http://localhost:3003/auth/token", { method: "POST" })
		expect(await token.json()).toEqual({ token: FIXTURE_TOKEN, expiresIn: 3600 })
		const other = await fixtureFetch("http://localhost:3003/users/me")
		expect(other.status).toBe(404)
	})
})
