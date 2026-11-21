import { CompanyProfile, type UpsertAccount } from "@hazel/domain/customers"
import { Effect, Schema, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { type CustomersWorld, makeCustomersWorld, NOW, tagOf } from "../test-kit"
import { ContextDev, type ContextDevApi } from "./client"
import { FakeStatus, makeFakeContextDev, northwindBrand, northwindSearch } from "./fixtures"
import {
	ENRICH_PER_TURN,
	LEASE_MS,
	postponeDueEnrichments,
	enrichmentDeadline,
	REFRESH_MS,
	requestCompanyRefresh,
	runDueEnrichments,
	seedEnrichments,
} from "./job"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const DAY_MS = 86_400_000
const at = (ms: number) => new Date(NOW.getTime() + ms)

const clerkOrg = (id: string, name: string, domains: ReadonlyArray<string>): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [...domains],
	sameAs: [],
	onNoMatch: "create",
})

/** SQLite keeps an instant as `YYYY-MM-DD HH:MM:SS.SSS` (UTC). */
const msOf = (value: string | null) => (value === null ? null : Date.parse(`${value.replace(" ", "T")}Z`))

interface EnrichmentRow {
	readonly domain: string
	readonly status: string
	readonly nextAttemptAt: string | null
	readonly forceRefresh: number
	readonly failures: number
	readonly creditsUsed: number
	readonly profile: string | null
}

const enrichmentOf = (world: CustomersWorld, domain: string) =>
	world.rows<EnrichmentRow>(`SELECT * FROM customer_enrichments WHERE domain = ?`, domain)[0]

const accountOf = (world: CustomersWorld, name: string) => {
	const row = world.rows<{
		id: string
		logoUrl: string | null
		companyProfile: string | null
		companyCheckedAt: string | null
	}>(`SELECT id, logoUrl, companyProfile, companyCheckedAt FROM customer_accounts WHERE name = ?`, name)[0]!
	return {
		...row,
		profile:
			row.companyProfile === null
				? null
				: Schema.decodeUnknownSync(CompanyProfile)(JSON.parse(row.companyProfile)),
	}
}

const within = (
	world: CustomersWorld,
	effect: Effect.Effect<unknown, unknown, any>,
	contextDev: ContextDevApi,
) =>
	world.object
		.run(effect.pipe(Effect.provideService(ContextDev, ContextDev.of(contextDev))))
		.pipe(Effect.orDie)

describe("company enrichment", () => {
	it("looks each domain up once, copies the answer onto its accounts, and never touches synced fields", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				fake.state.brands.set("northwind.dev", northwindBrand)
				fake.state.searches.set("northwind.dev", northwindSearch)
				yield* world.ingest("clerk", [
					{
						...clerkOrg("org_us", "Northwind US", ["northwind.dev"]),
						logoUrl: "https://img.clerk.com/northwind.png",
					},
					clerkOrg("org_eu", "Northwind EU", ["gmail.com", "northwind.dev"]),
					clerkOrg("org_solo", "Solo", ["gmail.com"]),
				])

				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				expect(world.rows(`SELECT domain FROM customer_enrichments`)).toEqual([
					{ domain: "northwind.dev" },
				])
				expect(yield* within(world, enrichmentDeadline, fake.contextDev)).toBe(NOW.getTime())

				yield* within(world, runDueEnrichments(NOW), fake.contextDev)
				expect(fake.state.requests.map((request) => request.path)).toEqual([
					"/brand/retrieve",
					"/company/search",
				])
				expect(fake.state.requests[0]!.authorization).toBe("Bearer cd_test_key")
				expect(fake.state.requests[0]!.body).toMatchObject({
					type: "by_domain",
					domain: "northwind.dev",
				})
				expect(fake.state.requests[0]!.body).toMatchObject({ maxAgeMs: REFRESH_MS })

				const row = enrichmentOf(world, "northwind.dev")!
				expect(row).toMatchObject({
					status: "enriched",
					failures: 0,
					creditsUsed: 12,
					forceRefresh: 0,
				})
				expect(msOf(row.nextAttemptAt)).toBe(NOW.getTime() + REFRESH_MS)

				const us = accountOf(world, "Northwind US")
				const eu = accountOf(world, "Northwind EU")
				expect(us.profile).toMatchObject({
					name: "Northwind Labs",
					employeeRange: "201-500",
					foundedYear: 2019,
				})
				expect(eu.profile).toEqual(us.profile)
				expect(msOf(us.companyCheckedAt)).toBe(NOW.getTime())
				// Clerk's logo stays; the profile's is only a fallback.
				expect(us.logoUrl).toBe("https://img.clerk.com/northwind.png")
				expect(accountOf(world, "Solo").companyCheckedAt).toBeNull()

				// Nothing due: no request, and a new account at a known domain gets the answer at the next seed.
				yield* within(world, runDueEnrichments(at(60_000)), fake.contextDev)
				expect(fake.state.requests).toHaveLength(2)
				yield* world.ingest("clerk", [clerkOrg("org_apac", "Northwind APAC", ["northwind.dev"])])
				yield* within(world, seedEnrichments(at(60_000)), fake.contextDev)
				expect(accountOf(world, "Northwind APAC").profile?.name).toBe("Northwind Labs")
			}),
		))

	it("records misses, mail-provider refusals, rate limits and failures with their own retry", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				fake.state.brands.set("free.io", new FakeStatus(422, "FREE_EMAIL_DETECTED"))
				fake.state.brands.set("busy.io", new FakeStatus(429, "RATE_LIMITED", { "retry-after": "30" }))
				fake.state.brands.set("down.io", new FakeStatus(503, "UNAVAILABLE"))
				yield* world.ingest("clerk", [
					clerkOrg("org_a", "Unknown Co", ["unknown.io"]),
					clerkOrg("org_b", "Free Co", ["free.io"]),
					clerkOrg("org_c", "Busy Co", ["busy.io"]),
					clerkOrg("org_d", "Down Co", ["down.io"]),
				])
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				yield* within(world, runDueEnrichments(NOW), fake.contextDev)

				// A miss is an answer: checked, nothing found, asked again with the refresh.
				expect(enrichmentOf(world, "unknown.io")).toMatchObject({
					status: "not_found",
					profile: null,
					creditsUsed: 0,
				})
				expect(msOf(enrichmentOf(world, "unknown.io")!.nextAttemptAt)).toBe(
					NOW.getTime() + REFRESH_MS,
				)
				expect(msOf(accountOf(world, "Unknown Co").companyCheckedAt)).toBe(NOW.getTime())
				// No search after a miss.
				expect(
					fake.state.requests.filter((request) => request.path === "/company/search"),
				).toHaveLength(0)

				expect(enrichmentOf(world, "free.io")).toMatchObject({ status: "skipped" })
				expect(msOf(enrichmentOf(world, "free.io")!.nextAttemptAt)).toBe(NOW.getTime() + 365 * DAY_MS)

				// Retried once in place (a 30 s wait is too long), then left to the alarm after the delay.
				expect(enrichmentOf(world, "busy.io")).toMatchObject({ status: "pending", failures: 0 })
				expect(msOf(enrichmentOf(world, "busy.io")!.nextAttemptAt)).toBe(NOW.getTime() + 30_000)

				expect(enrichmentOf(world, "down.io")).toMatchObject({ status: "failed", failures: 1 })
				expect(msOf(enrichmentOf(world, "down.io")!.nextAttemptAt)).toBe(NOW.getTime() + 10 * 60_000)
				expect(accountOf(world, "Down Co").companyCheckedAt).toBeNull()
			}),
		))

	it("takes a bounded batch per turn", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				yield* world.ingest(
					"clerk",
					Array.from({ length: ENRICH_PER_TURN + 3 }, (_, index) =>
						clerkOrg(`org_${index}`, `Co ${index}`, [`co${index}.io`]),
					),
				)
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				yield* within(world, runDueEnrichments(NOW), fake.contextDev)
				expect(fake.state.requests).toHaveLength(ENRICH_PER_TURN)
				// The rest stays due: the alarm comes right back.
				expect(yield* within(world, enrichmentDeadline, fake.contextDev)).toBe(NOW.getTime())
			}),
		))

	it("waits a day without a key, and a refresh skips the cache and goes first", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				fake.state.brands.set("northwind.dev", northwindBrand)
				yield* world.ingest("clerk", [
					clerkOrg("org_us", "Northwind", ["northwind.dev"]),
					clerkOrg("org_x", "Gmail Co", ["gmail.com"]),
				])
				yield* within(world, seedEnrichments(NOW), fake.contextDev)

				yield* within(world, runDueEnrichments(NOW), fake.disabled)
				expect(fake.state.requests).toHaveLength(0)
				expect(msOf(enrichmentOf(world, "northwind.dev")!.nextAttemptAt)).toBe(NOW.getTime() + DAY_MS)
				expect(
					yield* within(
						world,
						requestCompanyRefresh({ domains: ["northwind.dev"] }, NOW),
						fake.disabled,
					),
				).toBe("disabled")

				expect(
					yield* within(
						world,
						requestCompanyRefresh({ domains: ["gmail.com"] }, NOW),
						fake.contextDev,
					),
				).toBe("no_domain")
				expect(
					yield* within(
						world,
						requestCompanyRefresh({ domains: ["northwind.dev"] }, NOW),
						fake.contextDev,
					),
				).toBe("queued")
				expect(enrichmentOf(world, "northwind.dev")).toMatchObject({ forceRefresh: 1 })
				yield* within(world, runDueEnrichments(NOW), fake.contextDev)
				expect(fake.state.requests[0]!.body).toMatchObject({ maxAgeMs: 0 })
				expect(enrichmentOf(world, "northwind.dev")).toMatchObject({
					status: "enriched",
					forceRefresh: 0,
				})
			}),
		))

	it("refuses a refresh over RPC when lookups are not set up", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_us", "Northwind", ["northwind.dev"])])
				const { id } = accountOf(world, "Northwind")
				const exit = yield* world.call(
					"customers.account.refreshCompany",
					{ accountId: id },
					world.member,
				)
				expect(tagOf(exit)).toBe("CustomersInvalidRequestError")
				expect(
					tagOf(
						yield* world.call(
							"customers.account.refreshCompany",
							{ accountId: id },
							world.stranger,
						),
					),
				).not.toBe("Success")
			}),
		))

	it("an account that changed or lost its domain takes the new domain's answer, or none", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				fake.state.brands.set("northwind.dev", northwindBrand)
				yield* world.ingest("clerk", [
					clerkOrg("org_a", "Moved", ["northwind.dev"]),
					clerkOrg("org_b", "Gone", ["northwind.dev"]),
				])
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				yield* within(world, runDueEnrichments(NOW), fake.contextDev)
				expect(accountOf(world, "Moved").profile?.name).toBe("Northwind Labs")
				const setDomains = (name: string, domains: ReadonlyArray<string>) =>
					world.object.storage.db
						.prepare(`UPDATE customer_accounts SET domains = ? WHERE name = ?`)
						.run(JSON.stringify(domains), name)
				setDomains("Moved", ["unknown.io"])
				setDomains("Gone", ["gmail.com"])
				const later = at(60_000)
				yield* within(world, seedEnrichments(later), fake.contextDev)
				// Cleared at once (SQL NULL, not the text `null`), before the new domain is looked up.
				const cleared = world.rows<{ name: string; cleared: number }>(
					`SELECT name, companyProfile IS NULL AS cleared FROM customer_accounts ORDER BY name`,
				)
				expect(cleared).toEqual([
					{ name: "Gone", cleared: 1 },
					{ name: "Moved", cleared: 1 },
				])
				// Seeding again writes nothing more.
				const before = world.rows(`SELECT name, updatedAt FROM customer_accounts ORDER BY name`)
				yield* within(world, seedEnrichments(at(120_000)), fake.contextDev)
				expect(world.rows(`SELECT name, updatedAt FROM customer_accounts ORDER BY name`)).toEqual(
					before,
				)
				// northwind.dev has no account left: no longer looked up.
				expect(enrichmentOf(world, "northwind.dev")!.nextAttemptAt).toBeNull()
			}),
		))

	it("copies an answer onto more accounts than one statement can bind", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				fake.state.brands.set("bigcorp.com", northwindBrand)
				yield* world.ingest(
					"clerk",
					Array.from({ length: 120 }, (_, index) =>
						clerkOrg(`org_${index}`, `Team ${index}`, ["bigcorp.com"]),
					),
				)
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				yield* within(world, runDueEnrichments(NOW), fake.contextDev)
				expect(
					world.rows<{ n: number }>(
						`SELECT COUNT(*) AS n FROM customer_accounts WHERE companyProfile IS NOT NULL`,
					)[0]!.n,
				).toBe(120)
			}),
		))

	it("a refresh asked while a lookup is out stays due", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_a", "Northwind", ["northwind.dev"])])
				const fake = makeFakeContextDev()
				fake.state.brands.set("northwind.dev", northwindBrand)
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				const asksMidway: ContextDevApi = {
					enabled: true,
					lookup: (domain, options) =>
						Effect.andThen(
							Effect.sync(() =>
								world.object.storage.db
									.prepare(
										`UPDATE customer_enrichments SET forceRefresh = 1, nextAttemptAt = ?`,
									)
									.run("2026-06-15 12:00:00.000"),
							),
							fake.contextDev.lookup(domain, options),
						),
				}
				yield* within(world, runDueEnrichments(NOW), asksMidway)
				const row = enrichmentOf(world, "northwind.dev")!
				expect(row).toMatchObject({ status: "enriched", forceRefresh: 1 })
				expect(msOf(row.nextAttemptAt)).toBe(NOW.getTime())
			}),
		))

	it("only Brand's no-company codes mean no company; another refusal or a defect is a failure", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				fake.state.brands.set("bad.io", new FakeStatus(400, "INVALID_REQUEST"))
				fake.state.brands.set("cold.io", new FakeStatus(422, "COLD_DOMAIN_TIMEOUT_TOO_LOW"))
				yield* world.ingest("clerk", [
					clerkOrg("org_a", "Bad", ["bad.io"]),
					clerkOrg("org_b", "Boom", ["boom.io"]),
					clerkOrg("org_c", "Cold", ["cold.io"]),
				])
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				const boom: ContextDevApi = {
					enabled: true,
					lookup: (domain, options) =>
						domain === "boom.io"
							? Effect.die(new Error("boom"))
							: fake.contextDev.lookup(domain, options),
				}
				yield* within(world, runDueEnrichments(NOW), boom)
				expect(enrichmentOf(world, "bad.io")).toMatchObject({ status: "failed", failures: 1 })
				expect(enrichmentOf(world, "boom.io")).toMatchObject({ status: "failed", failures: 1 })
				// Too little time for a domain context.dev has not seen: retried, not skipped for a year.
				expect(enrichmentOf(world, "cold.io")).toMatchObject({ status: "failed", failures: 1 })
				expect(accountOf(world, "Bad").companyCheckedAt).toBeNull()
			}),
		))

	it("a domain whose accounts were deleted is stopped without a lookup", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				yield* world.ingest("clerk", [clerkOrg("org_a", "Gone", ["gone.io"])])
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				world.object.storage.db
					.prepare(`UPDATE customer_accounts SET deletedAt = ? WHERE name = ?`)
					.run("2026-06-15 11:00:00.000", "Gone")
				yield* within(world, runDueEnrichments(NOW), fake.contextDev)
				expect(fake.state.requests).toHaveLength(0)
				expect(enrichmentOf(world, "gone.io")!.nextAttemptAt).toBeNull()
			}),
		))

	it("rows a failed turn left due move a lease ahead", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const fake = makeFakeContextDev()
				yield* world.ingest("clerk", [clerkOrg("org_a", "Acme", ["acme.io"])])
				yield* within(world, seedEnrichments(NOW), fake.contextDev)
				yield* within(world, postponeDueEnrichments(NOW), fake.contextDev)
				expect(yield* within(world, enrichmentDeadline, fake.contextDev)).toBe(
					NOW.getTime() + LEASE_MS,
				)
			}),
		))
})
