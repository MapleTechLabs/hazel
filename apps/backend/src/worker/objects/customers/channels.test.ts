/**
 * Channels linked to customers (`docs/customers/channels.md`): the `CustomersObject` checks the
 * channel with its `OrgObject`, keeps one live link per channel, and projects the links to the
 * org (`channel_customers`), which follows renames, moves, unlinks and deleted accounts.
 */
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { orgTarget } from "../kinds"
import { forgetChannelCustomer } from "../org/channel-customers"
import { publishChannelCustomersAfterCompute } from "./channels"
import { runCompute } from "./compute"
import { makeCustomersWorld, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

type ChannelType = "public" | "private" | "thread" | "direct" | "single"

const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", [
		{ _tag: "account", externalId: "org_acme", name: "Acme", sameAs: [], onNoMatch: "create" },
		{ _tag: "account", externalId: "org_globex", name: "Globex", sameAs: [], onNoMatch: "create" },
	])
	const accountId = (name: string) =>
		world.rows<{ id: string }>(`SELECT id FROM customer_accounts WHERE name = ?`, name)[0]!.id
	const org = yield* world.objects.get(orgTarget(world.orgId))
	const orgRows = <T>(query: string, ...params: Array<string>) =>
		org.storage.db.prepare(query).all(...params) as Array<T>
	/** A channel of the org; `seenBy` get its `channel_access`. */
	const channel = (type: ChannelType, seenBy: ReadonlyArray<UserId>) => {
		const id = uuid()
		org.storage.db
			.prepare(`INSERT INTO channels (id, name, type, organizationId) VALUES (?, ?, ?, ?)`)
			.run(id, `${type}-${id.slice(0, 4)}`, type, world.orgId)
		for (const userId of seenBy) {
			org.storage.db
				.prepare(`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`)
				.run(userId, id, world.orgId)
		}
		return id
	}
	const link = (account: string, channelId: string, user: UserId = world.member) =>
		world.call("customers.channel.link", { accountId: accountId(account), channelId }, user)
	const unlink = (channelId: string, user: UserId = world.member) =>
		world.call("customers.channel.unlink", { channelId }, user)
	const projected = () =>
		orgRows<{ channelId: string; accountId: string; accountName: string }>(
			`SELECT channelId, accountId, accountName FROM channel_customers ORDER BY channelId`,
		)
	const liveLinks = () =>
		world.rows<{ channelId: string; accountId: string }>(
			`SELECT channelId, accountId FROM customer_channel_links WHERE deletedAt IS NULL`,
		)
	/** The org's full row for a channel, JSON columns parsed. */
	const glance = (channelId: string) => {
		const row = orgRows<{
			topSignals: string
			sourceLinks: string
			openSignalCount: number
			ownerUserId: string
		}>(`SELECT * FROM channel_customers WHERE channelId = ?`, channelId)[0]
		if (row === undefined) throw new Error(`no channel_customers row for ${channelId}`)
		// SAFETY: the receiver writes these columns from the decoded `ChannelCustomerEntry` arrays.
		return {
			...row,
			topSignals: JSON.parse(row.topSignals) as Array<{ id: string; title: string }>,
			// SAFETY: as above.
			sourceLinks: JSON.parse(row.sourceLinks) as Array<{ provider: string; url: string }>,
		}
	}
	/** What a compute does last, then the alarm delivers it. */
	const publish = Effect.gen(function* () {
		yield* world.object.run(publishChannelCustomersAfterCompute)
		yield* world.object.alarm
	}).pipe(Effect.orDie)
	const signal = (account: string, title: string, priorityScore: number, status = "open") => {
		const id = uuid()
		world.rows(
			`INSERT INTO customer_signals (id, organizationId, accountId, ruleId, template, kind, severity, status,
				title, reason, evidence, openingEvidence, priorityScore)
			 VALUES (?, ?, ?, ?, 'inactive', 'risk', 'high', ?, ?, ?, '{}', '{}', ?)`,
			id,
			world.orgId,
			accountId(account),
			uuid(),
			status,
			title,
			`${title} because`,
			priorityScore,
		)
		return id
	}
	return { world, org, accountId, channel, link, unlink, projected, liveLinks, glance, publish, signal }
})

describe("Customer channel links", () => {
	it("links a channel the member sees and projects it to the org", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				expect(tagOf(yield* t.link("Acme", general))).toBe("Success")
				expect(t.liveLinks()).toEqual([{ channelId: general, accountId: t.accountId("Acme") }])
				expect(t.projected()).toEqual([
					{ channelId: general, accountId: t.accountId("Acme"), accountName: "Acme" },
				])
				// Linking again changes nothing.
				expect(tagOf(yield* t.link("Acme", general))).toBe("Success")
				expect(t.liveLinks()).toHaveLength(1)
				const events = t.world.rows<{ type: string }>(
					`SELECT type FROM customer_events WHERE provider = 'hazel' AND type LIKE 'channel.%'`,
				)
				expect(events.map((event) => event.type)).toEqual(["channel.linked"])
			}),
		))

	it("refuses channels the member cannot see, threads and DMs, and unknown accounts", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const secret = t.channel("private", [t.world.owner])
				const thread = t.channel("thread", [t.world.member])
				const dm = t.channel("direct", [t.world.member])
				expect(tagOf(yield* t.link("Acme", secret))).toBe("CustomersNotFoundError")
				expect(tagOf(yield* t.link("Acme", uuid()))).toBe("CustomersNotFoundError")
				expect(tagOf(yield* t.link("Acme", thread))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* t.link("Acme", dm))).toBe("CustomersInvalidRequestError")
				const unknown = yield* t.world.call(
					"customers.channel.link",
					{ accountId: uuid(), channelId: t.channel("public", [t.world.member]) },
					t.world.member,
				)
				expect(tagOf(unknown)).toBe("CustomersNotFoundError")
				// The owner sees the private channel.
				expect(tagOf(yield* t.link("Acme", secret, t.world.owner))).toBe("Success")
				expect(t.liveLinks()).toHaveLength(1)
			}),
		))

	it("moves a channel to the account it is linked to last, and follows renames and unlinks", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const shared = t.channel("public", [t.world.member, t.world.owner])
				const other = t.channel("private", [t.world.member])
				yield* t.link("Acme", shared)
				yield* t.link("Acme", other)
				expect(tagOf(yield* t.link("Globex", shared))).toBe("Success")
				expect(t.liveLinks()).toHaveLength(2)
				expect(t.projected().find((row) => row.channelId === shared)?.accountName).toBe("Globex")

				const rename = yield* t.world.call(
					"customers.account.update",
					{ accountId: t.accountId("Globex"), name: "Globex Corp" },
					t.world.owner,
				)
				expect(tagOf(rename)).toBe("Success")
				expect(t.projected().find((row) => row.channelId === shared)?.accountName).toBe("Globex Corp")

				expect(tagOf(yield* t.unlink(shared))).toBe("Success")
				// Unlinking a channel with no link is a no-op.
				expect(tagOf(yield* t.unlink(shared))).toBe("Success")
				expect(t.projected().map((row) => row.channelId)).toEqual([other])
			}),
		))

	it("links channels to the customer's group, not one environment", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const acme = t.accountId("Acme")
				const globex = t.accountId("Globex")
				const before = t.channel("public", [t.world.member])
				const after = t.channel("public", [t.world.member])
				yield* t.link("Globex", before)
				const group = (accountId: string, primaryAccountId: string) =>
					t.world.call("customers.account.link", { accountId, primaryAccountId }, t.world.owner)
				// Globex becomes an environment of Acme: its channel moves to the customer.
				expect(tagOf(yield* group(globex, acme))).toBe("Success")
				expect(t.liveLinks()).toEqual([{ channelId: before, accountId: acme }])
				// Linked from an environment, a channel is stored on the primary.
				expect(tagOf(yield* t.link("Globex", after))).toBe("Success")
				// Linking it from another environment of the same customer changes nothing.
				expect(tagOf(yield* t.link("Acme", after))).toBe("Success")
				const byChannel = (rows: ReadonlyArray<{ channelId: string; accountId: string }>) =>
					[...rows].sort((a, b) => a.channelId.localeCompare(b.channelId))
				expect(byChannel(t.liveLinks())).toEqual(
					byChannel([
						{ channelId: before, accountId: acme },
						{ channelId: after, accountId: acme },
					]),
				)
				expect(t.projected().map((row) => row.accountName)).toEqual(["Acme", "Acme"])

				// A new primary takes the customer's channels.
				const primary = yield* t.world.call(
					"customers.account.setPrimary",
					{ accountId: globex },
					t.world.owner,
				)
				expect(tagOf(primary)).toBe("Success")
				expect(t.liveLinks().every((row) => row.accountId === globex)).toBe(true)
				expect(t.projected().map((row) => row.accountName)).toEqual(["Globex", "Globex"])

				// A link left on an environment (stored before links were the customer's) shows
				// under its primary, and stays with the customer when the environment leaves.
				t.world.rows(
					`UPDATE customer_channel_links SET accountId = ? WHERE channelId = ?`,
					acme,
					after,
				)
				const rename = yield* t.world.call(
					"customers.account.update",
					{ accountId: globex, name: "Globex Corp" },
					t.world.owner,
				)
				expect(tagOf(rename)).toBe("Success")
				expect(t.projected().map((row) => [row.accountId, row.accountName])).toEqual([
					[globex, "Globex Corp"],
					[globex, "Globex Corp"],
				])
				const leave = yield* t.world.call(
					"customers.account.unlink",
					{ accountId: acme },
					t.world.owner,
				)
				expect(tagOf(leave)).toBe("Success")
				expect(t.liveLinks().every((row) => row.accountId === globex)).toBe(true)
			}),
		))

	it("refuses to unlink a channel the member cannot see", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const secret = t.channel("private", [t.world.owner])
				expect(tagOf(yield* t.link("Acme", secret, t.world.owner))).toBe("Success")
				expect(tagOf(yield* t.unlink(secret))).toBe("CustomersNotFoundError")
				expect(t.liveLinks()).toHaveLength(1)
				expect(tagOf(yield* t.unlink(secret, t.world.owner))).toBe("Success")
				expect(t.liveLinks()).toEqual([])
			}),
		))

	it("drops a deleted channel's link and its projection", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				const other = t.channel("public", [t.world.member])
				yield* t.link("Acme", general)
				yield* t.link("Acme", other)
				// What `channel.delete` does in the org, inside its transaction.
				yield* t.org
					.run(forgetChannelCustomer(t.world.orgId as OrganizationId, general as ChannelId))
					.pipe(Effect.orDie)
				yield* t.org.alarm.pipe(Effect.orDie)
				expect(t.liveLinks().map((row) => row.channelId)).toEqual([other])
				expect(t.projected().map((row) => row.channelId)).toEqual([other])
				const events = t.world.rows<{ type: string }>(
					`SELECT type FROM customer_events WHERE type = 'channel.deleted'`,
				)
				expect(events).toHaveLength(1)
				// A channel without a customer sends nothing.
				const before = t.world.objects.deliveries.length
				yield* t.org
					.run(forgetChannelCustomer(t.world.orgId as OrganizationId, general as ChannelId))
					.pipe(Effect.orDie)
				yield* t.org.alarm.pipe(Effect.orDie)
				expect(t.world.objects.deliveries.length).toBe(before)
			}),
		))

	it("projects the customer's logo, and a new one after the next compute", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				yield* t.link("Acme", general)
				const logo = () =>
					t.org.storage.db
						.prepare(`SELECT accountLogoUrl FROM channel_customers WHERE channelId = ?`)
						.get(general) as { accountLogoUrl: string | null }
				expect(logo()).toEqual({ accountLogoUrl: null })
				yield* t.world.ingest("clerk", [
					{
						_tag: "account",
						externalId: "org_acme",
						name: "Acme",
						logoUrl: "https://img.clerk.com/acme.png",
						sameAs: [],
						onNoMatch: "create",
					},
				])
				yield* t.world.object.run(runCompute(new Date())).pipe(Effect.orDie)
				yield* t.world.object.alarm.pipe(Effect.orDie)
				expect(logo()).toEqual({ accountLogoUrl: "https://img.clerk.com/acme.png" })
			}),
		))

	it("drops a deleted account's channels from the projection on the next compute", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				yield* t.link("Acme", general)
				yield* t.world.ingest("clerk", [
					{
						_tag: "account",
						externalId: "org_acme",
						name: "Acme",
						deleted: true,
						sameAs: [],
						onNoMatch: "create",
					},
				])
				yield* t.world.object.run(runCompute(new Date())).pipe(Effect.orDie)
				// The alarm delivers what the compute queued.
				yield* t.world.object.alarm.pipe(Effect.orDie)
				expect(t.projected()).toEqual([])
			}),
		))

	it("accepts a deleted channel only from the org's own org object", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				yield* t.link("Acme", general)
				for (const sender of [
					{ kind: "org", id: uuid() },
					{ kind: "channel", id: general },
				] as const) {
					const result = yield* t.world.object.applyEffect({
						objectId: t.world.orgId,
						kind: "customers.channelDeleted",
						payload: { organizationId: t.world.orgId, channelId: general },
						key: uuid(),
						sender,
					})
					expect(result._tag).toBe("Rejected")
				}
				expect(t.liveLinks()).toHaveLength(1)
			}),
		))

	it("projects the customer at a glance and resends only when it changes", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				yield* t.link("Acme", general)
				const acme = t.accountId("Acme")
				// The first compute (nothing to compute from): seeded values below stay.
				yield* t.publish
				// No health, no signals yet.
				expect(t.glance(general)).toMatchObject({
					healthStatus: "unknown",
					healthScore: null,
					healthWhy: null,
					openSignalCount: 0,
					topSignals: [],
				})

				t.world.rows(
					`UPDATE customer_accounts SET healthStatus = 'at_risk', healthScore = 48, lifecycleStage = 'active',
						planName = 'Pro', mrrMinor = 240000, currency = 'usd', ownerUserId = ?, seatsUsed = 18,
						seatsLimit = 25, lastActiveAt = '2026-11-17 09:30:00.000', logoUrl = 'https://acme.test/logo.png'
					 WHERE id = ?`,
					t.world.owner,
					acme,
				)
				const day = new Date().toISOString().slice(0, 10)
				t.world.rows(
					`INSERT OR REPLACE INTO customer_health_daily (accountId, day, score, status, breakdown) VALUES (?, ?, 48, 'at_risk', ?)`,
					acme,
					day,
					JSON.stringify({
						score: 48,
						status: "at_risk",
						components: [
							{
								key: "usage",
								score: 70,
								weight: 40,
								effectiveWeight: 40,
								excluded: false,
								why: "usage ok",
							},
							{
								key: "engagement",
								score: 25,
								weight: 30,
								effectiveWeight: 30,
								excluded: false,
								why: "No activity for 18 days",
							},
							{
								key: "billing",
								score: null,
								weight: 30,
								effectiveWeight: 0,
								excluded: true,
								why: "no billing",
							},
						],
					}),
				)
				const top = t.signal("Acme", "Payment failed", 9)
				t.signal("Acme", "Usage dropped", 5)
				t.signal("Acme", "Champion inactive", 3)
				t.signal("Acme", "Onboarding stalled", 1)
				t.signal("Acme", "Snoozed one", 20, "snoozed")
				t.world.rows(
					`UPDATE customer_external_refs SET externalUrl = 'https://dashboard.clerk.test/org_acme' WHERE accountId = ? AND entityType = 'account'`,
					acme,
				)
				yield* t.publish
				const row = t.glance(general)
				expect(row).toMatchObject({
					accountName: "Acme",
					accountLogoUrl: "https://acme.test/logo.png",
					healthStatus: "at_risk",
					healthScore: 48,
					healthWhy: "No activity for 18 days",
					lifecycleStage: "active",
					planName: "Pro",
					mrrMinor: 240000,
					currency: "usd",
					ownerUserId: t.world.owner,
					seatsUsed: 18,
					seatsLimit: 25,
					lastActiveDay: "2026-11-17",
					openSignalCount: 4,
					sourceLinks: [{ provider: "clerk", url: "https://dashboard.clerk.test/org_acme" }],
				})
				expect(row.topSignals.map((signal) => signal.title)).toEqual([
					"Payment failed",
					"Usage dropped",
					"Champion inactive",
				])
				expect(row.topSignals[0]?.id).toBe(top)

				// Nothing changed: nothing is sent.
				const before = t.world.objects.deliveries.length
				yield* t.publish
				expect(t.world.objects.deliveries.length).toBe(before)

				// A compute that moves MRR and health resends.
				t.world.rows(
					`UPDATE customer_accounts SET mrrMinor = 120000, healthStatus = 'critical', healthScore = 30 WHERE id = ?`,
					acme,
				)
				yield* t.publish
				expect(t.glance(general)).toMatchObject({
					mrrMinor: 120000,
					healthStatus: "critical",
					healthScore: 30,
				})

				// A person closing a signal updates the channel without waiting for a compute.
				const done = yield* t.world.call(
					"customers.signal.dismiss",
					{ signalId: top, reason: "noise" },
					t.world.member,
				)
				expect(tagOf(done)).toBe("Success")
				yield* t.world.object.alarm.pipe(Effect.orDie)
				expect(t.glance(general).openSignalCount).toBe(3)

				// So does a new owner.
				const owner = yield* t.world.call(
					"customers.account.update",
					{ accountId: acme, ownerUserId: t.world.member },
					t.world.owner,
				)
				expect(tagOf(owner)).toBe("Success")
				yield* t.world.object.alarm.pipe(Effect.orDie)
				expect(t.glance(general).ownerUserId).toBe(t.world.member)
			}),
		))

	it("rolls the customer's environments up as signals do: stage, plan, MRR, seats, activity", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const acme = t.accountId("Acme")
				const globex = t.accountId("Globex")
				const general = t.channel("public", [t.world.member])
				yield* t.link("Acme", general)
				const grouped = yield* t.world.call(
					"customers.account.link",
					{ accountId: globex, primaryAccountId: acme },
					t.world.owner,
				)
				expect(tagOf(grouped)).toBe("Success")
				yield* t.publish
				t.world.rows(
					`UPDATE customer_accounts SET mrrMinor = 10000, currency = 'usd', seatsUsed = 4, seatsLimit = NULL,
						lifecycleStage = 'lead', planName = NULL,
						lastActiveAt = '2026-11-01 00:00:00.000' WHERE id = ?`,
					acme,
				)
				t.world.rows(
					`UPDATE customer_accounts SET mrrMinor = 5000, currency = 'usd', seatsUsed = 6, seatsLimit = 10,
						lifecycleStage = 'active', planName = 'Scale',
						lastActiveAt = '2026-11-19 00:00:00.000' WHERE id = ?`,
					globex,
				)
				// Signals on an environment count for the customer.
				t.signal("Globex", "Env signal", 2)
				yield* t.publish
				expect(t.glance(general)).toMatchObject({
					accountId: acme,
					// The group's rules (`group-facts.ts`): the most advanced stage, a plan from any environment.
					lifecycleStage: "active",
					planName: "Scale",
					mrrMinor: 15000,
					seatsUsed: 10,
					seatsLimit: 10,
					lastActiveDay: "2026-11-19",
					openSignalCount: 1,
				})
			}),
		))

	it("applies a snapshot sent before the glance existed", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const general = t.channel("public", [t.world.member])
				const result = yield* t.org.applyEffect({
					objectId: t.world.orgId,
					kind: "org.setChannelCustomers",
					payload: {
						organizationId: t.world.orgId,
						links: [{ channelId: general, accountId: t.accountId("Acme"), accountName: "Acme" }],
						version: Date.now() * 2,
					},
					key: uuid(),
					sender: { kind: "customers", id: t.world.orgId },
				})
				expect(result._tag).not.toBe("Rejected")
				expect(t.glance(general)).toMatchObject({
					accountName: "Acme",
					healthStatus: "unknown",
					mrrMinor: null,
					openSignalCount: 0,
					topSignals: [],
					sourceLinks: [],
				})
			}),
		))

	it("accepts the projection only from the org's own customers object", () =>
		run(
			Effect.gen(function* () {
				const t = yield* setup
				const payload = { organizationId: t.world.orgId, links: [], version: Date.now() * 2 }
				for (const sender of [
					{ kind: "org", id: t.world.orgId },
					{ kind: "customers", id: uuid() },
				] as const) {
					const result = yield* t.org.applyEffect({
						objectId: t.world.orgId,
						kind: "org.setChannelCustomers",
						payload,
						key: uuid(),
						sender,
					})
					expect(result._tag).toBe("Rejected")
				}
			}),
		))
})
