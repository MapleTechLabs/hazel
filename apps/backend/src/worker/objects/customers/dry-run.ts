/**
 * Dry runs (`docs/customers/tech-design.md` §4.8): a draft rule or draft health settings evaluated
 * over the current data with the same pure functions compute uses, without writing.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type HealthBreakdown,
	type HealthDryRunResult,
	type HealthSettings,
	HealthStatus,
	type RuleDraft,
	type RuleDryRunResult,
	type RuleMatch,
} from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerSignalRuleId } from "@hazel/schema"
import { Effect } from "effect"
import { scoreAll } from "./compute"
import { evaluate, missingSources, type RuleInput } from "./evaluate"
import { priorityScore, valueOf } from "./lifecycle"
import { loadSnapshot } from "./snapshot"

export const ruleInputOf = (draft: RuleDraft): RuleInput => ({
	name: draft.name,
	template: draft.config._tag,
	severity: draft.severity,
	config: draft.config,
	scope: draft.scope,
})

export const ruleDryRun = Effect.fn("Customers.ruleDryRun")(function* (
	draft: RuleDraft,
	ruleId: CustomerSignalRuleId | undefined,
	now: Date,
) {
	const db = yield* Database.Database
	const rule = ruleInputOf(draft)
	const snapshot = yield* loadSnapshot(now, { extraRules: [rule] })
	const matches: Array<RuleMatch & { priority: number }> = []
	const reasons = new Map<string, number>()
	for (const { facts } of snapshot.accounts) {
		const result = evaluate(rule, facts, snapshot.org)
		if (result._tag === "NoMatch") {
			reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1)
			continue
		}
		matches.push({
			accountId: facts.account.id,
			name: facts.account.name,
			logoUrl: facts.account.logoUrl,
			mrrMinor: facts.account.mrrMinor,
			severity: result.severity,
			title: result.title,
			reason: result.reason,
			evidence: result.evidence,
			priority: priorityScore(result.severity, valueOf(facts.account), now, now),
		})
	}
	const existing =
		ruleId === undefined
			? []
			: yield* db.run(
					SQLite.from(schema.customerSignalsTable)
						.select("accountId", "status")
						.where(($) => [$.ruleId.eq(ruleId), $.closedAt.isNull()]),
				)
	const queued = new Set(
		existing
			.filter((signal) => signal.status === "open" || signal.status === "snoozed")
			.map((signal) => signal.accountId),
	)
	const unclosed = new Set(existing.map((signal) => signal.accountId))
	const matched = new Set<CustomerAccountId>(matches.map((match) => match.accountId))
	return {
		matchCount: matches.length,
		mrrMinor: matches.reduce((sum, match) => sum + match.mrrMinor, 0),
		currency: snapshot.org.currency,
		topMatches: matches
			.sort((a, b) => b.priority - a.priority)
			.slice(0, 10)
			.map(({ priority: _priority, ...match }) => match),
		nonMatches: [...reasons.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count),
		queueDelta: {
			opens: [...matched].filter((accountId) => !unclosed.has(accountId)).length,
			resolves: [...queued].filter((accountId) => !matched.has(accountId)).length,
			stays: [...queued].filter((accountId) => matched.has(accountId)).length,
		},
		missingSources: [...missingSources(rule.template, snapshot.org)],
	} satisfies RuleDryRunResult
})

const distribution = (
	accounts: ReadonlyArray<{ readonly id: CustomerAccountId; readonly mrrMinor: number }>,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
) =>
	HealthStatus.literals.map((status) => {
		const rows = accounts.filter((account) => scores.get(account.id)?.status === status)
		return { status, count: rows.length, mrrMinor: rows.reduce((sum, row) => sum + row.mrrMinor, 0) }
	})

export const healthDryRun = Effect.fn("Customers.healthDryRun")(function* (draft: HealthSettings, now: Date) {
	const snapshot = yield* loadSnapshot(now)
	const current = scoreAll(snapshot)
	const proposed = scoreAll(snapshot, draft)
	const accounts = snapshot.accounts.map(({ facts }) => ({
		id: facts.account.id,
		name: facts.account.name,
		mrrMinor: facts.account.mrrMinor,
	}))
	const transitions = new Map<string, number>()
	const changed: Array<(typeof accounts)[number]> = []
	for (const account of accounts) {
		const from = current.get(account.id)!.status
		const to = proposed.get(account.id)!.status
		if (from === to) continue
		transitions.set(`${from}:${to}`, (transitions.get(`${from}:${to}`) ?? 0) + 1)
		changed.push(account)
	}
	return {
		current: distribution(accounts, current),
		proposed: distribution(accounts, proposed),
		transitions: [...transitions.entries()].map(([key, count]) => {
			const [from, to] = key.split(":") as [HealthStatus, HealthStatus]
			return { from, to, count }
		}),
		samples: changed
			.sort((a, b) => b.mrrMinor - a.mrrMinor)
			.slice(0, 5)
			.map((account) => ({
				accountId: account.id,
				name: account.name,
				current: current.get(account.id)!,
				proposed: proposed.get(account.id)!,
			})),
	} satisfies HealthDryRunResult
})
