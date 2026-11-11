/**
 * The Customers RPCs in a `CustomersObject`: authorization (member vs admin), the members
 * bootstrap from the `OrgObject`, the demo seed through ingest and compute, the queue actions,
 * dry runs, and baseline mode after a backfill.
 */
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_HEALTH_SETTINGS,
	type IngestOp,
	type RuleDraft,
	SignalTemplate,
	TEMPLATES,
} from "@hazel/domain/customers"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { customersTarget, orgTarget } from "../kinds"
import { makeTestObjects } from "../testing"
import { runCompute } from "./compute"
import { healthDryRun, ruleDryRun } from "./dry-run"
import { CustomerIngest } from "./ingest"
import { makeCustomersWorld, NOW, ok, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe("Customers RPCs", () => {
	it("lets members read and work the queue, and only admins change settings", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				expect(tagOf(yield* world.call("customers.overview", { range: "30d" }, world.member))).toBe(
					"Success",
				)
				expect(tagOf(yield* world.call("customers.overview", { range: "30d" }, world.stranger))).toBe(
					"UnauthorizedError",
				)
				const health = ok(yield* world.call("customers.overview", { range: "30d" }, world.owner))
				expect(health.hasData).toEqual({ activity: false, billing: false })

				const settings = { reportingCurrency: "eur" }
				expect(tagOf(yield* world.call("customers.settings.update", settings, world.member))).toBe(
					"UnauthorizedError",
				)
				const updated = ok(yield* world.call("customers.settings.update", settings, world.owner))
				expect(updated.transactionId).toMatch(new RegExp(`^customers:${world.orgId}:\\d+$`))
				expect(world.rows(`SELECT reportingCurrency FROM customer_settings`)).toEqual([
					{ reportingCurrency: "eur" },
				])

				const draft = {
					name: "Quiet for a week",
					severity: "high",
					config: { ...TEMPLATES.inactive.defaultConfig, inactiveDays: 7 },
					scope: {},
					enabled: true,
				}
				expect(tagOf(yield* world.call("customers.rule.create", { rule: draft }, world.member))).toBe(
					"UnauthorizedError",
				)
				expect(
					ok(yield* world.call("customers.rule.create", { rule: draft }, world.owner)).data
						.template,
				).toBe("inactive")
				expect(tagOf(yield* world.call("customers.demo.seed", { accounts: 5 }, world.member))).toBe(
					"UnauthorizedError",
				)

				// Personal views for anyone, shared ones for admins; built-in views stay.
				const view = {
					name: "Mine",
					filters: { ownedByMe: true },
					sort: { column: "mrr", direction: "desc" },
					columns: ["name"],
				}
				expect(
					tagOf(yield* world.call("customers.view.create", { view, shared: true }, world.member)),
				).toBe("UnauthorizedError")
				const personal = ok(
					yield* world.call("customers.view.create", { view, shared: false }, world.member),
				)
				expect(personal.data.ownerUserId).toBe(world.member)
				expect(
					tagOf(
						yield* world.call("customers.view.delete", { viewId: personal.data.id }, world.owner),
					),
				).toBe("CustomersNotFoundError")
				const builtIn = world.rows<{ id: string }>(
					`SELECT id FROM customer_saved_views WHERE builtInKey = 'paying'`,
				)[0]!
				expect(
					tagOf(yield* world.call("customers.view.delete", { viewId: builtIn.id }, world.owner)),
				).toBe("CustomersInvalidRequestError")
				// Defaults: a rule per template, five built-in views, the built-in metrics.
				expect(world.rows(`SELECT count(*) AS n FROM customer_signal_rules`)).toEqual([
					{ n: SignalTemplate.literals.length + 1 },
				])
				expect(
					world.rows(`SELECT count(*) AS n FROM customer_saved_views WHERE builtInKey IS NOT NULL`),
				).toEqual([{ n: 5 }])
				// Every provider has an adapter now, so connecting goes to it: this key is not one
				// Maple issues, which its `validate` says before it calls anything.
				expect(
					tagOf(
						yield* world.call(
							"customers.connection.connect",
							{
								provider: "maple",
								apiKey: "mpl_live_test",
								webhookSecret: null,
								config: { ...DEFAULT_CONNECTION_CONFIG.maple, mapleOrgId: "org_maple" },
							},
							world.owner,
						),
					),
				).toBe("CustomerConnectionCredentialsError")
			}),
		))

	it("pulls its members from the org on first use, then takes the org's pushes", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const org = yield* objects.get(orgTarget(orgId))
				const [owner, member] = [uuid(), uuid()] as Array<UserId>
				org.storage.db.prepare(`INSERT INTO organizations (id, name) VALUES (?, 'Acme')`).run(orgId)
				const insert = org.storage.db.prepare(
					`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, ?)`,
				)
				insert.run(uuid(), orgId, owner, "owner")
				insert.run(uuid(), orgId, member, "member")
				const customers = yield* objects.get(customersTarget(orgId))
				// The first socket bootstraps (installs defaults, pulls members), then is accepted.
				const { makeFakeSocket } = yield* Effect.promise(() => import("@hazel/sync-do/testing"))
				// Identity is learnt from the first entry point that carries it.
				yield* customers.applyEffect({
					objectId: orgId,
					kind: "customers.unknown",
					payload: {},
					key: uuid(),
					sender: { kind: "org", id: orgId },
				})
				expect(yield* customers.adopt(makeFakeSocket(), { userId: member, expiresAt: null })).toBe(
					"accepted",
				)
				expect(
					customers.storage.db
						.prepare(`SELECT userId, role FROM customer_members ORDER BY role`)
						.all(),
				).toEqual([
					{ userId: member, role: "member" },
					{ userId: owner, role: "owner" },
				])
				// The org now pushes: promote the member.
				org.storage.db
					.prepare(`UPDATE organization_members SET role = 'admin' WHERE userId = ?`)
					.run(member)
				const { publishCustomerMembers } = yield* Effect.promise(
					() => import("../org/customer-members"),
				)
				yield* org.run(publishCustomerMembers(orgId)).pipe(Effect.orDie)
				yield* org.afterCommit
				expect(
					customers.storage.db
						.prepare(`SELECT role FROM customer_members WHERE userId = ?`)
						.all(member),
				).toEqual([{ role: "admin" }])
			}),
		))

	it(
		"never seeds demo data into a real connection",
		() =>
			run(
				Effect.gen(function* () {
					const world = yield* makeCustomersWorld
					world.object.storage.db
						.prepare(
							`UPDATE customer_connections SET externalAccountId = 'demo', status = 'disconnected' WHERE provider != 'stripe'`,
						)
						.run()
					expect(
						tagOf(
							yield* world.call("customers.demo.seed", { accounts: 5, seed: 7 }, world.owner),
						),
					).toBe("Success")
					const runsOf = (provider: "clerk" | "stripe") =>
						world.rows<{ n: number }>(
							`SELECT count(*) AS n FROM customer_sync_runs WHERE connectionId = ?`,
							world.connection(provider),
						)[0]!.n
					expect(runsOf("stripe")).toBe(0)
					expect(runsOf("clerk")).toBe(1)
					expect(
						world.rows(`SELECT status FROM customer_connections WHERE provider = 'clerk'`),
					).toEqual([{ status: "active" }])
				}),
			),
		30_000,
	)

	it(
		"seeds demo data through ingest and computes signals for every template",
		() =>
			run(
				Effect.gen(function* () {
					const world = yield* makeCustomersWorld
					// The world's connections stand in for the demo ones.
					world.object.storage.db
						.prepare(`UPDATE customer_connections SET externalAccountId = 'demo'`)
						.run()
					const seeded = yield* world.call(
						"customers.demo.seed",
						{ accounts: 60, seed: 7 },
						world.owner,
					)
					expect(tagOf(seeded)).toBe("Success")
					const accounts = world.rows<{ n: number }>(
						`SELECT count(*) AS n FROM customer_accounts WHERE deletedAt IS NULL`,
					)[0]!.n
					expect(accounts).toBeGreaterThanOrEqual(60)
					const templates = world
						.rows<{ template: string; n: number }>(
							`SELECT template, count(*) AS n FROM customer_signals WHERE status = 'open' GROUP BY template ORDER BY template`,
						)
						.map((row) => row.template)
					// health_drop needs history; every other template fires on day one.
					expect(templates).toEqual(
						expect.arrayContaining(
							SignalTemplate.literals.filter((template) => template !== "health_drop"),
						),
					)
					const stages = world.rows<{ lifecycleStage: string }>(
						`SELECT DISTINCT lifecycleStage FROM customer_accounts ORDER BY lifecycleStage`,
					)
					expect(stages.map((row) => row.lifecycleStage)).toEqual([
						"active",
						"churned",
						"lead",
						"past_due",
						"trialing",
					])
					expect(world.rows(`SELECT count(*) AS n FROM customer_health_daily`)).toEqual([
						{ n: accounts },
					])
					expect(
						world.rows<{ n: number }>(`SELECT count(*) AS n FROM customer_org_daily`)[0]!.n,
					).toBe(366)
					expect(
						world.rows<{ n: number }>(`SELECT count(*) AS n FROM customer_mrr_movements`)[0]!.n,
					).toBeGreaterThan(60)

					const overview = ok(
						yield* world.call("customers.overview", { range: "90d" }, world.member),
					)
					expect(overview.kpis.mrrMinor.value).toBeGreaterThan(0)
					expect(overview.kpis.payingCustomers.value).toBeGreaterThan(20)
					expect(overview.kpis.mau.value).toBeGreaterThan(0)
					expect(overview.bucket).toBe("week")
					expect(overview.mrrMovements.length).toBeGreaterThanOrEqual(13)
					expect(
						overview.healthDistribution.reduce(
							(sum: number, row: { count: number }) => sum + row.count,
							0,
						),
					).toBe(accounts)
					expect(overview.hasData).toEqual({ activity: true, billing: true })

					const top = world.rows<{ id: string; accountId: string; ruleId: string }>(
						`SELECT id, accountId, ruleId FROM customer_signals WHERE status = 'open' AND template = 'payment_failed' LIMIT 1`,
					)[0]!
					const detail = ok(
						yield* world.call(
							"customers.account.detail",
							{ accountId: top.accountId },
							world.member,
						),
					)
					expect(detail.health.components).toHaveLength(4)
					expect(detail.activeUsersSeries).toHaveLength(30)
					expect(detail.subscriptions.length).toBeGreaterThan(0)
					const series = ok(
						yield* world.call(
							"customers.account.series",
							{
								accountId: top.accountId,
								metricKeys: ["mrr", "active_users", "api_calls"],
								range: "30d",
							},
							world.member,
						),
					)
					expect(
						series.series.map((entry: { points: Array<unknown> }) => entry.points.length),
					).toEqual([30, 30, 30])
					const contacts = ok(
						yield* world.call(
							"customers.contacts.list",
							{ accountId: top.accountId, limit: 2 },
							world.member,
						),
					)
					expect(contacts.items).toHaveLength(2)
					expect(contacts.nextCursor).toBe("2")
					const sparklines = ok(
						yield* world.call(
							"customers.sparklines",
							{ accountIds: [top.accountId], metricKey: "active_users", days: 14 },
							world.member,
						),
					)
					expect(sparklines.sparklines[0].values).toHaveLength(14)

					// The rule dry run agrees with compute.
					const rule = world.rows<{
						name: string
						severity: string
						config: string
						scope: string
					}>(
						`SELECT name, severity, config, scope FROM customer_signal_rules WHERE id = ?`,
						top.ruleId,
					)[0]!
					const dry = ok(
						yield* world.call(
							"customers.rule.dryRun",
							{
								ruleId: top.ruleId,
								draft: {
									name: rule.name,
									severity: rule.severity,
									config: JSON.parse(rule.config),
									scope: JSON.parse(rule.scope),
									enabled: true,
								},
							},
							world.owner,
						),
					)
					const open = world.rows<{ n: number }>(
						`SELECT count(*) AS n FROM customer_signals WHERE ruleId = ? AND closedAt IS NULL`,
						top.ruleId,
					)[0]!.n
					expect(dry.matchCount).toBe(open)
					expect(dry.evaluatedAccounts).toBe(dry.totalAccounts)
					expect(dry.queueDelta).toEqual({ opens: 0, resolves: 0, stays: open })
					expect(dry.topMatches[0].evidence._tag).toBe("amount")
					const healthDry = ok(
						yield* world.call(
							"customers.health.dryRun",
							{
								draft: {
									...JSON.parse(
										world.rows<{ health: string }>(
											`SELECT health FROM customer_settings`,
										)[0]!.health,
									),
									bands: { healthyMin: 95, atRiskMin: 60 },
								},
							},
							world.owner,
						),
					)
					expect(healthDry.transitions.length).toBeGreaterThan(0)
					expect(healthDry.samples.length).toBeGreaterThan(0)

					// The queue: snooze, reopen, done (with a cooldown), notes.
					const snoozed = ok(
						yield* world.call(
							"customers.signal.snooze",
							{
								signalId: top.id,
								until: new Date(Date.now() + 3 * 86_400_000),
								note: "Talking to them Friday",
							},
							world.member,
						),
					)
					expect(snoozed.transactionId).toContain(`customers:${world.orgId}:`)
					expect(
						world.rows(
							`SELECT status, snoozeNote, actionEvidence IS NOT NULL AS acted FROM customer_signals WHERE id = ?`,
							top.id,
						),
					).toEqual([{ status: "snoozed", snoozeNote: "Talking to them Friday", acted: 1 }])
					ok(yield* world.call("customers.signal.reopen", { signalId: top.id }, world.member))
					ok(
						yield* world.call(
							"customers.signal.done",
							{ signalId: top.id, outcome: "contacted", note: "Card updated" },
							world.member,
						),
					)
					expect(
						tagOf(
							yield* world.call("customers.signal.dismiss", { signalId: top.id }, world.member),
						),
					).toBe("CustomerSignalTransitionError")
					const done = world.rows<{ status: string; reopenAfter: string | null }>(
						`SELECT status, reopenAfter FROM customer_signals WHERE id = ?`,
						top.id,
					)[0]!
					expect(done.status).toBe("done")
					expect(done.reopenAfter).not.toBeNull()
					const note = ok(
						yield* world.call(
							"customers.note.create",
							{ accountId: top.accountId, body: "Spoke with finance", pinned: true },
							world.member,
						),
					)
					expect(
						tagOf(
							yield* world.call(
								"customers.note.update",
								{ noteId: note.data.id, body: "Edited" },
								world.owner,
							),
						),
					).toBe("CustomersNotFoundError")
					ok(yield* world.call("customers.note.delete", { noteId: note.data.id }, world.owner))
					const timeline = ok(
						yield* world.call(
							"customers.events.list",
							{ accountId: top.accountId, types: ["signal."] },
							world.member,
						),
					)
					expect(timeline.items.map((event: { type: string }) => event.type)).toEqual(
						expect.arrayContaining([
							"signal.opened",
							"signal.snoozed",
							"signal.reopened",
							"signal.done",
						]),
					)

					// A later compute keeps the done signal done while it holds, then reopens it after 7 days.
					const later = (days: number) => new Date(Date.now() + days * 86_400_000)
					yield* world.object.run(runCompute(later(1))).pipe(Effect.orDie)
					expect(world.rows(`SELECT status FROM customer_signals WHERE id = ?`, top.id)).toEqual([
						{ status: "done" },
					])
					yield* world.object.run(runCompute(later(8))).pipe(Effect.orDie)
					expect(
						world.rows(`SELECT status, reopenCount FROM customer_signals WHERE id = ?`, top.id),
					).toEqual([{ status: "open", reopenCount: 1 }])
				}),
			),
		120_000,
	)

	it("records a backfill's matches silently (baseline), except the act-now templates", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const day = (offset: number) =>
					new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
				yield* world.ingest("clerk", [
					{
						_tag: "account",
						externalId: "org_1",
						name: "Quiet Co",
						domains: ["quiet.co"],
						sameAs: [],
						onNoMatch: "create",
					},
					{
						_tag: "contact",
						externalId: "user_1",
						account: { provider: "clerk", externalId: "org_1" },
						email: "a@quiet.co",
					},
					{
						_tag: "contact",
						externalId: "user_2",
						account: { provider: "clerk", externalId: "org_1" },
						email: "b@quiet.co",
					},
				])
				yield* world.ingest(
					"maple",
					[-40, -35, -30, -25, -21].flatMap((offset) =>
						["user_1", "user_2"].map((user) => ({
							_tag: "activity" as const,
							contact: { provider: "clerk" as const, externalId: user },
							account: { provider: "clerk" as const, externalId: "org_1" },
							day: day(offset),
							eventCount: 20,
						})),
					),
				)
				yield* world.ingest("autumn", [
					{
						_tag: "subscription",
						externalId: "sub_1",
						account: { provider: "clerk", externalId: "org_1" },
						planName: "Team",
						status: "past_due",
						mrrMinor: 19_900,
						currency: "usd",
						interval: "month",
						quantity: 1,
						startedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
						trialEndsAt: null,
						currentPeriodEnd: null,
						cancelAtPeriodEnd: false,
						canceledAt: null,
					},
				])
				// A backfill run finishes: the next compute is in baseline mode.
				yield* world.object
					.run(
						Effect.gen(function* () {
							const ingest = yield* CustomerIngest
							const backfill = yield* ingest.startRun(world.connection("clerk"), "backfill")
							yield* ingest.finishRun(backfill.id, { _tag: "Succeeded", cursor: null })
							yield* runCompute(new Date())
						}).pipe(Effect.provide(CustomerIngest.layer)),
					)
					.pipe(Effect.orDie)
				expect(
					world.rows(
						`SELECT template, status, dismissReason FROM customer_signals ORDER BY template`,
					),
				).toEqual([
					{ template: "champion_inactive", status: "dismissed", dismissReason: "baseline" },
					{ template: "inactive", status: "dismissed", dismissReason: "baseline" },
					{ template: "payment_failed", status: "open", dismissReason: null },
					{ template: "usage_drop", status: "dismissed", dismissReason: "baseline" },
				])
				expect(
					world.rows(`SELECT openRiskHigh, openRiskMedium, healthStatus FROM customer_accounts`),
				).toEqual([{ openRiskHigh: 1, openRiskMedium: 0, healthStatus: "at_risk" }])
				// Baseline mode is one evaluation: the next compute leaves them, until worse by a step.
				yield* world.object.run(runCompute(new Date(Date.now() + 3_600_000))).pipe(Effect.orDie)
				expect(
					world.rows(`SELECT count(*) AS n FROM customer_signals WHERE status = 'dismissed'`),
				).toEqual([{ n: 3 }])
				yield* world.object.run(runCompute(new Date(Date.now() + 25 * 86_400_000))).pipe(Effect.orDie)
				expect(
					world.rows(`SELECT template, status FROM customer_signals WHERE template = 'inactive'`),
				).toEqual([{ template: "inactive", status: "open" }])
			}),
		))

	it("runs compute from its alarm when due, and refuses webhooks for unknown connections", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				// Bootstrap scheduled a first compute; the alarm runs it.
				world.object.storage.db
					.prepare(`UPDATE _object_meta SET value = '0' WHERE key = 'computeDueAt'`)
					.run()
				yield* world.object.alarm
				expect(world.rows<{ n: number }>(`SELECT count(*) AS n FROM customer_org_daily`)[0]!.n).toBe(
					1,
				)
				const next = Number(
					world.rows<{ value: string }>(
						`SELECT value FROM _object_meta WHERE key = 'computeDueAt'`,
					)[0]!.value,
				)
				expect(next).toBeGreaterThan(Date.now() + 50 * 60_000)

				const webhook = (connectionId: string) =>
					world.object
						.call({
							objectId: world.orgId,
							name: "customers.webhook",
							payload: { connectionId, provider: "stripe", headers: {}, body: "{}" },
						})
						.pipe(Effect.map((response) => JSON.stringify(response.exit)))
				expect(yield* webhook(uuid())).toContain('"status":404')
				// Known connection without a webhook secret: refused.
				expect(yield* webhook(world.connection("stripe"))).toContain('"status":400')
			}),
		))

	it("evaluates a bounded share of the accounts per dry run, and says how many", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest(
					"clerk",
					Array.from({ length: 260 }, (_, index): IngestOp => ({
						_tag: "account",
						externalId: `org_${index}`,
						name: `Co ${index}`,
						sameAs: [],
						onNoMatch: "create",
					})),
				)
				const draft: RuleDraft = {
					name: "Quiet for a week",
					severity: "high",
					config: TEMPLATES.inactive.defaultConfig,
					scope: {},
					enabled: true,
				}
				const full = ok(yield* world.call("customers.rule.dryRun", { draft }, world.owner))
				expect([full.evaluatedAccounts, full.totalAccounts]).toEqual([260, 260])

				// Out of time after the first chunk: its 250 accounts only.
				const rule = yield* world.object.run(ruleDryRun(draft, undefined, NOW, 0)).pipe(Effect.orDie)
				expect([rule.evaluatedAccounts, rule.totalAccounts]).toEqual([250, 260])
				expect(rule.matchCount + rule.nonMatches.reduce((sum, entry) => sum + entry.count, 0)).toBe(
					250,
				)
				const health = yield* world.object
					.run(healthDryRun(DEFAULT_HEALTH_SETTINGS, NOW, 0))
					.pipe(Effect.orDie)
				expect([health.evaluatedAccounts, health.totalAccounts]).toEqual([250, 260])
				expect(health.current.reduce((sum, row) => sum + row.count, 0)).toBe(250)
			}),
		))
})
