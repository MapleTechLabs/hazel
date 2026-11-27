/**
 * Suggested channel links (`docs/customers/channels.md`), client side. Suggestions are not synced:
 * a surface reads them with `customers.channel.suggestions` when it opens and again after each
 * accept or dismiss, and hides the row it acted on at once (`hideSuggestion`). Accepting links the
 * channel; the link then shows through the synced links like any other.
 */
import { HazelRpc } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import {
	type ChannelId,
	type CustomerAccountId,
	CustomerChannelSuggestionId,
	type OrganizationId,
} from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { ChannelOption } from "./channels"

// ROWS

/** An open suggestion, as the server answers it (best first). */
export const SuggestionRow = Customers.ChannelSuggestion
export type SuggestionRow = Customers.ChannelSuggestion

/** A surface's suggestions: the last answer (null until the first), less the rows acted on since. */
export const SuggestionList = Schema.Struct({
	items: Schema.NullOr(Schema.Array(SuggestionRow)),
	/** Accepted or dismissed here and not yet failed: kept out of later answers too. */
	hidden: Schema.Array(CustomerChannelSuggestionId),
})
export type SuggestionList = typeof SuggestionList.Type

export const EMPTY_SUGGESTIONS: SuggestionList = { items: null, hidden: [] }

export const receivedSuggestions = (
	list: SuggestionList,
	items: ReadonlyArray<SuggestionRow>,
): SuggestionList => ({ ...list, items })

/** The row leaves at once, and stays out of answers that arrive while its write runs. */
export const hideSuggestion = (list: SuggestionList, id: CustomerChannelSuggestionId): SuggestionList =>
	list.hidden.includes(id) ? list : { ...list, hidden: [...list.hidden, id] }

/** A failed write: the row may come back with the next answer. */
export const unhideSuggestion = (list: SuggestionList, id: CustomerChannelSuggestionId): SuggestionList => ({
	...list,
	hidden: list.hidden.filter((other) => other !== id),
})

export interface ShownSuggestion {
	readonly suggestion: SuggestionRow
	readonly channel: ChannelOption
}

/**
 * The rows to show, best first: not hidden, and only for channels the org's channel collection
 * knows (a channel the user cannot see locally is left out; its name comes from there).
 */
export const shownSuggestions = (
	list: SuggestionList,
	channels: ReadonlyArray<ChannelOption>,
): ReadonlyArray<ShownSuggestion> => {
	const byId = new Map(channels.map((channel) => [channel.id, channel] as const))
	const hidden = new Set(list.hidden)
	return (list.items ?? []).flatMap((suggestion) => {
		const channel = byId.get(suggestion.channelId)
		return channel === undefined || hidden.has(suggestion.id) ? [] : [{ suggestion, channel }]
	})
}

/** Each reason as one sentence, strongest first. */
export const reasonLines = (
	suggestion: Pick<SuggestionRow, "reasons" | "accountName">,
): ReadonlyArray<string> =>
	suggestion.reasons.map((reason) => Customers.describeReason(reason, suggestion.accountName))

/** The strongest reason and the others, or null when the server sent none. */
export const reasonSummary = (
	suggestion: Pick<SuggestionRow, "reasons" | "accountName">,
): { readonly top: string; readonly others: ReadonlyArray<string> } | null => {
	const [top, ...others] = reasonLines(suggestion)
	return top === undefined ? null : { top, others }
}

// REQUESTS

export type SuggestionFilter =
	| { readonly accountId: CustomerAccountId }
	| { readonly channelId: ChannelId }
	| Record<string, never>

/**
 * The open suggestions: the org's, one account's, or one channel's (which re-scores it first). A
 * `channelId` the caller cannot see, or that is gone, has nothing to suggest.
 */
export const fetchSuggestions = (organizationId: OrganizationId, filter: SuggestionFilter) =>
	HazelRpc.use((rpc) => rpc("customers.channel.suggestions", { organizationId, ...filter })).pipe(
		Effect.map(({ items }): ReadonlyArray<SuggestionRow> => items),
		Effect.catchTag("CustomersNotFoundError", () => Effect.succeed<ReadonlyArray<SuggestionRow>>([])),
	)

// ACTIONS (shared by the overview, the customer page and the one-channel prompt)

export const SuggestionAction = Schema.Literals(["accept", "dismiss"])
export type SuggestionAction = typeof SuggestionAction.Type
