/**
 * The pull: the day-by-day walk and its two phases, the cursor that resumes them, the row cap that
 * makes a busy day take several pages, the window a backfill and a scheduled pull each ask for, and
 * how Maple's refusals come back — `auth` stops pulls, a short 429 is waited out, a long one goes
 * to the alarm, a body Hazel cannot read fails the run without a retry, and a tool or protocol
 * failure (Maple's warehouse having a bad moment) is retried.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Fiber, Redacted, Schema } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import type { PullPage } from "../providers"
import {
	DAY_ONE,
	DAY_TWO,
	EVENTS,
	ORG_ACME,
	ORG_GLOBEX,
	ORG_UNKNOWN,
	RUN_SQL_ANSWER,
	USER_ADA,
} from "./fixtures"
import { makeMapleApi } from "./http"
import { decodeCursor, encodeCursor, firstDayOf, pullPage } from "./pull"
import { fakeMapleHttpClient, type FakeMapleState, type MapleEvent, makeFakeMaple, originOf } from "./testing"
import { MapleActivityRow, RunSqlAnswer, RUN_SQL_ROW_CAP } from "./wire"

const API_KEY = "maple_ak_fake0000000000000000"
const NOW = new Date("2026-06-15T12:00:00.000Z")

const config = (overrides: Partial<Extract<ConnectionConfig, { _tag: "maple" }>> = {}) =>
	({
		_tag: "maple",
		region: "us",
		activityEvents: [],
		metricMappings: [],
		lookbackDays: 2,
		...overrides,
	}) satisfies Extract<ConnectionConfig, { _tag: "maple" }>

const pageOf = (
	fake: FakeMapleState,
	options: {
		readonly cursor?: string | null
		readonly since?: Date | null
		readonly config?: Extract<ConnectionConfig, { _tag: "maple" }>
		readonly apiKey?: string
	} = {},
) =>
	Effect.gen(function* () {
		const api = makeMapleApi(
			yield* HttpClient.HttpClient,
			Redacted.make(options.apiKey ?? API_KEY),
			options.config?.region ?? "us",
		)
		return yield* pullPage({
			api,
			config: options.config ?? config(),
			cursor: options.cursor ?? null,
			since: options.since ?? null,
		})
	}).pipe(Effect.provide(fakeMapleHttpClient(fake)))

/** At `NOW`, on a test clock, so the walk's days are the fixtures'. */
const at = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW.getTime())
			return yield* effect
		}).pipe(Effect.provide(TestClock.layer())),
	)

/** Every page of a whole walk, in order. */
const walk = (fake: FakeMapleState, options: Parameters<typeof pageOf>[1] = {}) =>
	Effect.gen(function* () {
		const pages: Array<PullPage> = []
		let cursor: string | null = options.cursor ?? null
		do {
			const next: PullPage = yield* pageOf(fake, { ...options, cursor })
			pages.push(next)
			cursor = next.nextCursor
		} while (cursor !== null && pages.length < 40)
		return pages
	})

const opsOf = (pages: ReadonlyArray<PullPage>) => pages.flatMap((page) => page.ops)

const activityOf = (pages: ReadonlyArray<PullPage>) =>
	opsOf(pages).flatMap((op) =>
		op._tag === "activity"
			? [
					{
						day: op.day,
						account: op.account.externalId,
						contact: op.contact.externalId,
						events: op.eventCount,
						sessions: op.sessionCount,
					},
				]
			: [],
	)

const metricsOf = (pages: ReadonlyArray<PullPage>) =>
	opsOf(pages).flatMap((op) =>
		op._tag === "metric"
			? [{ day: op.day, account: op.account.externalId, key: op.metricKey, value: op.value }]
			: [],
	)

const organization = (options: Partial<FakeMapleState> = {}) =>
	makeFakeMaple({ apiKey: API_KEY, events: EVENTS, ...options })

describe("Maple pull", () => {
	it("reads the whole lookback one day at a time, newest day last", async () => {
		const fake = organization()
		const pages = await at(walk(fake))
		expect(fake.calls.map((call) => [call.start, call.end])).toEqual([
			["2026-06-14 00:00:00", "2026-06-15 00:00:00"],
			["2026-06-15 00:00:00", "2026-06-16 00:00:00"],
		])
		expect(pages.at(-1)?.nextCursor).toBeNull()
		expect(activityOf(pages)).toEqual([
			{
				day: "2026-06-14",
				account: ORG_GLOBEX,
				contact: "user_3A3BBGQ1zv3inaIeM9bJ6KwDQHB",
				events: 2,
				sessions: 1,
			},
			{ day: "2026-06-14", account: ORG_ACME, contact: USER_ADA, events: 4, sessions: 2 },
			{
				day: "2026-06-14",
				account: ORG_ACME,
				contact: "user_3BU6HrCe3nTMKFCvymFTEUlHD7m",
				events: 1,
				sessions: 1,
			},
			{ day: "2026-06-15", account: ORG_ACME, contact: USER_ADA, events: 2, sessions: 1 },
			{
				day: "2026-06-15",
				account: ORG_UNKNOWN,
				contact: "user_3LsFMSVVn6hheSNGK8KtkKUqwaE",
				events: 1,
				sessions: 1,
			},
		])
	})

	it("counts only identified rows: a marketing session and a server event are no one's activity", async () => {
		const pages = await at(walk(organization({ events: DAY_TWO })))
		// Six rows went in; only Ada's two app events and the unknown group's are a person's day.
		expect(activityOf(pages).map((row) => row.account)).toEqual([ORG_ACME, ORG_UNKNOWN])
	})

	it("hits the region's own host and sends the key only in the header", async () => {
		const fake = organization()
		await at(pageOf(fake, { config: config({ region: "eu" }) }))
		expect(fake.paths).toEqual([originOf("eu")])
		expect(new Set(fake.authHeaders)).toEqual(new Set([`Bearer ${API_KEY}`]))
		// Maple's MCP route answers 406 without both media types.
		expect(fake.accepts[0]).toBe("application/json, text/event-stream")
	})

	it("walks the metric phase after the activity one, on the same day", async () => {
		const fake = organization({ events: DAY_ONE })
		const pages = await at(
			walk(fake, {
				config: config({
					lookbackDays: 1,
					metricMappings: [
						{ event: "dashboard_created", metricKey: "dashboards" },
						{ event: "alert_rule_created", metricKey: "dashboards" },
					],
				}),
				since: new Date("2026-06-14T00:00:00.000Z"),
			}),
		)
		expect(pages.map((page) => page.progress.step)).toEqual([
			"activity",
			"metrics",
			"activity",
			"metrics",
		])
		expect(metricsOf(pages)).toEqual([
			{ day: "2026-06-14", account: ORG_GLOBEX, key: "maple.dashboards", value: 1 },
			{ day: "2026-06-14", account: ORG_ACME, key: "maple.dashboards", value: 1 },
		])
		// Declared once, on the phase's first page.
		expect(opsOf(pages).filter((op) => op._tag === "metric_definition")).toHaveLength(2)
	})

	it("sums the events that share a key in the query, so a page boundary cannot split a key", async () => {
		// 101 accounts, each with two events mapped to one key: grouped by event, the 202 rows would
		// put one account's two counts on two pages, and the second would overwrite the first.
		const events: Array<MapleEvent> = Array.from({ length: RUN_SQL_ROW_CAP + 1 }, (_, index) =>
			["dashboard_created", "alert_rule_created"].map((eventName) => ({
				day: "2026-06-15",
				groupId: `org_${String(index).padStart(4, "0")}`,
				userId: "",
				sessionId: "",
				eventName,
			})),
		).flat()
		const fake = organization({ events })
		const pages = await at(
			walk(fake, {
				config: config({
					lookbackDays: 1,
					metricMappings: [
						{ event: "dashboard_created", metricKey: "made" },
						{ event: "alert_rule_created", metricKey: "made" },
					],
				}),
			}),
		)
		expect(fake.calls[1]?.sql).toContain(
			"transform(EventName, ['dashboard_created', 'alert_rule_created'], ['maple.made', 'maple.made']) AS metric",
		)
		expect(pages.map((page) => page.progress.step)).toEqual(["activity", "metrics", "metrics"])
		const metrics = metricsOf(pages)
		expect(metrics).toHaveLength(RUN_SQL_ROW_CAP + 1)
		expect(new Set(metrics.map((metric) => metric.account)).size).toBe(RUN_SQL_ROW_CAP + 1)
		expect(metrics.every((metric) => metric.value === 2)).toBe(true)
	})

	it("skips the metric phase with nothing mapped", async () => {
		const pages = await at(walk(organization(), { config: config({ lookbackDays: 1 }) }))
		expect(pages.map((page) => page.progress.step)).toEqual(["activity"])
	})

	it("skips the metric phase when the mappings were cleared mid-walk, without an empty `IN ()`", async () => {
		const fake = organization()
		const cursor = encodeCursor({ day: "2026-06-14", phase: "metrics", until: "2026-06-15" })
		const page = await at(pageOf(fake, { cursor }))
		expect(fake.calls).toEqual([])
		expect(page.ops).toEqual([])
		expect(decodeCursor(page.nextCursor ?? "")).toMatchObject({
			_tag: "Some",
			value: { day: "2026-06-15", phase: "activity" },
		})
	})

	it("narrows activity to the allowlist when one is set", async () => {
		const fake = organization({ events: DAY_ONE })
		const pages = await at(
			walk(fake, { config: config({ lookbackDays: 1, activityEvents: ["dashboard_created"] }) }),
		)
		expect(fake.calls[0]?.sql).toContain("EventName IN ('dashboard_created')")
		expect(activityOf(pages)).toEqual([])
	})

	it("takes a busy day over several pages, offsetting past the rows it read", async () => {
		const crowd: Array<MapleEvent> = Array.from({ length: RUN_SQL_ROW_CAP + 3 }, (_, index) => ({
			day: "2026-06-15",
			groupId: ORG_ACME,
			userId: `user_${String(index).padStart(4, "0")}`,
			sessionId: `ses_${index}`,
			eventName: "$pageview",
		}))
		const fake = organization({ events: crowd })
		const pages = await at(walk(fake, { config: config({ lookbackDays: 1 }) }))
		expect(fake.calls.map((call) => /OFFSET (\d+)/.exec(call.sql)?.[1])).toEqual(["0", "100"])
		expect(activityOf(pages)).toHaveLength(RUN_SQL_ROW_CAP + 3)
		// One account reference per page, not one per row.
		expect(opsOf(pages).filter((op) => op._tag === "account")).toHaveLength(2)
		expect(pages.map((page) => page.progress.done)).toEqual([100, 103])
	})

	it("follows Maple's `truncated`, not the page size, to the end of a day", async () => {
		const crowd = (count: number): Array<MapleEvent> =>
			Array.from({ length: count }, (_, index) => ({
				day: "2026-06-15",
				groupId: ORG_ACME,
				userId: `user_${String(index).padStart(4, "0")}`,
				sessionId: `ses_${index}`,
				eventName: "$pageview",
			}))
		// Maple renders fewer rows than Hazel's cap: each short page is still followed.
		const short = organization({ events: crowd(RUN_SQL_ROW_CAP + 3), renderedRows: 40 })
		const pages = await at(walk(short, { config: config({ lookbackDays: 1 }) }))
		expect(short.calls.map((call) => /OFFSET (\d+)/.exec(call.sql)?.[1])).toEqual(["0", "40", "80"])
		expect(activityOf(pages)).toHaveLength(RUN_SQL_ROW_CAP + 3)
		// Exactly a page of rows: nothing more fetched, so no empty page follows.
		const exact = organization({ events: crowd(RUN_SQL_ROW_CAP) })
		await at(walk(exact, { config: config({ lookbackDays: 1 }) }))
		expect(exact.calls).toHaveLength(1)
		// Maple renders the whole page without `truncated` (a raised cap): a full page is followed.
		const uncapped = organization({ events: crowd(250), renderedRows: 1_000 })
		const all = await at(walk(uncapped, { config: config({ lookbackDays: 1 }) }))
		expect(uncapped.calls.map((call) => /OFFSET (\d+)/.exec(call.sql)?.[1])).toEqual(["0", "101", "202"])
		expect(activityOf(all)).toHaveLength(250)
	})

	it("re-reads the overlap of a scheduled pull without counting a day twice", async () => {
		const fake = organization()
		const first = await at(walk(fake, { since: new Date("2026-06-15T11:50:00.000Z") }))
		const again = await at(walk(fake, { since: new Date("2026-06-15T11:50:00.000Z") }))
		// One day, read twice, with the same counts: ingest keeps a day's highest activity.
		expect(fake.calls.map((call) => call.start)).toEqual(["2026-06-15 00:00:00", "2026-06-15 00:00:00"])
		expect(activityOf(again)).toEqual(activityOf(first))
	})

	it("starts a backfill at the lookback and a scheduled pull at the day `since` falls in", () => {
		expect(firstDayOf({ since: null, lookbackDays: 90, until: "2026-06-15" })).toBe("2026-03-18")
		expect(
			firstDayOf({
				since: new Date("2026-06-14T23:50:00.000Z"),
				lookbackDays: 90,
				until: "2026-06-15",
			}),
		).toBe("2026-06-14")
		// A clock running ahead reads one day rather than nothing.
		expect(
			firstDayOf({
				since: new Date("2026-07-01T00:00:00.000Z"),
				lookbackDays: 90,
				until: "2026-06-15",
			}),
		).toBe("2026-06-15")
	})

	it("ends the walk where it started, so one past midnight does not run for ever", async () => {
		const cursor = encodeCursor({ day: "2026-06-14", phase: "activity", until: "2026-06-14" })
		const page = await at(pageOf(organization(), { cursor }))
		expect(page.nextCursor).toBeNull()
	})

	it("starts over on a cursor Hazel cannot read", async () => {
		const fake = organization()
		const page = await at(pageOf(fake, { cursor: "{]" }))
		expect(decodeCursor("{]")._tag).toBe("None")
		expect(fake.calls[0]?.start).toBe("2026-06-14 00:00:00")
		expect(page.progress.step).toBe("activity")
	})

	it("never sweeps: Maple is authoritative for nothing", async () => {
		const pages = await at(walk(organization()))
		expect(pages.every((page) => page.sweep === undefined)).toBe(true)
	})

	it("reads a real `run_sql` answer off the wire", () => {
		const decoded = Schema.decodeUnknownSync(RunSqlAnswer(MapleActivityRow))(RUN_SQL_ANSWER)
		expect(decoded.result?.structuredContent?.rows.map((row) => row.events)).toEqual([26, 21])
		expect(decoded.result?.structuredContent?.expandedSql).toContain("OrgId = 'org_")
	})
})

describe("Maple pull failures", () => {
	it("stops pulls on a key Maple rejects", async () => {
		const error = await at(Effect.flip(pageOf(organization(), { apiKey: "maple_ak_wrong" })))
		expect(error).toMatchObject({ code: "auth", httpStatus: 401 })
		expect(error.message).toMatch(/Maple rejected the API key \(401\)/)
		expect(error.message).toMatch(/A key of the other region is rejected too/)
	})

	it("stops pulls on a key without the MCP tools", async () => {
		const error = await at(Effect.flip(pageOf(organization({ forbidden: true }))))
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/Maple refused this key access to its MCP tools \(403\)/)
	})

	it("waits out a short 429 in place", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 1 })
		const page = await Effect.runPromise(
			Effect.gen(function* () {
				yield* TestClock.setTime(NOW.getTime())
				const fiber = yield* Effect.forkChild(pageOf(fake, { config: config({ lookbackDays: 1 }) }))
				yield* TestClock.adjust(500)
				expect(fake.throttled).toBe(1)
				fake.throttleAfter = null
				yield* TestClock.adjust(1_000)
				return yield* Fiber.join(fiber)
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(fake.throttled).toBe(1)
		expect(page.ops.length).toBeGreaterThan(0)
	})

	it("hands a long Retry-After to the alarm, without waiting", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 120 })
		const error = await at(Effect.flip(pageOf(fake)))
		expect(error).toMatchObject({ code: "rate_limited", retryAfterMs: 120_000 })
		expect(fake.throttled).toBe(1)
	})

	it("retries a 5xx and gives up on a 4xx", async () => {
		const failing = await at(Effect.flip(pageOf(organization({ failing: true }))))
		expect(failing).toMatchObject({ code: "provider", httpStatus: 503 })
		expect(failing.retryable).toBeUndefined()
		const invalid = await at(Effect.flip(pageOf(organization({ invalid: true }))))
		expect(invalid).toMatchObject({ code: "provider", httpStatus: 400, retryable: false })
	})

	it("fails the run, without a retry, on a body or rows it cannot read", async () => {
		const error = await at(Effect.flip(pageOf(organization({ garbled: true }))))
		expect(error).toMatchObject({ code: "provider", retryable: false })
		expect(error.message).toMatch(/body Hazel cannot read/)
		// Rows of another shape than the query selected: the same failure, named by its path only.
		const rows = await at(Effect.flip(pageOf(organization({ badRows: true }))))
		expect(rows).toMatchObject({ code: "provider", retryable: false })
		expect(rows.message).toMatch(/body Hazel cannot read/)
	})

	it("retries a tool or protocol failure: Maple reports its warehouse's failures that way", async () => {
		const tool = await at(Effect.flip(pageOf(organization({ toolError: true }))))
		expect(tool).toMatchObject({ code: "provider", retryable: true })
		expect(tool.message).toBe("Maple could not run Hazel's activity query; the next attempt retries it")
		const protocol = await at(Effect.flip(pageOf(organization({ protocolError: true }))))
		expect(protocol).toMatchObject({ code: "provider", retryable: true })
		expect(protocol.message).toBe("Maple refused Hazel's activity query; the next attempt retries it")
		// Neither repeats Maple's own text: a run's message is synced to every member.
		expect(`${tool.message}${protocol.message}`).not.toMatch(/MissingOrgFilter|Unknown tool/)
	})
})
