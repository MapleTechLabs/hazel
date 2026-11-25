/**
 * Support triage's effect (`./triage.ts`, `docs/customers/issues.md` § Triage): a model call the
 * `CustomersObject` makes from its own outbox (`ai` target), after the commit that opened the
 * issue. A leaf module: the issues enqueue it, the `ai` side receives it.
 */
import { CustomerIssueId, MessageId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineEffect, enqueueEffect } from "../effects/registry"

export const TriageIssuePayload = Schema.Struct({
	organizationId: OrganizationId,
	issueId: CustomerIssueId,
	/**
	 * A customer's reply in the thread of a conversation filed as chatter: is the conversation
	 * support now? Absent: the issue just opened, and its opening messages are judged.
	 */
	reply: Schema.optionalKey(
		Schema.Struct({
			messageId: MessageId,
			/** ISO timestamp text. */
			sentAt: Schema.String,
			text: Schema.String,
		}),
	),
})
export type TriageIssuePayload = typeof TriageIssuePayload.Type

export const TriageEffects = {
	triageIssue: defineEffect("ai.triageIssue", "ai", TriageIssuePayload),
}

/**
 * Wait before the alarm asks the model (the write's own drain skips it): the commit that opened
 * the issue is out first, and nothing waits on the answer.
 */
export const TRIAGE_DELAY_MS = 2_000

/** Enqueue `ai.triageIssue`, once per message; joins the caller's transaction. */
export const requestTriage = (payload: TriageIssuePayload, messageId: MessageId) =>
	enqueueEffect(TriageEffects.triageIssue, { kind: "ai" }, payload, {
		id: `triage:${messageId}`,
		delayMs: TRIAGE_DELAY_MS,
	})
