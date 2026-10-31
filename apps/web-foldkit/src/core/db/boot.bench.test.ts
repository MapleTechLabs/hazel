/**
 * Time from page load to the org shell, for the old boot order and the new one. Run with
 * `BENCH=1 bunx vitest run src/core/db/boot.bench.test.ts`.
 *
 * The hub, the collections and `startSyncSession` are the real ones; the sockets are fakes that
 * answer after a delay, and the HTTP calls are sleeps. The delays are the api Worker's own span
 * durations in production (Maple, 2026-10-24 to 2026-10-31) plus a browser-to-edge round trip
 * (`RTT_MS`); a socket costs two round trips (connect, upgrade) before its server time.
 */
import { createEffectCollection, SyncHub, sourceSet } from "@hazel/effect-db-collection"
import { type FakeSocket, fakeSockets } from "@hazel/effect-db-collection/testing"
import { OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { UserOrganization } from "./collections"
import { type RememberedOrgSources, startSyncSession } from "./sync-manager"

const RTT_MS = Number(process.env.BENCH_RTT_MS ?? 40)

/** Server time per hop, in ms: `Auth.getSession`, `user.me`, `POST /auth/token`, `GET /sync/*`. */
const PERCENTILES = {
	p50: { session: 26, userMe: 62, token: 26, socket: 173 },
	p90: { session: 76, userMe: 216, token: 76, socket: 844 },
} as const
type Hops = (typeof PERCENTILES)[keyof typeof PERCENTILES]

const userId = UserId.make("00000000-0000-4000-8000-000000000001")
const orgA = OrganizationId.make("00000000-0000-4000-8000-000000000010")
const Org = Schema.Struct({ id: Schema.String, slug: Schema.String })

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const http = (serverMs: number) => sleep(RTT_MS + serverMs)

let count = 0

/** One page load; resolves with the ms until the org row is on screen. */
const load = async (hops: Hops, order: "before" | "after", remembered: boolean): Promise<number> => {
	const start = performance.now()
	const sockets = fakeSockets()
	// A socket answers with its snapshot once connected and its server time has passed.
	const answered = new Set<FakeSocket>()
	const answer = setInterval(() => {
		for (const socket of sockets.all) {
			if (answered.has(socket)) continue
			answered.add(socket)
			const tables: Record<string, ReadonlyArray<unknown>> = socket.url.includes("/sync/user/")
				? { user_organizations: [{ organizationId: orgA, joinedAt: "2026-10-01T00:00:00.000Z" }] }
				: { organizations: [{ id: orgA, slug: "hazel" }] }
			setTimeout(() => socket.snapshot(1, tables), 2 * RTT_MS + hops.socket)
		}
	}, 1)

	const warmToken = order === "after" ? http(hops.token).then(() => "token") : undefined
	const hub = new SyncHub({
		baseUrl: "https://api.test",
		getToken: () => warmToken ?? http(hops.token).then(() => "token"),
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		log: () => {},
	})
	const userSources = sourceSet()
	const orgSources = sourceSet()
	const id = ++count
	const userOrganizations = createEffectCollection({
		id: `bench-user_organizations-${id}`,
		table: "user_organizations",
		schema: UserOrganization,
		getKey: (row) => row.organizationId,
		hub,
		sources: userSources,
	})
	const connectConversations = createEffectCollection({
		id: `bench-connect_conversations-${id}`,
		table: "connect_conversations",
		schema: Schema.Struct({
			id: Schema.String,
			hostOrganizationId: OrganizationId,
			deletedAt: Schema.Null,
		}),
		getKey: (row) => row.id,
		hub,
		sources: orgSources,
	})
	const organizations = createEffectCollection({
		id: `bench-organizations-${id}`,
		table: "organizations",
		schema: Org,
		getKey: (row) => row.id,
		hub,
		sources: orgSources,
	})
	const rememberedOrgSources: RememberedOrgSources = {
		read: () => (remembered ? [`org:${orgA}`] : undefined),
		write: () => {},
	}

	// Before: the session check, then `user.me`, then the sockets (which exchange the token).
	// After: `user.me` and the token beside the session check; the sockets once `user.me` answers.
	if (order === "before") {
		await http(hops.session)
		await http(hops.userMe)
	} else {
		await Promise.all([http(hops.session), http(hops.userMe)])
	}
	const stop = startSyncSession(
		order === "before"
			? { userSources, orgSources, userOrganizations, connectConversations }
			: { userSources, orgSources, userOrganizations, connectConversations, rememberedOrgSources },
		userId,
	)
	await organizations.preload()
	expect(organizations.get(orgA)).toBeDefined()
	const elapsed = performance.now() - start

	clearInterval(answer)
	stop()
	for (const collection of [userOrganizations, connectConversations, organizations])
		await collection.cleanup()
	hub.close()
	return elapsed
}

const RUNS = Number(process.env.BENCH_RUNS ?? 5)
const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

describe.skipIf(!process.env.BENCH)("boot to org shell", () => {
	it("compares the old boot order with the new one", { timeout: 120_000 }, async () => {
		const results: Array<Record<string, string>> = []
		for (const [label, hops] of Object.entries(PERCENTILES)) {
			const runs = {
				before: [] as Array<number>,
				first: [] as Array<number>,
				returning: [] as Array<number>,
			}
			for (let run = 0; run < RUNS; run++) {
				runs.before.push(await load(hops, "before", false))
				runs.first.push(await load(hops, "after", false))
				runs.returning.push(await load(hops, "after", true))
			}
			const before = median(runs.before)
			const row = (value: number) => `${value.toFixed(0)} ms (−${(before - value).toFixed(0)})`
			results.push({
				hops: `${label} server, ${RTT_MS} ms RTT`,
				before: `${before.toFixed(0)} ms`,
				"after, first visit": row(median(runs.first)),
				"after, return visit": row(median(runs.returning)),
			})
		}
		console.table(results)
	})
})
