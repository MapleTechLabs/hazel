import { createEffectCollection, SyncHub, sourceSet } from "@hazel/effect-db-collection"
import { fakeSockets } from "@hazel/effect-db-collection/testing"
import { OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UserOrganization } from "./collections"
import { orgSourcesSettled, type RememberedOrgSources, startSyncSession } from "./sync-manager"

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const userId = UserId.make(uuid(1))
const orgA = OrganizationId.make(uuid(10))
const orgB = OrganizationId.make(uuid(11))
const orgC = OrganizationId.make(uuid(12))
const host = OrganizationId.make(uuid(20))

const Conversation = Schema.Struct({
	id: Schema.String,
	hostOrganizationId: OrganizationId,
	deletedAt: Schema.NullOr(Schema.String),
})

const hubs: Array<SyncHub> = []
let count = 0

const memory = (initial: Record<string, ReadonlyArray<string>> = {}) => {
	const stored = new Map(Object.entries(initial))
	const remembered: RememberedOrgSources = {
		read: (id) => stored.get(id) as ReturnType<RememberedOrgSources["read"]>,
		write: (id, sources) => void stored.set(id, sources),
	}
	return { remembered, stored }
}

const setup = (rememberedOrgSources?: RememberedOrgSources) => {
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://api.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		backoff: { initialDelayMs: 5, maxDelayMs: 20, jitter: false },
		releaseGraceMs: 0,
		log: () => {},
	})
	hubs.push(hub)
	const userSources = sourceSet()
	const orgSources = sourceSet()
	const userOrganizations = createEffectCollection({
		id: `user_organizations-${++count}`,
		table: "user_organizations",
		schema: UserOrganization,
		getKey: (row) => row.organizationId,
		hub,
		sources: userSources,
	})
	const connectConversations = createEffectCollection({
		id: `connect_conversations-${count}`,
		table: "connect_conversations",
		schema: Conversation,
		getKey: (row) => row.id,
		hub,
		sources: orgSources,
	})
	const stop = startSyncSession(
		{ userSources, orgSources, userOrganizations, connectConversations, rememberedOrgSources },
		userId,
	)
	return { sockets, hub, userSources, orgSources, userOrganizations, connectConversations, stop }
}

const socketFor = async (sockets: ReturnType<typeof fakeSockets>, path: string) => {
	await vi.waitFor(() => expect(sockets.count(path)).toBeGreaterThanOrEqual(1))
	return sockets.latest(path)!
}

const joined = (organizationId: string) => ({ organizationId, joinedAt: "2026-10-01T00:00:00.000Z" })

afterEach(() => {
	for (const hub of hubs.splice(0)) hub.close()
})

describe("sync connection manager", () => {
	it("opens the user's object, then an org source per user_organizations row", async () => {
		const { sockets, userSources, orgSources } = setup()
		expect(userSources.get()).toEqual([`user:${userId}`])
		// Unknown until the user's object has synced: org collections are not ready meanwhile.
		expect(orgSources.get()).toBeUndefined()

		const user = await socketFor(sockets, `/sync/user/${userId}`)
		user.snapshot(1, { user_organizations: [joined(orgA), joined(orgB)] })
		await vi.waitFor(() => expect(orgSources.get()).toEqual([`org:${orgA}`, `org:${orgB}`]))
		await socketFor(sockets, `/sync/org/${orgA}`)
		await socketFor(sockets, `/sync/org/${orgB}`)

		// Joining one org and leaving another follows the user's object.
		user.commit(2, { user_organizations: { upserts: [joined(orgC)], deletes: [orgA] } })
		await vi.waitFor(() => expect(orgSources.get()).toEqual([`org:${orgB}`, `org:${orgC}`]))
		await vi.waitFor(() => expect(sockets.latest(`/sync/org/${orgA}`)?.isClosed).toBe(true))
	})

	it("adds the host org of each Connect conversation the user sees, until it ends", async () => {
		const { sockets, orgSources } = setup()
		const user = await socketFor(sockets, `/sync/user/${userId}`)
		user.snapshot(1, { user_organizations: [joined(orgA)] })
		const org = await socketFor(sockets, `/sync/org/${orgA}`)
		org.snapshot(1, {
			connect_conversations: [{ id: "conversation-1", hostOrganizationId: host, deletedAt: null }],
		})
		await vi.waitFor(() => expect(orgSources.get()).toEqual([`org:${orgA}`, `org:${host}`]))
		await socketFor(sockets, `/sync/org/${host}`)

		org.commit(2, {
			connect_conversations: {
				upserts: [
					{ id: "conversation-1", hostOrganizationId: host, deletedAt: "2026-10-02T00:00:00.000Z" },
				],
			},
		})
		await vi.waitFor(() => expect(orgSources.get()).toEqual([`org:${orgA}`]))
	})

	it("opens the remembered orgs beside the user's object, then follows its rows", async () => {
		const { remembered, stored } = memory({ [userId]: [`org:${orgA}`, `org:${orgB}`] })
		const { sockets, orgSources } = setup(remembered)
		expect(orgSources.get()).toEqual([`org:${orgA}`, `org:${orgB}`])
		// Both org sockets open before the user's object has answered.
		await socketFor(sockets, `/sync/org/${orgA}`)
		await socketFor(sockets, `/sync/org/${orgB}`)
		expect(sockets.count(`/sync/user/${userId}`)).toBe(1)

		// The user left orgB and joined orgC since: the real set replaces the guess and is remembered.
		const user = sockets.latest(`/sync/user/${userId}`)!
		user.snapshot(1, { user_organizations: [joined(orgA), joined(orgC)] })
		await vi.waitFor(() => expect(orgSources.get()).toEqual([`org:${orgA}`, `org:${orgC}`]))
		expect(stored.get(userId)).toEqual([`org:${orgA}`, `org:${orgC}`])
		await socketFor(sockets, `/sync/org/${orgC}`)
	})

	it("remembers the org set for the next load", async () => {
		const { remembered, stored } = memory()
		const { sockets, orgSources } = setup(remembered)
		expect(orgSources.get()).toBeUndefined()
		const user = await socketFor(sockets, `/sync/user/${userId}`)
		user.snapshot(1, { user_organizations: [joined(orgA)] })
		await vi.waitFor(() => expect(stored.get(userId)).toEqual([`org:${orgA}`]))
	})

	it("closes every source when the session stops (sign-out)", async () => {
		const { sockets, userSources, orgSources, stop } = setup()
		const user = await socketFor(sockets, `/sync/user/${userId}`)
		user.snapshot(1, { user_organizations: [joined(orgA)] })
		const org = await socketFor(sockets, `/sync/org/${orgA}`)
		org.snapshot(1, {})

		stop()
		expect(userSources.get()).toBeUndefined()
		expect(orgSources.get()).toBeUndefined()
		await vi.waitFor(() => {
			expect(user.isClosed).toBe(true)
			expect(org.isClosed).toBe(true)
		})
	})

	it("settles the org sources once the user's object and every org source have answered", async () => {
		const { remembered } = memory({ [userId]: [`org:${orgA}`] })
		const { sockets, hub, orgSources, userOrganizations, connectConversations } = setup(remembered)
		const settled = orgSourcesSettled({
			userOrganizations,
			userOrganizationsStatus: userOrganizations,
			connectConversations,
			orgSources,
			hub,
		})
		// Whenever the user's organizations change, the remembered set must not count as settled:
		// the manager may not have applied the real set yet (listener order is not guaranteed).
		const settledOnArrival: Array<boolean> = []
		userOrganizations.on("status:change", () => void settledOnArrival.push(settled.isSettled()))
		let changes = 0
		const unsubscribe = settled.subscribe(() => void changes++)
		expect(settled.isSettled()).toBe(false)

		// The remembered org answers first: still a guess until the user's object has.
		const rememberedOrg = await socketFor(sockets, `/sync/org/${orgA}`)
		rememberedOrg.snapshot(1, {})
		await vi.waitFor(() => expect(hub.connectionOf(`org:${orgA}`)?.isSettled).toBe(true))
		expect(settled.isSettled()).toBe(false)

		// The user joined orgB since: its source opens, and nothing is settled until it answers.
		const user = sockets.latest(`/sync/user/${userId}`)!
		user.snapshot(1, { user_organizations: [joined(orgA), joined(orgB)] })
		await vi.waitFor(() => expect(orgSources.get()).toEqual([`org:${orgA}`, `org:${orgB}`]))
		expect(settled.isSettled()).toBe(false)
		const joinedSocket = await socketFor(sockets, `/sync/org/${orgB}`)
		joinedSocket.snapshot(1, {})
		await vi.waitFor(() => expect(settled.isSettled()).toBe(true))
		expect(changes).toBeGreaterThan(0)
		expect(settledOnArrival.length).toBeGreaterThan(0)
		expect(settledOnArrival.every((isSettled) => !isSettled)).toBe(true)
		unsubscribe()
	})
})
