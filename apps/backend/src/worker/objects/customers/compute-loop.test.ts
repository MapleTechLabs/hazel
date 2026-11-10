/**
 * The `CustomersObject`'s own loop on node SQLite: pulls that fail and resume, compute that backs
 * off, signals of deleted accounts, baseline mode during a backfill, the one-time history rebuild,
 * and usage data that stops counting once its source is gone.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { IngestOp } from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { ConfigProvider, Effect, Layer, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { runCompute } from "./compute"
import { encryptSecrets, storeSecrets } from "./credentials"
import { CustomerIngest } from "./ingest"
import { runDuePulls } from "./jobs"
import {
	type CustomerProviderAdapter,
	CustomerProviderError,
	CustomerProviders,
	type PullPage,
} from "./providers"
import { nextReopenAt, requestHistoryRebuild } from "./schedule"
import { loadSnapshot } from "./snapshot"
import { type CustomersWorld, makeCustomersWorld } from "./test-kit"
import { addDays, dayOf } from "./time"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const DAY = 86_400_000
const day = (offset: number) => addDays(dayOf(new Date()), offset)
/** A stored timestamp (`YYYY-MM-DD HH:MM:SS.sss`, UTC) as epoch milliseconds. */
const epoch = (text: string) => new Date(`${text.replace(" ", "T")}Z`).getTime()

const quietOrg = (world: CustomersWorld) =>
	Effect.gen(function* () {
		yield* world.ingest("clerk", [
			{
				_tag: "account",
				externalId: "org_1",
				name: "Quiet Co",
				domains: ["quiet.co"],
				sameAs: [],
				onNoMatch: "create",
			},
			...["user_1", "user_2"].map((user): IngestOp => ({
				_tag: "contact",
				externalId: user,
				account: { provider: "clerk", externalId: "org_1" },
				email: `${user}@quiet.co`,
			})),
		])
		yield* world.ingest(
			"maple",
			[-40, -35, -30, -25, -21].flatMap((offset) =>
				["user_1", "user_2"].map((user): IngestOp => ({
					_tag: "activity",
					contact: { provider: "clerk", externalId: user },
					account: { provider: "clerk", externalId: "org_1" },
					day: day(offset),
					eventCount: 20,
				})),
			),
		)
		return world.rows<{ id: CustomerAccountId }>(`SELECT id FROM customer_accounts`)[0]!.id
	})

const meta = (world: CustomersWorld, key: string) =>
	world.rows<{ value: string }>(`SELECT value FROM _object_meta WHERE key = ?`, key)[0]?.value

/** An adapter whose pulls answer from `script`, one entry per call (the last one repeats). */
const scriptedAdapter = (
	script: Array<Effect.Effect<PullPage, CustomerProviderError>>,
): CustomerProviderAdapter => ({
	provider: "clerk",
	validate: () => Effect.succeed({ externalAccountId: null, externalAccountName: null }),
	webhook: () => Effect.succeed([]),
	pull: () => (script.length > 1 ? script.shift()! : script[0]!),
	pullIntervalMs: 60 * 60_000,
})

/** The credentials' encryption with a test key (the objects' config is not in scope here). */
const encryption = IntegrationEncryption.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }),
		),
	),
)

const page = (ops: ReadonlyArray<IngestOp>, nextCursor: string | null): PullPage => ({
	ops,
	nextCursor,
	progress: { step: "organizations", done: ops.length, total: null },
})

describe("Customers compute and sync loop", () => {
	it("keeps a failed backfill running to resume it; closes it on a refused op, backing off", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("clerk")
				const script: Array<Effect.Effect<PullPage, CustomerProviderError>> = []
				const services = Layer.mergeAll(
					CustomerIngest.layer,
					encryption,
					Layer.succeed(
						CustomerProviders,
						CustomerProviders.of({
							get: (provider) =>
								provider === "clerk" ? Option.some(scriptedAdapter(script)) : Option.none(),
						}),
					),
				)
				const pulls = (now: Date) =>
					world.object.run(runDuePulls(now).pipe(Effect.provide(services))).pipe(Effect.orDie)
				yield* world.object
					.run(
						Effect.gen(function* () {
							yield* storeSecrets(connectionId, yield* encryptSecrets("sk_test", null))
						}).pipe(Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				const due = () =>
					world.object.storage.db
						.prepare(
							`UPDATE customer_connections SET nextSyncAt = '2000-01-01 00:00:00.000' WHERE id = ?`,
						)
						.run(connectionId)
				const runs = () =>
					world.rows<{
						id: string
						trigger: string
						status: string
						cursor: string | null
						error: string
					}>(`SELECT id, trigger, status, cursor, error FROM customer_sync_runs ORDER BY startedAt`)
				const connection = () =>
					world.rows<{
						consecutiveFailures: number
						nextSyncAt: string | null
						backfilledAt: string | null
					}>(
						`SELECT consecutiveFailures, nextSyncAt, backfilledAt FROM customer_connections WHERE id = ?`,
						connectionId,
					)[0]!

				// Rate limited mid-backfill: the run stays open, the connection waits as asked.
				const now = new Date()
				due()
				script.push(
					Effect.succeed(
						page(
							[
								{
									_tag: "account",
									externalId: "org_1",
									name: "Acme",
									domains: ["acme.com"],
									sameAs: [],
									onNoMatch: "create",
								},
							],
							"page-2",
						),
					),
					Effect.fail(
						new CustomerProviderError({
							code: "rate_limited",
							message: "Slow down",
							httpStatus: 429,
							retryAfterMs: 30_000,
						}),
					),
					Effect.succeed(page([], null)),
				)
				yield* pulls(now)
				expect(runs()).toMatchObject([{ trigger: "backfill", status: "running", cursor: "page-2" }])
				expect(JSON.parse(runs()[0]!.error)).toMatchObject({ code: "rate_limited" })
				expect(connection().consecutiveFailures).toBe(1)
				expect(epoch(connection().nextSyncAt!)).toBe(now.getTime() + 30_000)

				// The retry resumes the same run from its cursor and finishes the backfill.
				yield* pulls(new Date(now.getTime() + 60_000))
				expect(runs()).toMatchObject([{ trigger: "backfill", status: "succeeded" }])
				expect(connection()).toMatchObject({ consecutiveFailures: 0 })
				expect(connection().backfilledAt).not.toBeNull()
				expect(meta(world, "baselineFor")).toBe(connectionId)
				expect(meta(world, "rebuildHistory")).toBe("1")

				// A scheduled pull with an op the store refuses: the run fails, the connection backs off.
				due()
				script.splice(
					0,
					script.length,
					Effect.succeed(
						page(
							[
								{
									_tag: "metric",
									account: { provider: "clerk", externalId: "org_1" },
									metricKey: "mrr",
									day: day(0),
									value: 1,
								},
							],
							null,
						),
					),
				)
				const later = new Date(now.getTime() + 2 * 60_000)
				yield* pulls(later)
				expect(runs()[1]).toMatchObject({ trigger: "schedule", status: "failed" })
				expect(connection().consecutiveFailures).toBe(1)
				expect(epoch(connection().nextSyncAt!)).toBe(later.getTime() + 60_000)

				// A later backfill (the connection has one) arms the baseline but rebuilds no history.
				world.object.storage.db.prepare(`DELETE FROM _object_meta WHERE key = 'rebuildHistory'`).run()
				yield* world.object
					.run(
						Effect.gen(function* () {
							const ingest = yield* CustomerIngest
							const backfill = yield* ingest.startRun(connectionId, "backfill")
							yield* ingest.finishRun(backfill.id, { _tag: "Succeeded", cursor: null })
						}).pipe(Effect.provide(CustomerIngest.layer)),
					)
					.pipe(Effect.orDie)
				expect(meta(world, "rebuildHistory")).toBeUndefined()
			}),
		))

	it("backs compute off when it fails instead of retrying on every alarm", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				world.object.storage.db.prepare(`DELETE FROM customer_settings`).run()
				world.object.storage.db
					.prepare(`UPDATE _object_meta SET value = '0' WHERE key = 'computeDueAt'`)
					.run()
				const before = Date.now()
				yield* world.object.alarm
				const next = Number(meta(world, "computeDueAt"))
				expect(next).toBeGreaterThanOrEqual(before + 4 * 60_000)
				expect(next).toBeLessThanOrEqual(Date.now() + 6 * 60_000)
			}),
		))

	it("closes the signals of a deleted account, so no reopen stays due", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const accountId = yield* quietOrg(world)
				const now = new Date()
				yield* world.object
					.run(
						Effect.gen(function* () {
							const db = yield* Database.Database
							const rule = world.rows<{ id: CustomerSignalRuleId }>(
								`SELECT id FROM customer_signal_rules WHERE template = 'inactive'`,
							)[0]!
							const evidence = {
								_tag: "last_active" as const,
								step: 0 as const,
								lastActiveAt: null,
								daysInactive: 21,
								priorActiveUsers: 2,
								contactId: null,
								contactName: null,
								contactEmail: null,
							}
							yield* db.run(
								SQLite.insertInto(schema.customerSignalsTable).values({
									organizationId: world.orgId as OrganizationId,
									accountId,
									ruleId: rule.id,
									template: "inactive",
									kind: "risk",
									severity: "medium",
									status: "done",
									title: "Stopped using the product",
									reason: "",
									evidence,
									openingEvidence: evidence,
									priorityScore: 1,
									firstDetectedAt: new Date(now.getTime() - 10 * DAY),
									openedAt: new Date(now.getTime() - 10 * DAY),
									lastEvaluatedAt: new Date(now.getTime() - 10 * DAY),
									resolvedAt: new Date(now.getTime() - 8 * DAY),
									reopenAfter: new Date(now.getTime() - DAY),
								}),
							)
						}),
					)
					.pipe(Effect.orDie)
				world.object.storage.db
					.prepare(`UPDATE customer_accounts SET deletedAt = '2026-01-01 00:00:00.000'`)
					.run()
				expect(Option.isNone(yield* world.object.run(nextReopenAt).pipe(Effect.orDie))).toBe(true)
				yield* world.object.run(runCompute(now)).pipe(Effect.orDie)
				expect(
					world.rows(`SELECT status, closedAt IS NOT NULL AS closed FROM customer_signals`),
				).toEqual([{ status: "done", closed: 1 }])
				expect(Number(meta(world, "computeDueAt"))).toBe(now.getTime() + 60 * 60_000)
			}),
		))

	it("records matches silently while a backfill is still importing", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* quietOrg(world)
				yield* world.object
					.run(
						Effect.gen(function* () {
							yield* (yield* CustomerIngest).startRun(world.connection("maple"), "backfill")
							yield* runCompute(new Date())
						}).pipe(Effect.provide(CustomerIngest.layer)),
					)
					.pipe(Effect.orDie)
				expect(
					world.rows(
						`SELECT template, status, dismissReason FROM customer_signals WHERE template = 'inactive'`,
					),
				).toEqual([{ template: "inactive", status: "dismissed", dismissReason: "baseline" }])
			}),
		))

	it("rebuilds only missing history, and the rebuild's movements are not counted twice", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const accountId = yield* quietOrg(world)
				yield* world.ingest("stripe", [
					{
						_tag: "subscription",
						externalId: "sub_1",
						account: { provider: "clerk", externalId: "org_1" },
						planName: "Team",
						status: "active",
						mrrMinor: 19_900,
						currency: "usd",
						interval: "month",
						quantity: 1,
						startedAt: new Date(Date.now() - 90 * DAY).toISOString(),
						trialEndsAt: null,
						currentPeriodEnd: null,
						cancelAtPeriodEnd: false,
						canceledAt: null,
					},
				])
				world.object.storage.db
					.prepare(`INSERT INTO customer_org_daily (day, mrrMinor) VALUES (?, 12345)`)
					.run(day(-10))
				yield* world.object
					.run(Effect.andThen(requestHistoryRebuild, runCompute(new Date())))
					.pipe(Effect.orDie)
				expect(
					world.rows(
						`SELECT day, type, toMrrMinor FROM customer_mrr_movements WHERE accountId = ?`,
						accountId,
					),
				).toEqual([{ day: day(-90), type: "new", toMrrMinor: 19_900 }])
				expect(world.rows(`SELECT mrrMinor FROM customer_org_daily WHERE day = ?`, day(-10))).toEqual(
					[{ mrrMinor: 12345 }],
				)
				expect(world.rows(`SELECT mrrMinor FROM customer_org_daily WHERE day = ?`, day(-11))).toEqual(
					[{ mrrMinor: 19_900 }],
				)
			}),
		))

	it("stops counting usage once its sources are disconnected or failing", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* quietOrg(world)
				const snapshot = () => world.object.run(loadSnapshot(new Date())).pipe(Effect.orDie)
				expect((yield* snapshot()).hasActivityData).toBe(true)
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET status = 'disconnected' WHERE provider = 'maple'`,
					)
					.run()
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET status = 'error' WHERE provider = 'clerk'`)
					.run()
				const stale = yield* snapshot()
				expect(stale.hasActivityData).toBe(false)
				expect([...stale.org.connected].sort()).toEqual(["autumn", "stripe"])
			}),
		))
})
