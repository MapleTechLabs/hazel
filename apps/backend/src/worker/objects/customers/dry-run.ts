/**
 * Dry runs (`docs/customers/tech-design.md` §4.8): a draft rule or draft health settings evaluated
 * over the current data with the same pure functions compute uses, without writing. Admins only
 * (they read the accounts); accounts load in chunks, a rule's with only the activity its own
 * window needs. One RPC evaluates at most `MAX_CHUNKS` chunks, and none after `BUDGET_MS`: past
 * that the result is partial (`evaluatedAccounts` of `totalAccounts`, accounts in id order).
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
import { Clock, Effect } from "effect"
import { scoreAll } from "./compute"
import { evaluate, missingSources, type RuleInput } from "./evaluate"
import { priorityScore, valueOf } from "./lifecycle"
import { accountChunks, loadAccounts, loadBase, type SnapshotBase } from "./snapshot"

const MAX_CHUNKS = 8
const BUDGET_MS = 5_000

/** The chunks of accounts a dry run evaluates: the first always, then within the caps. */
const chunksWithinBudget = (base: SnapshotBase, budgetMs: number) =>
	Effect.gen(function* () {
		const started = yield* Clock.currentTimeMillis
		const chunks = accountChunks(base.accountIds).slice(0, MAX_CHUNKS)
		return {
			chunks,
			more: (done: number) =>
				Effect.map(
					Clock.currentTimeMillis,
					(time) => done < chunks.length && (done === 0 || time - started < budgetMs),
				),
		}
	})

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
	budgetMs = BUDGET_MS,
) {
	const db = yield* Database.Database
	const rule = ruleInputOf(draft)
	const base = yield* loadBase(now, { windowRules: [rule] })
	// Only the 10 highest priorities are shown: keep those, and count the rest.
	const top: Array<RuleMatch & { priority: number }> = []
	const matched = new Set<CustomerAccountId>()
	let mrrMinor = 0
	const reasons = new Map<string, number>()
	const evaluated = new Set<CustomerAccountId>()
	const { chunks, more } = yield* chunksWithinBudget(base, budgetMs)
	for (let done = 0; yield* more(done); done++) {
		const snapshot = yield* loadAccounts(base, chunks[done])
		for (const { facts } of snapshot.accounts) {
			evaluated.add(facts.account.id)
			const result = evaluate(rule, facts, snapshot.org)
			if (result._tag === "NoMatch") {
				reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1)
				continue
			}
			matched.add(facts.account.id)
			mrrMinor += facts.account.mrrMinor
			top.push({
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
			top.sort((a, b) => b.priority - a.priority)
			top.splice(10)
		}
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
			.filter(
				(signal) =>
					evaluated.has(signal.accountId) &&
					(signal.status === "open" || signal.status === "snoozed"),
			)
			.map((signal) => signal.accountId),
	)
	const unclosed = new Set(existing.map((signal) => signal.accountId))
	return {
		matchCount: matched.size,
		mrrMinor,
		currency: base.org.currency,
		topMatches: top.map(({ priority: _priority, ...match }) => match),
		nonMatches: [...reasons.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count),
		queueDelta: {
			opens: [...matched].filter((accountId) => !unclosed.has(accountId)).length,
			resolves: [...queued].filter((accountId) => !matched.has(accountId)).length,
			stays: [...queued].filter((accountId) => matched.has(accountId)).length,
		},
		missingSources: [...missingSources(rule.template, base.org)],
		evaluatedAccounts: evaluated.size,
		totalAccounts: base.accountIds.length,
	} satisfies RuleDryRunResult
})

type Account = { readonly id: CustomerAccountId; readonly name: string; readonly mrrMinor: number }

export const healthDryRun = Effect.fn("Customers.healthDryRun")(function* (
	draft: HealthSettings,
	now: Date,
	budgetMs = BUDGET_MS,
) {
	// Health reads 30 days of activity (the 35-day trend at most): the shortest window.
	const base = yield* loadBase(now, { windowRules: [] })
	const distribution = () =>
		new Map(HealthStatus.literals.map((status) => [status, { status, count: 0, mrrMinor: 0 }]))
	const current = distribution()
	const proposed = distribution()
	const transitions = new Map<string, number>()
	const changed: Array<{ account: Account; current: HealthBreakdown; proposed: HealthBreakdown }> = []
	let evaluatedAccounts = 0
	const { chunks, more } = yield* chunksWithinBudget(base, budgetMs)
	for (let done = 0; yield* more(done); done++) {
		const snapshot = yield* loadAccounts(base, chunks[done])
		evaluatedAccounts += snapshot.accounts.length
		const before = scoreAll(snapshot)
		const after = scoreAll(snapshot, draft)
		for (const { facts } of snapshot.accounts) {
			const account = {
				id: facts.account.id,
				name: facts.account.name,
				mrrMinor: facts.account.mrrMinor,
			}
			const was = before.get(account.id)
			const will = after.get(account.id)
			// `scoreAll` scores every account of the snapshot.
			if (was === undefined || will === undefined) continue
			for (const [into, breakdown] of [
				[current, was],
				[proposed, will],
			] as const) {
				const bucket = into.get(breakdown.status)
				if (bucket === undefined) continue
				bucket.count++
				bucket.mrrMinor += account.mrrMinor
			}
			if (was.status === will.status) continue
			const key = `${was.status}:${will.status}`
			transitions.set(key, (transitions.get(key) ?? 0) + 1)
			// The 5 largest by MRR are shown: keep only those.
			changed.push({ account, current: was, proposed: will })
			changed.sort((a, b) => b.account.mrrMinor - a.account.mrrMinor)
			changed.splice(5)
		}
	}
	const counts = (buckets: typeof current) =>
		[...buckets.values()].map(({ status, count, mrrMinor }) => ({ status, count, mrrMinor }))
	return {
		current: counts(current),
		proposed: counts(proposed),
		transitions: [...transitions.entries()].map(([key, count]) => {
			const [from, to] = key.split(":") as [HealthStatus, HealthStatus]
			return { from, to, count }
		}),
		samples: changed.map((sample) => ({
			accountId: sample.account.id,
			name: sample.account.name,
			current: sample.current,
			proposed: sample.proposed,
		})),
		evaluatedAccounts,
		totalAccounts: base.accountIds.length,
	} satisfies HealthDryRunResult
})
