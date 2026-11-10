/**
 * The `CustomersObject`'s own loop on node SQLite: pulls that fail and resume, skip refused ops,
 * stop on bad credentials or a disconnect, compute that backs off and leases its run, signals of deleted accounts, baseline mode during a backfill, the one-time history rebuild,
 * and usage data that stops counting once its source is gone.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { IngestOp, ProviderRef } from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { ConfigProvider, Effect, Layer, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { runCompute, runComputeStep } from "./compute"
import { encryptSecrets, storeSecrets, switchProviderAccount } from "./credentials"
import { CustomerIngest } from "./ingest"
import { runDuePullsWith } from "./jobs"
import {
	type CustomerProviderAdapter,
	CustomerProviderError,
	CustomerProviders,
	type PullPage,
} from "./providers"
import {
	computeDueAt,
	nextReopenAt,
	requestComputeAfterIngest,
	requestHistoryRebuild,
	takeComputeLease,
} from "./schedule"
import { loadBase } from "./snapshot"
import { type CustomersWorld, makeCustomersWorld, NOW } from "./test-kit"
import { addDays, dayOf } from "./time"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const DAY = 86_400_000
const day = (offset: number) => addDays(dayOf(NOW), offset)
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
					world.object.run(runDuePullsWith(services)(now)).pipe(Effect.orDie)
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
				const now = NOW
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

				// A scheduled pull with an op the store refuses: the op is skipped (counted), the run succeeds.
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
				expect(runs()[1]).toMatchObject({ trigger: "schedule", status: "succeeded" })
				expect(
					JSON.parse(
						world.rows<{ stats: string }>(
							`SELECT stats FROM customer_sync_runs WHERE trigger = 'schedule'`,
						)[0]!.stats,
					),
				).toMatchObject({ rejected: 1 })
				expect(connection().consecutiveFailures).toBe(0)
				expect(epoch(connection().nextSyncAt!)).toBe(later.getTime() + 60 * 60_000)

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
				const now = NOW
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
							yield* runCompute(NOW)
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
						startedAt: new Date(NOW.getTime() - 90 * DAY).toISOString(),
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
					.run(
						Effect.gen(function* () {
							yield* requestHistoryRebuild
							// The rebuild takes an alarm turn of its own; the compute follows.
							yield* runComputeStep(NOW)
							expect(Option.getOrThrow(yield* computeDueAt)).toBe(NOW.getTime())
							yield* runComputeStep(NOW)
						}),
					)
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
				const snapshot = () => world.object.run(loadBase(NOW)).pipe(Effect.orDie)
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

	it("stops pulling on bad credentials, and leases a pull so a killed one cannot loop", () =>
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
							`UPDATE customer_connections SET status = 'active', nextSyncAt = '2000-01-01 00:00:00.000' WHERE id = ?`,
						)
						.run(connectionId)
				const connection = () =>
					world.rows<{ status: string; nextSyncAt: string | null; lastError: string | null }>(
						`SELECT status, nextSyncAt, lastError FROM customer_connections WHERE id = ?`,
						connectionId,
					)[0]!

				// Killed mid-pull (the runtime ends the alarm): due again only after the lease.
				due()
				script.push(Effect.interrupt as never)
				yield* world.object.run(runDuePullsWith(services)(NOW)).pipe(Effect.exit)
				expect(epoch(connection().nextSyncAt!)).toBe(NOW.getTime() + 5 * 60_000)

				// Bad credentials: the connection is in error and nothing is scheduled.
				due()
				script.splice(
					0,
					script.length,
					Effect.fail(
						new CustomerProviderError({
							code: "auth",
							message: "Invalid API key",
							httpStatus: 401,
							retryAfterMs: null,
						}),
					),
				)
				yield* world.object.run(runDuePullsWith(services)(NOW)).pipe(Effect.orDie)
				expect(connection()).toMatchObject({ status: "error", nextSyncAt: null })
				expect(JSON.parse(connection().lastError!)).toMatchObject({ code: "auth" })
			}),
		))

	it("keeps signals as they are while their source is in error", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* quietOrg(world)
				const inactive = () =>
					world.rows(
						`SELECT status, closedAt IS NULL AS unclosed FROM customer_signals WHERE template = 'inactive'`,
					)
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)
				expect(inactive()).toEqual([{ status: "open", unclosed: 1 }])
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET status = 'error' WHERE provider IN ('clerk', 'maple')`,
					)
					.run()
				yield* world.object.run(runCompute(new Date(NOW.getTime() + DAY))).pipe(Effect.orDie)
				expect(inactive()).toEqual([{ status: "open", unclosed: 1 }])
			}),
		))

	const subscription = (
		startedDaysAgo: number,
		account: ProviderRef = { provider: "clerk", externalId: "org_1" },
	): IngestOp => ({
		_tag: "subscription",
		externalId: "sub_1",
		account,
		planName: "Team",
		status: "active",
		mrrMinor: 19_900,
		currency: "usd",
		interval: "month",
		quantity: 1,
		startedAt: new Date(NOW.getTime() - startedDaysAgo * DAY).toISOString(),
		trialEndsAt: null,
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		canceledAt: null,
	})

	it("writes no MRR movements while a billing backfill imports; the rebuild after it writes them", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const accountId = yield* quietOrg(world)
				const movements = () =>
					world.rows(`SELECT day, type FROM customer_mrr_movements WHERE accountId = ?`, accountId)
				const backfill = yield* world.object
					.run(
						Effect.flatMap(CustomerIngest, (ingest) =>
							ingest.startRun(world.connection("stripe"), "backfill"),
						).pipe(Effect.provide(CustomerIngest.layer)),
					)
					.pipe(Effect.orDie)
				yield* world.ingest("stripe", [subscription(90)])
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)
				expect(movements()).toEqual([])
				expect(world.rows(`SELECT mrrMinor FROM customer_accounts`)).toEqual([{ mrrMinor: 19_900 }])

				// A Clerk backfill finishing first asks for the rebuild: it waits for the billing import.
				yield* world.object.run(requestHistoryRebuild).pipe(Effect.orDie)
				yield* world.object.run(runComputeStep(NOW)).pipe(Effect.orDie)
				expect(meta(world, "rebuildHistory")).toBe("1")
				expect(movements()).toEqual([])

				yield* world.object
					.run(
						Effect.flatMap(CustomerIngest, (ingest) =>
							ingest.finishRun(backfill.id, { _tag: "Succeeded", cursor: null }),
						).pipe(Effect.provide(CustomerIngest.layer)),
					)
					.pipe(Effect.orDie)
				yield* world.object.run(runComputeStep(NOW)).pipe(Effect.orDie)
				expect(meta(world, "rebuildHistory")).toBeUndefined()
				yield* world.object.run(runComputeStep(NOW)).pipe(Effect.orDie)
				expect(movements()).toEqual([{ day: day(-90), type: "new" }])
			}),
		))

	it("counts a compute attempt at its lease, so a killed run backs off and ingest waits", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const due = () => Number(meta(world, "computeDueAt"))
				const now = NOW.getTime()
				// Two attempts the runtime killed (no success, no failure recorded): 5, then 10 minutes.
				yield* world.object.run(takeComputeLease(now)).pipe(Effect.orDie)
				expect(due()).toBe(now + 5 * 60_000)
				yield* world.object.run(takeComputeLease(now)).pipe(Effect.orDie)
				expect(due()).toBe(now + 10 * 60_000)
				// Ingest does not bring a failing compute closer.
				world.object.storage.db.prepare(`UPDATE customer_settings SET lastComputedAt = NULL`).run()
				yield* world.object.run(requestComputeAfterIngest).pipe(Effect.orDie)
				expect(due()).toBe(now + 10 * 60_000)
				// A success resets the count.
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)
				expect(meta(world, "computeFailures")).toBeUndefined()
				expect(due()).toBe(now + 60 * 60_000)
			}),
		))

	it("does one kind of work per alarm turn: the rebuild, then the compute, then the pulls", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("clerk")
				const nextSync = () =>
					world.rows<{ nextSyncAt: string | null }>(
						`SELECT nextSyncAt FROM customer_connections WHERE id = ?`,
						connectionId,
					)[0]!.nextSyncAt
				const lastComputed = () =>
					world.rows<{ lastComputedAt: string | null }>(
						`SELECT lastComputedAt FROM customer_settings`,
					)[0]!.lastComputedAt
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET status = 'active', nextSyncAt = '2000-01-01 00:00:00.000' WHERE id = ?`,
					)
					.run(connectionId)
				world.object.storage.db
					.prepare(`UPDATE _object_meta SET value = '0' WHERE key = 'computeDueAt'`)
					.run()
				yield* world.object.run(requestHistoryRebuild).pipe(Effect.orDie)

				yield* world.object.alarm
				expect(meta(world, "rebuildHistory")).toBeUndefined()
				expect(lastComputed()).toBeNull()
				expect(nextSync()).toBe("2000-01-01 00:00:00.000")

				yield* world.object.alarm
				expect(lastComputed()).not.toBeNull()
				expect(nextSync()).toBe("2000-01-01 00:00:00.000")

				// No adapter is registered: the pull turn parks the connection.
				yield* world.object.alarm
				expect(nextSync()).not.toBe("2000-01-01 00:00:00.000")
			}),
		))

	it("another provider account drops the old one's billing and records and imports from scratch", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("stripe")
				yield* world.ingest("stripe", [
					{
						_tag: "account",
						externalId: "cus_1",
						name: "Old Co",
						domains: ["old.co"],
						sameAs: [],
						onNoMatch: "create",
					},
					subscription(30, { provider: "stripe", externalId: "cus_1" }),
				])
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET backfilledAt = '2026-01-01 00:00:00.000', lastSuccessAt = '2026-01-01 00:00:00.000' WHERE id = ?`,
					)
					.run(connectionId)
				const connection = world.rows<Record<string, unknown>>(
					`SELECT id, provider FROM customer_connections WHERE id = ?`,
					connectionId,
				)[0]!
				const switched = yield* world.object
					.run(
						switchProviderAccount(connection as never, new Date(Date.now() + 1_000)).pipe(
							Effect.provide(CustomerIngest.layer),
						),
					)
					.pipe(Effect.orDie)
				expect(switched).toMatchObject({ backfilledAt: null, lastSuccessAt: null })
				expect(world.rows(`SELECT id FROM customer_subscriptions`)).toEqual([])
				expect(world.rows(`SELECT staleAt IS NOT NULL AS stale FROM customer_external_refs`)).toEqual(
					[{ stale: 1 }],
				)
				expect(world.rows(`SELECT deletedAt IS NOT NULL AS deleted FROM customer_accounts`)).toEqual([
					{ deleted: 1 },
				])
			}),
		))

	it("records a safe message when saving a pulled page fails, and backs off when pulls cannot start", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("clerk")
				const script: Array<Effect.Effect<PullPage, CustomerProviderError>> = [
					Effect.succeed(
						page(
							[
								{
									_tag: "account",
									externalId: "org_9",
									name: "Acme",
									sameAs: [],
									onNoMatch: "create",
								},
							],
							null,
						),
					),
				]
				const providers = Layer.succeed(
					CustomerProviders,
					CustomerProviders.of({
						get: (provider) =>
							provider === "clerk" ? Option.some(scriptedAdapter(script)) : Option.none(),
					}),
				)
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
							`UPDATE customer_connections SET status = 'active', nextSyncAt = '2000-01-01 00:00:00.000' WHERE id = ?`,
						)
						.run(connectionId)
				const connection = () =>
					world.rows<{ nextSyncAt: string | null; lastError: string | null }>(
						`SELECT nextSyncAt, lastError FROM customer_connections WHERE id = ?`,
						connectionId,
					)[0]!

				// The store refuses the page: what members see is the fixed message, not the storage error.
				world.object.storage.db
					.prepare(
						`CREATE TRIGGER fail_accounts BEFORE INSERT ON customer_accounts BEGIN SELECT RAISE(ABORT, 'disk detail'); END`,
					)
					.run()
				due()
				yield* world.object
					.run(runDuePullsWith(Layer.mergeAll(CustomerIngest.layer, encryption, providers))(NOW))
					.pipe(Effect.orDie)
				const error = JSON.parse(connection().lastError!)
				expect(error).toMatchObject({ code: "internal", message: "Saving the synced data failed" })
				expect(
					JSON.stringify(
						world.rows(
							`SELECT error FROM customer_sync_runs WHERE connectionId = ?`,
							connectionId,
						),
					),
				).not.toContain("disk detail")

				// No encryption key: no pull can start; each due connection backs off.
				due()
				const noKey = IntegrationEncryption.layer.pipe(
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
				)
				yield* world.object
					.run(runDuePullsWith(Layer.mergeAll(CustomerIngest.layer, noKey, providers))(NOW))
					.pipe(Effect.orDie)
				expect(epoch(connection().nextSyncAt!)).toBeGreaterThan(NOW.getTime())
			}),
		))
})
