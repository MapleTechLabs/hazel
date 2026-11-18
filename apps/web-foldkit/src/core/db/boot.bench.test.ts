/**
 * Time from the HTML to the org shell and to a channel's messages, for each boot order. Run with
 * `BENCH=1 bunx vitest run src/core/db/boot.bench.test.ts --reporter=verbose`.
 *
 * The hub, the collections and `startSyncSession` are the real ones; the sockets are fakes that
 * answer after a delay, and the HTTP calls are sleeps. The delays are the api Worker's own span
 * durations in production (Maple, 2026-10-24 to 2026-10-31) plus a browser-to-edge round trip
 * (`RTT_MS`). A socket costs a round trip to the route, one to its object, and the object's wake:
 * user and channel objects are usually cold at boot, org objects warm (other members keep them
 * up). A wake started early (`POST /sync/warm`) leaves only what is left of it when the socket arrives.
 *
 * - `main`: session check → `user.me` → token → user socket → org socket, after the script ran.
 * - `parallel`: `user.me` and the token beside the session check; org sockets from the remembered set.
 * - `early`: plus the token exchange and the object wakes from `index.html`, before the script runs,
 *   and no `OPTIONS` round trip (preflights cached 2h).
 * - `cached`: plus the remembered user and the local cache (`node:sqlite` in place of wa-sqlite on
 *   OPFS, which is slower): the sources open when the script runs, without `user.me`, the org
 *   shell's rows come from disk, and the wakes start beside the token exchange instead of after it.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import {
	type BrowserWASQLiteDatabase,
	createBrowserWASQLitePersistence,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import {
	type CollectionSources,
	createEffectCollection,
	SyncHub,
	sourceSet,
} from "@hazel/effect-db-collection"
import { type FakeSocket, fakeSockets } from "@hazel/effect-db-collection/testing"
import { OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { UserOrganization } from "./collections"
import { type RememberedOrgSources, startSyncSession } from "./sync-manager"

const RTT_MS = Number(process.env.BENCH_RTT_MS ?? 40)
/** The app's script loading and running from cache before its first request (assumed). */
const SCRIPT_MS = Number(process.env.BENCH_SCRIPT_MS ?? 250)

/** Server ms per hop: the route's own work, a warm object, a cold user or channel object. */
const PERCENTILES = {
	p50: { session: 26, userMe: 62, token: 26, route: 41, warm: 34, coldUser: 895, coldChannel: 754 },
	p90: { session: 76, userMe: 216, token: 76, route: 75, warm: 61, coldUser: 1062, coldChannel: 1252 },
} as const
type Hops = (typeof PERCENTILES)[keyof typeof PERCENTILES]
type Order = "main" | "parallel" | "early" | "cached"

const userId = UserId.make("00000000-0000-4000-8000-000000000001")
const orgA = OrganizationId.make("00000000-0000-4000-8000-000000000010")
const channelId = "00000000-0000-4000-8000-000000000020"
const Row = Schema.Struct({ id: Schema.String })

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The persistence's database handle over `node:sqlite`. */
const nodeDatabase = (path: string): BrowserWASQLiteDatabase & { readonly close: () => void } => {
	const db = new DatabaseSync(path)
	return {
		execute: async <TRow>(sql: string, params: ReadonlyArray<unknown> = []) => {
			if (params.length === 0 && sql.trim().replace(/;$/, "").includes(";")) {
				db.exec(sql)
				return []
			}
			const statement = db.prepare(sql)
			// SAFETY: the persistence binds only what SQLite stores (text, numbers, blobs, null).
			const args = params as Array<SQLInputValue>
			// SAFETY: a statement's rows are objects keyed by its columns, which is what the caller names.
			if (statement.columns().length > 0) return statement.all(...args) as Array<TRow>
			statement.run(...args)
			return []
		},
		close: () => db.close(),
	}
}

let count = 0

/**
 * One page load; the ms from the HTML until the org row, and until the channel's rows. `cache`
 * is the file the eager collections keep their rows in (`cached`, and the load that fills it).
 */
const load = async (
	hops: Hops,
	order: Order,
	cache?: { readonly path: string; readonly isFilled: boolean },
): Promise<{ shell: number; channel: number }> => {
	const start = performance.now()
	const now = () => performance.now() - start
	const isEarly = order === "early" || order === "cached"
	/** The user is remembered and their rows are on disk. */
	const isCached = cache?.isFilled === true
	// Before `early`, each request waited a round trip on its preflight.
	const http = (serverMs: number) => sleep((isEarly ? 1 : 2) * RTT_MS + serverMs)

	// When each cold object started waking.
	const wakeStartedAt: Partial<Record<"user" | "channel", number>> = {}
	const wake = (kind: "user" | "channel") => (wakeStartedAt[kind] ??= now())
	const objectMs = (kind: "user" | "channel" | "org") => {
		if (kind === "org") return hops.warm
		const cold = kind === "user" ? hops.coldUser : hops.coldChannel
		return Math.max(hops.warm, wake(kind) + cold - now())
	}

	const sockets = fakeSockets()
	const answered = new Set<FakeSocket>()
	const answer = setInterval(() => {
		for (const socket of sockets.all) {
			if (answered.has(socket)) continue
			answered.add(socket)
			const kind = socket.url.includes("/sync/user/")
				? "user"
				: socket.url.includes("/sync/channel/")
					? "channel"
					: "org"
			const tables: Record<string, ReadonlyArray<unknown>> = kind === "user"
				? { user_organizations: [{ organizationId: orgA, joinedAt: "2026-10-01T00:00:00.000Z" }] }
				: kind === "channel"
					? { messages: [{ id: "message-1" }] }
					: { organizations: [{ id: orgA }] }
			// The route answers after its round trip; the object is reached, and woken, then.
			setTimeout(() => {
				setTimeout(() => socket.snapshot(1, tables), objectMs(kind))
			}, RTT_MS + hops.route)
		}
	}, 1)

	// `early`: the token from `index.html` at once, then the warm-up wakes the objects; `cached`
	// asks for the wakes beside the token (the session cookie is enough).
	const earlyToken = isEarly ? http(hops.token).then(() => "token") : undefined
	void (order === "cached" ? Promise.resolve() : earlyToken)?.then(() =>
		sleep(RTT_MS + hops.route).then(() => {
			wake("user")
			wake("channel")
		}),
	)
	await sleep(SCRIPT_MS)
	const appToken = order === "parallel" ? http(hops.token).then(() => "token") : undefined
	const hub = new SyncHub({
		baseUrl: "https://api.test",
		getToken: () => earlyToken ?? appToken ?? http(hops.token).then(() => "token"),
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		log: () => {},
	})
	const userSources = sourceSet()
	const orgSources = sourceSet()
	const id = ++count
	const database = cache === undefined ? undefined : nodeDatabase(cache.path)
	const persistence = database === undefined ? undefined : createBrowserWASQLitePersistence({ database })
	// A stored collection is named by its id: the same across the loads on one file.
	const idOf = (table: string) => (cache === undefined ? `bench-${table}-${id}` : `bench-${table}`)
	const persist =
		persistence === undefined
			? undefined
			: <O extends object>(options: O) =>
					persistedCollectionOptions({
						...(options as O & Parameters<typeof persistedCollectionOptions>[0]),
						persistence,
						schemaVersion: 1,
					})
	const collection = (table: string, sources: CollectionSources) =>
		createEffectCollection(
			{ id: idOf(table), table, schema: Row, getKey: (row) => row.id, hub, sources },
			// As in the app: a channel's collections keep nothing.
			Array.isArray(sources) ? undefined : persist,
		)
	const userOrganizations = createEffectCollection(
		{
			id: idOf("user_organizations"),
			table: "user_organizations",
			schema: UserOrganization,
			getKey: (row) => row.organizationId,
			hub,
			sources: userSources,
		},
		persist,
	)
	const connectConversations = createEffectCollection(
		{
			id: idOf("connect_conversations"),
			table: "connect_conversations",
			schema: Schema.Struct({
				id: Schema.String,
				hostOrganizationId: OrganizationId,
				deletedAt: Schema.Null,
			}),
			getKey: (row) => row.id,
			hub,
			sources: orgSources,
		},
		persist,
	)
	const organizations = collection("organizations", orgSources)
	// The chat page's message query opens its channel as soon as the page exists (at boot).
	const messages = collection("messages", [`channel:${channelId}`])
	const channelReady = messages.preload().then(now)
	const rememberedOrgSources: RememberedOrgSources = {
		read: () => (order === "main" ? undefined : [`org:${orgA}`]),
		write: () => {},
	}

	if (order === "main") await http(hops.session)
	// A remembered user is known when the script runs: nothing waits for `user.me`.
	if (!isCached) await http(hops.userMe)
	const stop = startSyncSession(
		{ userSources, orgSources, userOrganizations, connectConversations, rememberedOrgSources },
		userId,
	)
	await organizations.preload()
	expect(organizations.get(orgA)).toBeDefined()
	const shell = now()
	const channel = await channelReady

	// The seqs the next load resumes from are stored a moment after their rows.
	if (cache !== undefined && !cache.isFilled) await sleep(1200)
	clearInterval(answer)
	// An unload: the collections stop before the sources are let go, so their rows stay on disk.
	for (const c of [userOrganizations, connectConversations, organizations, messages]) await c.cleanup()
	stop()
	hub.close()
	database?.close()
	return { shell, channel }
}

/** A `cached` load: the load before it left the user's rows on disk. */
const loadCached = async (hops: Hops) => {
	const dir = mkdtempSync(join(tmpdir(), "hazel-boot-bench-"))
	try {
		const path = join(dir, "cache.sqlite")
		await load(hops, "cached", { path, isFilled: false })
		return await load(hops, "cached", { path, isFilled: true })
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const RUNS = Number(process.env.BENCH_RUNS ?? 5)
const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

describe.skipIf(!process.env.BENCH)("boot", () => {
	it("compares the boot orders", { timeout: 300_000 }, async () => {
		const results: Array<Record<string, string>> = []
		for (const [label, hops] of Object.entries(PERCENTILES)) {
			const runs: Record<Order, Array<{ shell: number; channel: number }>> = {
				main: [],
				parallel: [],
				early: [],
				cached: [],
			}
			for (let run = 0; run < RUNS; run++) {
				for (const order of ["main", "parallel", "early"] as const)
					runs[order].push(await load(hops, order))
				runs.cached.push(await loadCached(hops))
			}
			for (const milestone of ["shell", "channel"] as const) {
				const of = (order: Order) => median(runs[order].map((r) => r[milestone]))
				const main = of("main")
				const cell = (order: Order) =>
					`${of(order).toFixed(0)} ms (−${(main - of(order)).toFixed(0)})`
				results.push({
					case: `${label}, ${milestone === "shell" ? "org shell" : "channel messages"}`,
					main: `${main.toFixed(0)} ms`,
					parallel: cell("parallel"),
					early: cell("early"),
					cached: cell("cached"),
				})
			}
		}
		console.log(`RTT ${RTT_MS} ms, script ${SCRIPT_MS} ms`)
		console.table(results)
	})
})
