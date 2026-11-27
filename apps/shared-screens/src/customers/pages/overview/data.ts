// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The overview's data (`docs/customers/spec.md` §1): its RPCs as queries, the suggested channel
 * links' accept and dismiss, and the selections over the live rows (today's `overview/model.ts`).
 */
import { Command, Query, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import { CustomerChannelSuggestionId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { CommonReason, reasonOf } from "../../../modals/feedback"
import { customerAccountOf } from "../../data/groups"
import { type AccountRow, isAttentionMuted, type SignalRow } from "../../data/queries"
import { fetchSuggestions, SuggestionAction, SuggestionRow } from "../../data/suggestions"

/** KPIs, movements, active users, movers, new and churned for one range. */
export class GetOverview extends Query.Service<GetOverview>()("hazel/customers/GetOverview", {
	args: { organizationId: OrganizationId, range: Customers.CustomersRange, attempt: Schema.Finite },
	success: Customers.OverviewResult,
	error: CommonReason,
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, range }) =>
				rpc("customers.overview", { organizationId, range }).pipe(
					Effect.tapError((error) => Effect.logWarning("customers overview failed", error)),
					Effect.mapError(reasonOf),
				)
		}),
	)
}

/** The org's open suggested channel links; `revision` asks again after each accept or dismiss. */
export class GetSuggestions extends Query.Service<GetSuggestions>()("hazel/customers/GetSuggestions", {
	args: { organizationId: OrganizationId, revision: Schema.Finite },
	success: Schema.Array(SuggestionRow),
	error: CommonReason,
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId }) =>
				fetchSuggestions(organizationId, {}).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.mapError(reasonOf),
				)
		}),
	)
}

/** A refused accept or dismiss: the suggestion or channel is gone, or the channel can't be linked. */
export const SuggestionFailure = Schema.Literals([
	"NotFound",
	"Invalid",
	"Offline",
	"Timeout",
	"SignedOut",
	"RateLimited",
	"Unavailable",
	"Unexpected",
])
export type SuggestionFailure = typeof SuggestionFailure.Type

/** What an accept or dismiss answers. */
export const SuggestionOutcome = UiSchema.TaggedEnum({
	Succeeded: { action: SuggestionAction, suggestion: SuggestionRow },
	Failed: { action: SuggestionAction, suggestion: SuggestionRow, reason: SuggestionFailure },
})
export type SuggestionOutcome = typeof SuggestionOutcome.Type

/** Links the suggested channel to its account; the link then syncs to every surface. */
export class AcceptSuggestion extends Command.Service<AcceptSuggestion>()(
	"hazel/customers/AcceptSuggestion",
	{
		args: { organizationId: OrganizationId, suggestion: SuggestionRow },
		success: SuggestionOutcome,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, suggestion }) => {
				const failed = (reason: SuggestionFailure) =>
					Effect.succeed(SuggestionOutcome.Failed({ action: "accept", suggestion, reason }))
				return rpc("customers.channel.suggestion.accept", {
					organizationId,
					suggestionId: suggestion.id,
				}).pipe(
					Effect.as(SuggestionOutcome.Succeeded({ action: "accept", suggestion })),
					Effect.catchTags({
						CustomersNotFoundError: () => failed("NotFound"),
						CustomersInvalidRequestError: () => failed("Invalid"),
					}),
					Effect.catch((error) => failed(reasonOf(error))),
				)
			}
		}),
	)
}

/** That account is never suggested for that channel again; one already gone counts as dismissed. */
export class DismissSuggestion extends Command.Service<DismissSuggestion>()(
	"hazel/customers/DismissSuggestion",
	{ args: { organizationId: OrganizationId, suggestion: SuggestionRow }, success: SuggestionOutcome },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, suggestion }) => {
				const succeeded = SuggestionOutcome.Succeeded({ action: "dismiss", suggestion })
				return rpc("customers.channel.suggestion.dismiss", {
					organizationId,
					suggestionId: suggestion.id,
				}).pipe(
					Effect.as(succeeded),
					Effect.catchTag("CustomersNotFoundError", () => Effect.succeed(succeeded)),
					Effect.catch((error) =>
						Effect.succeed(
							SuggestionOutcome.Failed({
								action: "dismiss",
								suggestion,
								reason: reasonOf(error),
							}),
						),
					),
				)
			}
		}),
	)
}

/** The toast copy for a failed accept or dismiss. */
export const suggestionFailureCopy = (
	action: SuggestionAction,
	reason: SuggestionFailure,
): Readonly<{ title: string; description: string | null }> => {
	if (reason === "NotFound")
		return {
			title: action === "accept" ? "Couldn't link the channel" : "Couldn't dismiss the suggestion",
			description: "The suggestion or channel is no longer available.",
		}
	if (reason === "Invalid")
		return {
			title: "Couldn't link the channel",
			description: "Threads and direct messages can't be linked to a customer.",
		}
	return COMMON_TOAST[reason]
}

const COMMON_TOAST = {
	Offline: { title: "Connection lost", description: "Check your internet connection and try again." },
	Timeout: {
		title: "Request timed out",
		description: "The server is taking too long to respond. Please try again.",
	},
	SignedOut: { title: "Your session has expired", description: "Please sign in again to continue." },
	RateLimited: { title: "Rate limit exceeded", description: "Please wait before trying again." },
	Unavailable: { title: "Service temporarily unavailable", description: "Please try again in a moment." },
	Unexpected: { title: "Something went wrong", description: "Please try again." },
} satisfies Record<CommonReason, Readonly<{ title: string; description: string }>>

// SELECTIONS

/** How many suggestions the card lists; accepting or dismissing one brings up the next. */
export const SUGGESTIONS_SHOWN = 5

/** The queue's top rows on the page. */
export const ATTENTION_SHOWN = 6

const RANGE_DAYS = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"12m": 365,
} as const satisfies Record<Customers.CustomersRange, number>

const DAY_MS = 86_400_000

/** The previous period of the same length, ending where the range starts. */
export const previousPeriodOf = (
	range: Customers.CustomersRange,
	nowMs: number,
): Readonly<{ startMs: number; endMs: number }> => {
	const length = RANGE_DAYS[range] * DAY_MS
	return { startMs: nowMs - 2 * length, endMs: nowMs - length }
}

/** Open signals as the queue shows them (not on muted customers), highest priority first. */
export const openSignals = (
	signals: ReadonlyArray<SignalRow> | null,
	accounts: ReadonlyArray<AccountRow> | null,
): ReadonlyArray<SignalRow> => {
	const accountsById = new Map((accounts ?? []).map((account) => [account.id, account]))
	const muted = new Set(
		(accounts ?? [])
			.filter(
				(account) =>
					isAttentionMuted(account) || isAttentionMuted(customerAccountOf(account, accountsById)),
			)
			.map((account) => account.id),
	)
	return (signals ?? []).filter((signal) => signal.status === "open" && !muted.has(signal.accountId))
}

/** Accounts first seen in the range (no billing to say who started paying). */
export const newAccounts = (
	accounts: ReadonlyArray<AccountRow>,
	range: Customers.CustomersRange,
	nowMs: number,
	count: number,
): ReadonlyArray<AccountRow> =>
	accounts
		.filter((account) => account.firstSeenAtMs >= nowMs - RANGE_DAYS[range] * DAY_MS)
		.toSorted((left, right) => right.firstSeenAtMs - left.firstSeenAtMs)
		.slice(0, count)

/** Accounts that were active and have gone quiet for two weeks (the churn stand-in without billing). */
export const QUIET_AFTER_DAYS = 14
export const quietAccounts = (
	accounts: ReadonlyArray<AccountRow>,
	nowMs: number,
	count: number,
): ReadonlyArray<AccountRow> =>
	accounts
		.filter(
			(account) =>
				account.lastActiveAtMs !== null &&
				account.lastActiveAtMs <= nowMs - QUIET_AFTER_DAYS * DAY_MS &&
				account.lifecycleStage !== "churned",
		)
		.toSorted((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0))
		.slice(0, count)

/** A trial's subscription that went on to bill (anything but still trialing, paused or canceled). */
export const isConverted = (status: Customers.SubscriptionStatus) =>
	status === "active" || status === "past_due" || status === "unpaid"

export const SuggestionIds = Schema.Array(CustomerChannelSuggestionId)
