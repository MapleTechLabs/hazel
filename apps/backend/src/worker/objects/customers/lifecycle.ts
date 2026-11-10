/**
 * A signal's lifecycle (`docs/customers/tech-design.md` §4.5–§4.7), pure: what one evaluation does
 * to the `(rule, account)` episode, and its priority.
 *
 * - open: refreshed while true; auto-resolved (closed) once false.
 * - snoozed: wakes at `snoozedUntil`, or early when its evidence got a full step worse than when
 *   it was snoozed; auto-resolved once false.
 * - done: reopens if still true at `reopenAfter` (7 days after); closed once false.
 * - dismissed: reopens only a full step worse than when dismissed; closed once false.
 * - Baseline mode (first evaluation after a backfill): a new match is recorded dismissed
 *   (`baseline`), silently; a dismissed one that got worse stays dismissed at its new evidence.
 */
import type { schema } from "@hazel/db"
import { type SignalEvidence, SignalSeverity } from "@hazel/domain/customers"
import type { Match } from "./evaluate"
import { DAY_MS } from "./time"

export const REOPEN_COOLDOWN_MS = 7 * DAY_MS

const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 4 } as const

/**
 * Queue order: severity × value × freshness. `valueMinor` is the account's MRR, else its trial's
 * list price, else 0 (weight 1: severity and freshness decide). Freshness moves in whole days, so
 * an unchanged signal is not rewritten by every hourly compute.
 */
export const priorityScore = (severity: SignalSeverity, valueMinor: number, openedAt: Date, now: Date) => {
	const valueWeight = 1 + Math.log10(1 + Math.max(0, valueMinor) / 100)
	const ageDays = Math.max(0, Math.floor((now.getTime() - openedAt.getTime()) / DAY_MS))
	const freshness = Math.max(0.5, 1 - ageDays / 28)
	return Math.round(SEVERITY_WEIGHT[severity] * valueWeight * freshness * 1000) / 1000
}

export const valueOf = (account: Pick<schema.CustomerAccount, "mrrMinor" | "trialListMrrMinor">) =>
	account.mrrMinor > 0 ? account.mrrMinor : (account.trialListMrrMinor ?? 0)

/** "Worse by a full step" than the evidence a human acted on. */
export const isWorse = (evidence: SignalEvidence, acted: SignalEvidence | null) =>
	evidence.step > (acted?.step ?? 0)

export interface LifecycleEvent {
	readonly type: "signal.opened" | "signal.resolved" | "signal.woke" | "signal.reopened"
	readonly data?: Record<string, unknown>
}

type SignalPatch = Partial<
	Pick<
		schema.CustomerSignal,
		| "status"
		| "severity"
		| "title"
		| "reason"
		| "evidence"
		| "actionEvidence"
		| "priorityScore"
		| "lastEvaluatedAt"
		| "openedAt"
		| "snoozedUntil"
		| "resolvedAt"
		| "resolvedByUserId"
		| "outcome"
		| "resolutionNote"
		| "reopenAfter"
		| "reopenCount"
		| "dismissReason"
		| "closedAt"
	>
>

export type Transition =
	| { readonly _tag: "Keep" }
	| {
			readonly _tag: "Insert"
			readonly status: "open" | "dismissed"
			readonly priorityScore: number
			readonly event: LifecycleEvent | null
	  }
	| { readonly _tag: "Update"; readonly patch: SignalPatch; readonly event: LifecycleEvent | null }

export interface TransitionInput {
	readonly now: Date
	/** Baseline mode for this rule's template. */
	readonly baseline: boolean
	/** `valueOf(account)`. */
	readonly valueMinor: number
}

const KEEP: Transition = { _tag: "Keep" }

/** The live fields of a still-true signal that changed. */
const refresh = (
	signal: schema.CustomerSignal,
	match: Match,
	input: TransitionInput,
	openedAt: Date,
): SignalPatch => {
	const next: SignalPatch = {
		severity: match.severity,
		title: match.title,
		reason: match.reason,
		evidence: match.evidence,
		priorityScore: priorityScore(match.severity, input.valueMinor, openedAt, input.now),
	}
	const changed = Object.fromEntries(
		Object.entries(next).filter(
			([field, value]) =>
				JSON.stringify((signal as Record<string, unknown>)[field]) !== JSON.stringify(value),
		),
	) as SignalPatch
	return Object.keys(changed).length === 0 ? {} : { ...changed, lastEvaluatedAt: input.now }
}

const updated = (patch: SignalPatch, event: LifecycleEvent | null = null): Transition =>
	Object.keys(patch).length === 0 && event === null ? KEEP : { _tag: "Update", patch, event }

const reopened = (signal: schema.CustomerSignal, match: Match, input: TransitionInput): Transition =>
	updated(
		{
			...refresh(signal, match, input, input.now),
			status: "open",
			openedAt: input.now,
			lastEvaluatedAt: input.now,
			priorityScore: priorityScore(match.severity, input.valueMinor, input.now, input.now),
			reopenCount: signal.reopenCount + 1,
			resolvedAt: null,
			resolvedByUserId: null,
			outcome: null,
			resolutionNote: null,
			reopenAfter: null,
			dismissReason: null,
			snoozedUntil: null,
		},
		{ type: "signal.reopened", data: { from: signal.status } },
	)

/** What one evaluation does to the unclosed episode (or its absence). */
export const transition = (
	signal: schema.CustomerSignal | null,
	match: Match | null,
	input: TransitionInput,
): Transition => {
	if (signal === null) {
		if (match === null) return KEEP
		return {
			_tag: "Insert",
			status: input.baseline ? "dismissed" : "open",
			priorityScore: priorityScore(match.severity, input.valueMinor, input.now, input.now),
			event: input.baseline ? null : { type: "signal.opened" },
		}
	}
	const { now } = input
	switch (signal.status) {
		case "open":
			return match === null
				? updated(
						{ status: "auto_resolved", resolvedAt: now, closedAt: now, lastEvaluatedAt: now },
						{ type: "signal.resolved" },
					)
				: updated(refresh(signal, match, input, signal.openedAt))
		case "snoozed": {
			if (match === null) {
				return updated(
					{ status: "auto_resolved", resolvedAt: now, closedAt: now, lastEvaluatedAt: now },
					{ type: "signal.resolved" },
				)
			}
			const due = signal.snoozedUntil !== null && signal.snoozedUntil.getTime() <= now.getTime()
			const worse = isWorse(match.evidence, signal.actionEvidence)
			if (!due && !worse) return updated(refresh(signal, match, input, signal.openedAt))
			return updated(
				{
					...refresh(signal, match, input, signal.openedAt),
					status: "open",
					snoozedUntil: null,
					lastEvaluatedAt: now,
				},
				{ type: "signal.woke", data: { early: !due } },
			)
		}
		case "done": {
			if (match === null) return updated({ closedAt: now, lastEvaluatedAt: now })
			const due = signal.reopenAfter !== null && signal.reopenAfter.getTime() <= now.getTime()
			return due
				? reopened(signal, match, input)
				: updated(refresh(signal, match, input, signal.openedAt))
		}
		case "dismissed": {
			if (match === null) return updated({ closedAt: now, lastEvaluatedAt: now })
			if (!isWorse(match.evidence, signal.actionEvidence))
				return updated(refresh(signal, match, input, signal.openedAt))
			// Worse in baseline mode is old data arriving, not news: the dismissal now covers it.
			return input.baseline
				? updated({
						...refresh(signal, match, input, signal.openedAt),
						actionEvidence: match.evidence,
						lastEvaluatedAt: now,
					})
				: reopened(signal, match, input)
		}
		case "auto_resolved":
			return KEEP
	}
}

/** A snooze that is due wakes without evaluating (the alarm between computes). */
export const wakeDue = (signal: schema.CustomerSignal, now: Date) =>
	signal.status === "snoozed" &&
	signal.snoozedUntil !== null &&
	signal.snoozedUntil.getTime() <= now.getTime()
