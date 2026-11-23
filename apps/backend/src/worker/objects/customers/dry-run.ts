/**
 * The rule dry run (`docs/customers/tech-design.md` §4.8): a draft rule evaluated over the current
 * data with the same pure functions compute uses, without writing. Admins only (they read the
 * accounts); accounts load in chunks, with only the activity the rule's window needs, and a group
 * of linked accounts evaluates over its combined facts. One RPC evaluates at most `MAX_CHUNKS`
 * chunks, and none after `BUDGET_MS`: past that the result is partial (`evaluatedAccounts` of
 * `totalAccounts`, groups in their primary's id order).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	ENVIRONMENT_TEMPLATES,
	type RuleDraft,
	type RuleDryRunResult,
	type RuleMatch,
} from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerSignalRuleId } from "@hazel/schema"
import { Clock, Effect } from "effect"
import { evaluate, missingSources, type RuleInput } from "./evaluate"
import { limitSignalTarget, priorityScore, valueOf } from "./lifecycle"
import { evaluatedFor, groupChunks, loadAccounts, loadBase, type SnapshotBase } from "./snapshot"

const MAX_CHUNKS = 8
const BUDGET_MS = 5_000

/** The chunks of accounts a dry run evaluates: the first always, then within the caps. */
const chunksWithinBudget = (base: SnapshotBase, budgetMs: number) =>
	Effect.gen(function* () {
		const started = yield* Clock.currentTimeMillis
		const chunks = groupChunks(base.groups)
			.slice(0, MAX_CHUNKS)
			.map((groups) => groups.flat())
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
		// A primary with environments over its group's facts, as compute evaluates it; its environments
		// are covered by it.
		const factsOf = evaluatedFor(snapshot.accounts)
		for (const account of snapshot.accounts) {
			const { stored } = account
			evaluated.add(stored.id)
			const facts = factsOf(rule.template, account)
			if (facts === null) continue
			const result = evaluate(rule, facts, snapshot.org)
			if (result._tag === "NoMatch") {
				reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1)
				continue
			}
			// An environment template's facts carry the customer's account: the row is this one.
			const own = ENVIRONMENT_TEMPLATES.includes(rule.template) ? account.facts.account : facts.account
			matched.add(own.id)
			mrrMinor += own.mrrMinor
			top.push({
				accountId: own.id,
				name: own.name,
				logoUrl: own.logoUrl,
				mrrMinor: own.mrrMinor,
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
	const stored =
		ruleId === undefined
			? []
			: yield* db.run(
					SQLite.from(schema.customerSignalsTable)
						.select("ruleId", "accountId", "status", "evidence")
						.where(($) => [$.ruleId.eq(ruleId), $.closedAt.isNull()]),
				)
	// Where compute would have them: a limit signal still on the primary moves to its environment.
	const held = new Set(stored.map((signal) => `${signal.ruleId}:${signal.accountId}`))
	const existing = stored.map((signal) => ({
		...signal,
		accountId: limitSignalTarget(signal, evaluated, held) ?? signal.accountId,
	}))
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
