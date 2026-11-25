/**
 * Support triage (`docs/customers/issues.md` § Triage): what a decision model's answers about a
 * new conversation make of it. Pure, so the object, its tests and a calibration run read the same
 * rules.
 *
 * The model answers yes/no questions with a probability (0 to 1). Two say whether the message is
 * support (`support`) or chatter (`chatter`); one per recent conversation of the channel says
 * whether the message continues it.
 */
import type { CustomerIssueId } from "@hazel/schema"
import { Schema } from "effect"
import type { IssueTriage } from "./enums"

/** The org's triage settings (`customer_settings.supportTriage`). */
export const SupportTriageSettings = Schema.Struct({
	/** Off: every customer message opens an issue, as before. */
	enabled: Schema.Boolean,
	/** What the team supports, in its own words: the model judges "about our product" against it. */
	about: Schema.String.check(Schema.isMaxLength(2_000)),
})
export type SupportTriageSettings = typeof SupportTriageSettings.Type

export const DEFAULT_SUPPORT_TRIAGE: SupportTriageSettings = { enabled: true, about: "" }

/** A probability at or above this is a yes. */
export const TRIAGE_YES = 0.7
/** A probability at or below this is a no. */
export const TRIAGE_NO = 0.3

/** The model's answers; a question it refused or did not answer is `null`. */
export interface TriageAnswers {
	/** P(the message needs the team's support). */
	readonly support: number | null
	/** P(the message is small talk, or not about the team's product). */
	readonly chatter: number | null
	/** P(the message continues that conversation), per recent conversation of the channel. */
	readonly continues: ReadonlyArray<{
		readonly issueId: CustomerIssueId
		readonly triage: IssueTriage | null
		readonly probability: number | null
	}>
}

export type TriageDecision =
	/** Not answered: the issue stays as it is, in the inbox. */
	| { readonly _tag: "Undecided" }
	| { readonly _tag: "Support"; readonly score: number }
	| { readonly _tag: "Chatter"; readonly score: number }
	/**
	 * The message belongs to an existing conversation: its issue is folded into that one.
	 * `chatter` is what it is on its own, should that conversation be gone by then.
	 */
	| {
			readonly _tag: "Merge"
			readonly into: CustomerIssueId
			readonly score: number
			readonly chatter: boolean
	  }

/**
 * Chatter only when both questions agree (a clear no on `support`, a clear yes on `chatter`):
 * filtering a real request costs more than leaving small talk in the inbox, so anything unclear
 * stays support.
 */
export const isChatter = (answers: Pick<TriageAnswers, "support" | "chatter">): boolean =>
	answers.support !== null &&
	answers.chatter !== null &&
	answers.support <= TRIAGE_NO &&
	answers.chatter >= TRIAGE_YES

/**
 * What the answers decide. A message that continues a conversation joins it; a support request
 * never joins a filtered one (it would be hidden with it), so it opens its own issue.
 */
export const decideTriage = (answers: TriageAnswers): TriageDecision => {
	if (answers.support === null || answers.chatter === null) return { _tag: "Undecided" }
	const chatter = isChatter(answers)
	let best: { readonly issueId: CustomerIssueId; readonly probability: number } | undefined
	for (const candidate of answers.continues) {
		if (candidate.probability === null || candidate.probability < TRIAGE_YES) continue
		if (!chatter && candidate.triage === "chatter") continue
		if (best === undefined || candidate.probability > best.probability) {
			best = { issueId: candidate.issueId, probability: candidate.probability }
		}
	}
	if (best !== undefined) {
		return { _tag: "Merge", into: best.issueId, score: answers.support, chatter }
	}
	return chatter ? { _tag: "Chatter", score: answers.support } : { _tag: "Support", score: answers.support }
}
