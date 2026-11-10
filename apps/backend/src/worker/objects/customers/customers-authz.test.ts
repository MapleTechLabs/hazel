/**
 * Who reaches a `CustomersObject` and what they may do there: every `customers.*` RPC for a
 * stranger, a member and a bot; the api Worker's routing (members only); the members the org
 * projects (people, not bots; none for an unknown org); the org's deletion; and the data-source
 * handlers' edge cases (disconnect, ignore rules, bulk limits, credential rotation).
 */
import { DEFAULT_HEALTH_SETTINGS, TEMPLATES } from "@hazel/domain/customers"
import { CustomerRpcs } from "@hazel/domain/rpc"
import type { OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option, Redacted, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { resolveTarget } from "../../../rpc/routing"
import type { HazelRpcTag } from "../../../rpc/dispatch"
import { Directory } from "../../../services/directory"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { customersTarget, orgTarget } from "../kinds"
import { CustomerMembersCall, publishCustomersOrganizationDeleted } from "../org/customer-members"
import { makeTestObjects } from "../testing"
import { encryptSecrets, loadCredentials, storeSecrets } from "./credentials"
import { makeCustomersWorld, ok, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const encryption = IntegrationEncryption.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }),
		),
	),
)

const ruleDraft = {
	name: "Quiet for a week",
	severity: "high",
	config: { ...TEMPLATES.inactive.defaultConfig, inactiveDays: 7 },
	scope: {},
	enabled: true,
}
const viewDraft = {
	name: "Mine",
	filters: { ownedByMe: true },
	sort: { column: "mrr", direction: "desc" },
	columns: ["name"],
}

/** A well-formed payload per method (ids of rows that need not exist: refusals come first). */
const PAYLOADS = {
	"customers.overview": { range: "30d" },
	"customers.account.detail": { accountId: uuid() },
	"customers.account.series": { accountId: uuid(), metricKeys: ["mrr"], range: "30d" },
	"customers.sparklines": { accountIds: [], metricKey: "mrr", days: 7 },
	"customers.contacts.list": { accountId: uuid() },
	"customers.invoices.list": { accountId: uuid() },
	"customers.events.list": {},
	"customers.signals.history": {},
	"customers.rule.dryRun": { draft: ruleDraft },
	"customers.health.dryRun": { draft: DEFAULT_HEALTH_SETTINGS },
	"customers.unmatched.list": {},
	"customers.ignoreRules.list": {},
	"customers.signal.assign": { signalId: uuid(), assigneeUserId: null },
	"customers.signal.snooze": { signalId: uuid(), until: new Date() },
	"customers.signal.done": { signalId: uuid(), outcome: "fixed" },
	"customers.signal.dismiss": { signalId: uuid() },
	"customers.signal.reopen": { signalId: uuid() },
	"customers.note.create": { accountId: uuid(), body: "Hi" },
	"customers.note.update": { noteId: uuid(), body: "Hi" },
	"customers.note.delete": { noteId: uuid() },
	"customers.account.update": { accountId: uuid(), tags: [] },
	"customers.account.bulkUpdate": { accountIds: [] },
	"customers.view.create": { view: viewDraft, shared: true },
	"customers.view.update": { viewId: uuid(), view: viewDraft },
	"customers.view.delete": { viewId: uuid() },
	"customers.view.reorder": { viewIds: [] },
	"customers.rule.create": { rule: ruleDraft },
	"customers.rule.update": { ruleId: uuid(), rule: ruleDraft },
	"customers.rule.delete": { ruleId: uuid() },
	"customers.settings.update": { reportingCurrency: "eur" },
	"customers.connection.connect": {
		provider: "clerk",
		apiKey: "sk_test",
		webhookSecret: null,
		config: { _tag: "clerk", createAccounts: true },
	},
	"customers.connection.update": { connectionId: uuid() },
	"customers.connection.disconnect": { connectionId: uuid() },
	"customers.connection.syncNow": { connectionId: uuid() },
	"customers.unmatched.link": { recordId: uuid(), accountId: uuid() },
	"customers.unmatched.createAccount": { recordId: uuid() },
	"customers.unmatched.ignore": { recordId: uuid() },
	"customers.ignoreRule.delete": { ruleId: uuid() },
	"customers.demo.seed": { accounts: 1 },
} satisfies Record<HazelRpcTag & `customers.${string}`, Record<string, unknown>>

/** Settings, rules and their dry runs, shared views, data sources, unmatched records, the demo seed. */
const ADMIN_ONLY = new Set([
	"customers.rule.dryRun",
	"customers.health.dryRun",
	"customers.unmatched.list",
	"customers.ignoreRules.list",
	"customers.view.create", // `shared: true`
	"customers.rule.create",
	"customers.rule.update",
	"customers.rule.delete",
	"customers.settings.update",
	"customers.connection.connect",
	"customers.connection.update",
	"customers.connection.disconnect",
	"customers.connection.syncNow",
	"customers.unmatched.link",
	"customers.unmatched.createAccount",
	"customers.unmatched.ignore",
	"customers.ignoreRule.delete",
	"customers.demo.seed",
])

const meta = (rows: (query: string, key: string) => Array<{ value: string }>, key: string) =>
	rows(`SELECT value FROM _object_meta WHERE key = ?`, key)[0]?.value

describe("Customers authorization", () => {
	it("refuses strangers and bots every method, and members the admin-only ones", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				expect(Object.keys(PAYLOADS).sort()).toEqual([...CustomerRpcs.requests.keys()].sort())
				// A bot projected by an older org (bots are no longer projected) still gets nothing.
				const bot = uuid() as UserId
				yield* world.object.applyEffect({
					objectId: world.orgId,
					kind: "customers.setMembers",
					payload: {
						organizationId: world.orgId,
						members: [
							{ userId: world.owner, role: "owner" },
							{ userId: world.member, role: "member" },
							{ userId: bot, role: "admin" },
						],
						version: 2,
					},
					key: uuid(),
					sender: { kind: "org", id: world.orgId },
				})
				const scopes = ["customers:read", "customers:write"] as const
				for (const [tag, payload] of Object.entries(PAYLOADS)) {
					const as = (
						user: UserId,
						botScopes?: ReadonlyArray<"customers:read" | "customers:write">,
					) => world.call(tag as HazelRpcTag, payload, user, botScopes).pipe(Effect.map(tagOf))
					expect([tag, yield* as(world.stranger)]).toEqual([tag, "UnauthorizedError"])
					expect([tag, yield* as(bot, scopes)]).toEqual([tag, "UnauthorizedError"])
					const member = yield* as(world.member)
					if (ADMIN_ONLY.has(tag)) expect([tag, member]).toEqual([tag, "UnauthorizedError"])
					else expect([tag, member]).not.toEqual([tag, "UnauthorizedError"])
				}
			}),
		))

	it("routes a customers call only for a current member of the org", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const [member, gone, stranger] = [uuid(), uuid(), uuid()] as Array<UserId>
				yield* Effect.flatMap(Directory, (directory) =>
					Effect.all([
						directory.upsertMembership({
							userId: member,
							organizationId: orgId,
							deletedAt: null,
						}),
						directory.upsertMembership({
							userId: gone,
							organizationId: orgId,
							deletedAt: new Date(),
						}),
					]),
				).pipe(Effect.provideContext(objects.directory))
				const route = (user: UserId) =>
					resolveTarget("customers.overview", { organizationId: orgId, range: "30d" }, {
						id: user,
					} as never).pipe(Effect.provideContext(objects.directory), Effect.exit)
				expect(yield* route(member)).toEqual(Exit.succeed(customersTarget(orgId)))
				expect(tagOf(yield* route(gone))).toBe("RouteRefusedError")
				expect(tagOf(yield* route(stranger))).toBe("RouteRefusedError")
			}),
		))
})

describe("Customers members and lifecycle", () => {
	it("projects people only, and nothing for an org with no organization row", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const org = yield* objects.get(orgTarget(orgId))
				const pull = org.call({
					objectId: orgId,
					name: CustomerMembersCall.name,
					payload: { organizationId: orgId },
				})
				// Unknown org: no members, not enabled.
				expect((yield* pull).exit).toMatchObject({ _tag: "Success", value: null })
				expect(
					org.storage.db
						.prepare(`SELECT value FROM _object_meta WHERE key = 'customersEnabled'`)
						.all(),
				).toEqual([])

				const [owner, botUser] = [uuid(), uuid()] as Array<UserId>
				org.storage.db.prepare(`INSERT INTO organizations (id, name) VALUES (?, 'Acme')`).run(orgId)
				const insert = org.storage.db.prepare(
					`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, ?)`,
				)
				insert.run(uuid(), orgId, owner, "owner")
				insert.run(uuid(), orgId, botUser, "member")
				org.storage.db
					.prepare(
						`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, 'bot@x', 'Bot', '', 'machine')`,
					)
					.run(botUser, `bot-${botUser}`)
				const answer = (yield* pull).exit as { value: { members: Array<{ userId: string }> } }
				expect(answer.value.members.map((row) => row.userId)).toEqual([owner])
			}),
		))

	it("projects and replaces 150 members (past the 100 bound-parameter limit)", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const org = yield* objects.get(orgTarget(orgId))
				org.storage.db.prepare(`INSERT INTO organizations (id, name) VALUES (?, 'Acme')`).run(orgId)
				const insert = org.storage.db.prepare(
					`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, ?)`,
				)
				const users = Array.from({ length: 150 }, () => uuid() as UserId)
				for (const userId of users) insert.run(uuid(), orgId, userId, "member")
				const answer = (yield* org.call({
					objectId: orgId,
					name: CustomerMembersCall.name,
					payload: { organizationId: orgId },
				})).exit as { _tag: string; value: { members: Array<{ userId: string }> } }
				expect(answer._tag).toBe("Success")
				expect(answer.value.members).toHaveLength(150)

				const customers = yield* objects.get(customersTarget(orgId))
				const setMembers = (version: number, members: ReadonlyArray<UserId>, deleted: boolean) =>
					customers.applyEffect({
						objectId: orgId,
						kind: "customers.setMembers",
						payload: {
							organizationId: orgId,
							members: members.map((userId) => ({ userId, role: "member" })),
							version,
							organizationDeleted: deleted,
						},
						key: uuid(),
						sender: { kind: "org", id: orgId },
					})
				const count = () =>
					customers.storage.db.prepare(`SELECT count(*) AS n FROM customer_members`).all()
				expect((yield* setMembers(1, users, false))._tag).toBe("Applied")
				expect(count()).toEqual([{ n: 150 }])
				expect((yield* setMembers(2, [], true))._tag).toBe("Applied")
				expect(count()).toEqual([{ n: 0 }])
			}),
		))

	it("an object for an unknown org installs nothing and schedules no compute", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const customers = yield* objects.get(customersTarget(orgId))
				yield* customers.applyEffect({
					objectId: orgId,
					kind: "customers.unknown",
					payload: {},
					key: uuid(),
					sender: { kind: "org", id: orgId },
				})
				yield* customers.alarm
				const rows = (query: string, ...params: Array<string>) =>
					customers.storage.db.prepare(query).all(...params) as Array<{ value: string }>
				expect(rows(`SELECT count(*) AS value FROM customer_signal_rules`)).toEqual([{ value: 0 }])
				expect(meta(rows, "computeDueAt")).toBeUndefined()
				expect(meta(rows, "defaultsInstalled")).toBeUndefined()
			}),
		))

	it("shuts down when the org is deleted: no members, sources disconnected, no compute", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("stripe")
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET status = 'active', nextSyncAt = ? WHERE id = ?`)
					.run("2030-01-01 00:00:00.000", connectionId)
				yield* world.object
					.run(
						Effect.gen(function* () {
							yield* storeSecrets(connectionId, yield* encryptSecrets("sk_test", "whsec"))
						}).pipe(Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				expect(meta(world.rows, "computeDueAt")).toBeDefined()

				const org = yield* world.objects.get(orgTarget(world.orgId))
				// The org learns its id from its first entry point.
				yield* org.call({
					objectId: world.orgId,
					name: CustomerMembersCall.name,
					payload: { organizationId: world.orgId },
				})
				org.storage.db
					.prepare(`INSERT INTO _object_meta (key, value) VALUES ('customersEnabled', '1')`)
					.run()
				yield* org.run(publishCustomersOrganizationDeleted(world.orgId)).pipe(Effect.orDie)
				yield* org.afterCommit

				expect(world.rows(`SELECT count(*) AS n FROM customer_members`)).toEqual([{ n: 0 }])
				expect(
					world.rows(
						`SELECT status, nextSyncAt FROM customer_connections WHERE id = ?`,
						connectionId,
					),
				).toEqual([{ status: "disconnected", nextSyncAt: null }])
				expect(world.rows(`SELECT count(*) AS n FROM customer_connection_secrets`)).toEqual([
					{ n: 0 },
				])
				expect(meta(world.rows, "computeDueAt")).toBeUndefined()
				expect(tagOf(yield* world.call("customers.overview", { range: "30d" }, world.owner))).toBe(
					"UnauthorizedError",
				)
			}),
		))
})

describe("Customers data-source handlers", () => {
	it("answers a storage failure as an InternalServerError, and refuses an assignee or owner who is not a member", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				expect(
					tagOf(
						yield* world.call(
							"customers.account.update",
							{ accountId: uuid(), ownerUserId: world.stranger },
							world.member,
						),
					),
				).toBe("CustomersInvalidRequestError")
				expect(
					tagOf(
						yield* world.call(
							"customers.signal.assign",
							{ signalId: uuid(), assigneeUserId: world.stranger },
							world.member,
						),
					),
				).toBe("CustomersInvalidRequestError")
				world.object.storage.db.prepare(`DROP TABLE customer_org_daily`).run()
				expect(tagOf(yield* world.call("customers.overview", { range: "30d" }, world.member))).toBe(
					"InternalServerError",
				)
			}),
		))

	it("ignores only an open unmatched record", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const recordId = uuid()
				world.object.storage.db
					.prepare(
						`INSERT INTO customer_unmatched_records (id, connectionId, provider, entityType, externalId, label, reason, payload, status) VALUES (?, ?, 'stripe', 'account', 'cus_1', 'Test', 'no_match', 'null', 'linked')`,
					)
					.run(recordId, world.connection("stripe"))
				expect(
					tagOf(yield* world.call("customers.unmatched.ignore", { recordId }, world.owner)),
				).toBe("CustomersInvalidRequestError")
			}),
		))

	it("disconnecting ends the connection's running sync runs and leaves its refs as they are", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("clerk")
				const org = (externalId: string) => ({
					_tag: "account" as const,
					externalId,
					name: externalId,
					sameAs: [],
					onNoMatch: "create" as const,
				})
				yield* world.ingest("clerk", [
					org("org_live"),
					org("org_gone"),
					{ ...org("org_gone"), deleted: true },
				])
				const refs = () =>
					world.rows(
						`SELECT externalId, staleAt IS NOT NULL AS stale FROM customer_external_refs ORDER BY externalId`,
					)
				const before = refs()
				expect(before).toEqual([
					{ externalId: "org_gone", stale: 1 },
					{ externalId: "org_live", stale: 0 },
				])
				world.object.storage.db
					.prepare(
						`INSERT INTO customer_sync_runs (id, organizationId, connectionId, provider, trigger) VALUES (?, ?, ?, 'clerk', 'backfill')`,
					)
					.run(uuid(), world.orgId, connectionId)
				ok(yield* world.call("customers.connection.disconnect", { connectionId }, world.owner))
				expect(world.rows(`SELECT status FROM customer_sync_runs`)).toEqual([{ status: "failed" }])
				// Staleness is the provider's removal only: the UI reads a disconnect from the connection.
				expect(refs()).toEqual(before)
				// New credentials for a disconnected connection come with a connect.
				expect(
					tagOf(
						yield* world.call(
							"customers.connection.update",
							{ connectionId, apiKey: "sk_new" },
							world.owner,
						),
					),
				).toBe("CustomersInvalidRequestError")
			}),
		))

	it("an ignore rule also ignores the open records it covers", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("stripe")
				const insert = world.object.storage.db.prepare(
					`INSERT INTO customer_unmatched_records (id, connectionId, provider, entityType, externalId, label, email, reason, payload) VALUES (?, ?, 'stripe', ?, ?, ?, ?, 'no_match', 'null')`,
				)
				const [first, sibling, other, contact] = [uuid(), uuid(), uuid(), uuid()]
				insert.run(first, connectionId, "account", "cus_1", "Test 1", "a@test.io")
				insert.run(sibling, connectionId, "account", "cus_2", "Test 2", "b@test.io")
				insert.run(other, connectionId, "account", "cus_3", "Real", "c@real.io")
				insert.run(contact, connectionId, "contact", "u_1", "Test user", "d@test.io")
				const ignored = ok(
					yield* world.call(
						"customers.unmatched.ignore",
						{ recordId: first, rule: { field: "email", pattern: "*@test.io" } },
						world.owner,
					),
				)
				expect([...ignored.data.ignoredRecordIds].sort()).toEqual([first, sibling].sort())
				expect(
					world.rows(`SELECT id, status FROM customer_unmatched_records ORDER BY label`),
				).toEqual(
					expect.arrayContaining([
						{ id: first, status: "ignored" },
						{ id: sibling, status: "ignored" },
						{ id: other, status: "open" },
						{ id: contact, status: "open" },
					]),
				)
			}),
		))

	it("refuses a bulk update over 500 accounts and a config for another provider", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const accountIds = Array.from({ length: 501 }, () => uuid())
				expect(
					tagOf(yield* world.call("customers.account.bulkUpdate", { accountIds }, world.member)),
				).toBe("CustomersInvalidRequestError")
				expect(
					tagOf(
						yield* world.call(
							"customers.connection.update",
							{
								connectionId: world.connection("clerk"),
								config: { _tag: "autumn", customerIdIsClerkOrgId: true },
							},
							world.owner,
						),
					),
				).toBe("CustomersInvalidRequestError")
			}),
		))

	it("rotating the webhook secret keeps the stored API key", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("stripe")
				yield* world.object
					.run(
						Effect.gen(function* () {
							yield* storeSecrets(connectionId, yield* encryptSecrets("sk_live", "whsec_old"))
						}).pipe(Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				ok(
					yield* world.call(
						"customers.connection.update",
						{ connectionId, webhookSecret: "whsec_new" },
						world.owner,
					),
				)
				const stored = yield* world.object
					.run(
						loadCredentials({
							id: connectionId,
							config: {
								_tag: "stripe",
								clerkOrgMetadataKey: "clerk_org_id",
								matchByDomain: true,
							},
							externalAccountId: null,
						}).pipe(Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				const credentials = Option.getOrThrow(stored)
				expect(Redacted.value(credentials.apiKey)).toBe("sk_live")
				expect(credentials.webhookSecret && Redacted.value(credentials.webhookSecret)).toBe(
					"whsec_new",
				)
				expect(
					world.rows(
						`SELECT hasWebhookSecret FROM customer_connections WHERE id = ?`,
						connectionId,
					),
				).toEqual([{ hasWebhookSecret: 1 }])
			}),
		))
})
