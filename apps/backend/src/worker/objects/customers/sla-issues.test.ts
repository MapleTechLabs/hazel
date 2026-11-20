/**
 * SLA clocks on support issues in a `CustomersObject` (`docs/customers/sla.md` §4): the hook on issue
 * writes, the alarm turn's warnings and breaches, notifications to the owner's `UserObject`, stale
 * alerts recorded silently, and deleted issues dropped.
 *
 * Times are relative to the real clock (the hook reads it); the alarm turn is called with chosen
 * instants.
 */
import type { schema } from "@hazel/db"
import { DEFAULT_SLA_POLICY, type SlaState } from "@hazel/domain/customers"
import type { ChannelId, CustomerAccountId, MessageId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { userTarget } from "../kinds"
import { insertIssueRow, updateIssueRow } from "./issues"
import { runSlaAlerts } from "./sla"
import { makeCustomersWorld, ok, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const MIN = 60_000
/** A stored instant (`YYYY-MM-DD HH:MM:SS.sss`, UTC) in epoch ms. */
const stored = (text: string) => new Date(`${text.replace(" ", "T")}Z`).getTime()

interface SlaRowOut {
	id: string
	policyName: string
	state: string
	nextAlertAt: string | null
}

const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", [
		{ _tag: "account", externalId: "org_acme", name: "Acme", sameAs: [], onNoMatch: "create" },
	])
	const accountId = world.rows<{ id: CustomerAccountId }>(`SELECT id FROM customer_accounts`)[0]!.id
	const memberId = uuid() as OrganizationMemberId
	const db = world.object.storage.db
	db.prepare(`UPDATE customer_accounts SET ownerUserId = ?`).run(world.member)
	db.prepare(`UPDATE customer_members SET memberId = ? WHERE userId = ?`).run(memberId, world.member)
	// 24/7, so the deadlines do not depend on when the test runs.
	const [standard] = world.rows<{ id: string }>(`SELECT id FROM customer_sla_policies`)
	ok(
		yield* world.call(
			"customers.slaPolicy.update",
			{ policyId: standard!.id, policy: { ...DEFAULT_SLA_POLICY, hours: "always" } },
			world.owner,
		),
	)
	const now = Date.now()
	const open = (minutesAgo: number, priority: schema.CustomerIssue["priority"] = "urgent") => {
		const openedAt = new Date(now - minutesAgo * MIN)
		return world.object.run(
			insertIssueRow({
				organizationId: world.orgId,
				accountId,
				sourceChannelId: uuid() as ChannelId,
				rootMessageId: uuid() as MessageId,
				threadChannelId: null,
				openedByUserId: uuid() as UserId,
				createdByUserId: null,
				title: "Dashboard is broken",
				status: "new",
				priority,
				openedAt,
				firstCustomerMessageAt: openedAt,
				lastCustomerMessageAt: openedAt,
				lastMessageAt: openedAt,
				messageCount: 1,
			}),
		)
	}
	const sla = (id: string) => {
		const row = world.rows<SlaRowOut>(`SELECT * FROM customer_issue_slas WHERE id = ?`, id)[0]
		return row === undefined ? undefined : { ...row, state: JSON.parse(row.state) as SlaState }
	}
	const notifications = Effect.gen(function* () {
		const user = yield* world.objects.get(userTarget(world.member))
		return user.storage.db
			.prepare(
				`SELECT memberId, resourceId, resourceType, reason FROM notifications ORDER BY createdAt`,
			)
			.all() as Array<{ memberId: string; resourceId: string; resourceType: string; reason: string }>
	})
	return { world, now, open, sla, notifications, memberId }
})

describe("SLA clocks on issues", () => {
	it("starts a reply clock under the account's policy, warns, breaches, and stops on the reply", () =>
		run(
			Effect.gen(function* () {
				const { world, now, open, sla, notifications, memberId } = yield* setup
				const issue = yield* open(10)
				const opened = sla(issue.id)!
				// Urgent: 1h reply → warn at 45m, due at 60m (24/7).
				expect(opened.policyName).toBe("Standard")
				expect(opened.state.reply?.dueAt).toBe(issue.openedAt.getTime() + 60 * MIN)
				expect(opened.nextAlertAt).not.toBeNull()
				expect(stored(opened.nextAlertAt!)).toBe(issue.openedAt.getTime() + 45 * MIN)

				const warned = yield* world.object.run(runSlaAlerts(new Date(now + 36 * MIN)))
				expect(warned).toEqual({ handled: 1, notified: 1 })
				yield* world.object.afterCommit
				const breached = yield* world.object.run(runSlaAlerts(new Date(now + 51 * MIN)))
				expect(breached).toEqual({ handled: 1, notified: 1 })
				// As the alarm does: deliver the outbox after the turn.
				yield* world.object.afterCommit
				// Nothing more is due on the reply clock.
				expect(yield* world.object.run(runSlaAlerts(new Date(now + 52 * MIN)))).toEqual({
					handled: 0,
					notified: 0,
				})
				expect(yield* notifications).toEqual([
					{ memberId, resourceId: issue.id, resourceType: "customer_issue", reason: "sla_warning" },
					{ memberId, resourceId: issue.id, resourceType: "customer_issue", reason: "sla_breach" },
				])

				const repliedAt = new Date(now + 55 * MIN)
				yield* world.object.run(
					updateIssueRow(issue, {
						firstTeamReplyAt: repliedAt,
						lastTeamReplyAt: repliedAt,
						lastMessageAt: repliedAt,
						status: "waiting_on_customer",
					}),
				)
				const replied = sla(issue.id)!
				expect(replied.state.firstResponse?.metAt).toBe(repliedAt.getTime())
				expect(replied.state.resolution.runningSince).toBeNull()
				expect(replied.nextAlertAt).toBeNull()
			}),
		))

	it("records alerts that were already long past without notifying", () =>
		run(
			Effect.gen(function* () {
				const { world, now, open, sla, notifications } = yield* setup
				// Opened 5h ago (urgent: reply due 4h ago, resolution 8h: due in 3h).
				const issue = yield* open(5 * 60)
				const row = sla(issue.id)!
				expect(row.state.reply?.breachedAt).not.toBeNull()
				expect(stored(row.nextAlertAt!)).toBe(issue.openedAt.getTime() + 6 * 60 * MIN)
				expect(yield* world.object.run(runSlaAlerts(new Date(now)))).toEqual({
					handled: 0,
					notified: 0,
				})
				expect(yield* notifications).toEqual([])
			}),
		))

	it("keeps targets per priority, and drops the clocks of a deleted issue", () =>
		run(
			Effect.gen(function* () {
				const { world, open, sla } = yield* setup
				const issue = yield* open(0, "none")
				// No priority: medium's 4h.
				expect(sla(issue.id)!.state.reply?.dueAt).toBe(issue.openedAt.getTime() + 4 * 60 * MIN)
				yield* world.object.run(updateIssueRow(issue, { priority: "urgent" }))
				expect(sla(issue.id)!.state.reply?.dueAt).toBe(issue.openedAt.getTime() + 60 * MIN)
				yield* world.object.run(updateIssueRow(issue, { deletedAt: new Date() }))
				expect(sla(issue.id)).toBeUndefined()
			}),
		))

	it("reports first response and overdue issues to members", () =>
		run(
			Effect.gen(function* () {
				const { world, now, open } = yield* setup
				const answered = yield* open(60, "medium")
				const repliedAt = new Date(now - 30 * MIN)
				yield* world.object.run(
					updateIssueRow(answered, { firstTeamReplyAt: repliedAt, lastTeamReplyAt: repliedAt }),
				)
				yield* open(5 * 60)
				const report = ok(
					yield* world.call("customers.support.report", { range: "7d" }, world.member),
				)
				expect(report.issues).toBe(2)
				expect(report.firstResponse).toMatchObject({ count: 1, medianMs: 30 * MIN, withinPct: 1 })
				expect(report.overdueNow).toBe(1)
				expect(report.byAccount).toMatchObject([{ label: "Acme", issues: 2, breaches: 1 }])
			}),
		))
})
