/**
 * Suggested channel links (`docs/customers/channels.md`), client side. Suggestions are not synced:
 * a surface reads them with `customers.channel.suggestions` when it opens and again after each
 * accept or dismiss, and hides the row it acted on at once (`hideSuggestion`). Accepting links the
 * channel; the link then shows through the synced links like any other.
 */
import * as Customers from "@hazel/domain/customers"
import {
	type ChannelId,
	type CustomerAccountId,
	CustomerChannelSuggestionId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf } from "../data/actions"
import { IconClose } from "../icons"
import type { ToastRequest } from "../overlay/toasts"
import { HazelRpc } from "../rpc"
import { button } from "../ui/button"
import { link } from "../ui/link"
import { type ChannelOption, channelMark, type LinkProps, optimisticLinkAction } from "./channels"

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

/** Accepting where the Customers source is open: the link shows at once (`optimisticLinkAction`). */
const acceptAndShow = optimisticLinkAction(
	(props: LinkProps & { readonly suggestionId: CustomerChannelSuggestionId }) =>
		HazelRpc.use((rpc) =>
			rpc("customers.channel.suggestion.accept", {
				organizationId: props.organizationId,
				suggestionId: props.suggestionId,
			}),
		),
)

// ACTIONS (shared by the overview, the customer page and the one-channel prompt)

export const SuggestionAction = Schema.Literals(["accept", "dismiss"])
export type SuggestionAction = typeof SuggestionAction.Type

/** A refused accept or dismiss: the suggestion or channel is gone, or the channel can't be linked. */
export const SuggestionFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type SuggestionFailure = typeof SuggestionFailure.Type

/** What the actions answer; a page wraps them (`GotSuggestionMessage`). */
export const SuggestionMessage = defineMessageUnion({
	SucceededAccept: { suggestion: SuggestionRow },
	SucceededDismiss: { suggestion: SuggestionRow },
	FailedSuggestionAction: {
		suggestion: SuggestionRow,
		action: SuggestionAction,
		reason: SuggestionFailure,
	},
})
export type SuggestionMessage = typeof SuggestionMessage.Type

/**
 * Link the suggested channel. With `linkedBy` (the overview, the customer page: the Customers
 * source is open) the link shows at once and the Command ends once the synced links hold it;
 * without, the channel's customer arrives through the org source (`channel_customers`).
 */
export const AcceptSuggestion = Command.define("AcceptSuggestion", {
	args: { organizationId: OrganizationId, suggestion: SuggestionRow, linkedBy: Schema.NullOr(UserId) },
	messages: [SuggestionMessage.SucceededAccept, SuggestionMessage.FailedSuggestionAction],
	execute: ({ organizationId, suggestion, linkedBy }) => {
		const failed = (reason: SuggestionFailure) =>
			SuggestionMessage.FailedSuggestionAction({ suggestion, action: "accept", reason })
		const accepted = Effect.gen(function* () {
			if (linkedBy === null) {
				yield* HazelRpc.use((rpc) =>
					rpc("customers.channel.suggestion.accept", {
						organizationId,
						suggestionId: suggestion.id,
					}),
				)
				return
			}
			yield* acceptAndShow({
				organizationId,
				accountId: suggestion.accountId,
				channelId: suggestion.channelId,
				userId: linkedBy,
				suggestionId: suggestion.id,
			})
		})
		return accepted.pipe(
			Effect.as(SuggestionMessage.SucceededAccept({ suggestion })),
			Effect.catchTags({
				CustomersNotFoundError: () => Effect.succeed(failed("NotFound")),
				CustomersInvalidRequestError: () => Effect.succeed(failed("Invalid")),
			}),
			catchCommon(failed),
		)
	},
})

/** That account is never suggested for that channel again; one already gone counts as dismissed. */
export const DismissSuggestion = Command.define("DismissSuggestion", {
	args: { organizationId: OrganizationId, suggestion: SuggestionRow },
	messages: [SuggestionMessage.SucceededDismiss, SuggestionMessage.FailedSuggestionAction],
	execute: ({ organizationId, suggestion }) => {
		const succeeded = SuggestionMessage.SucceededDismiss({ suggestion })
		return HazelRpc.use((rpc) =>
			rpc("customers.channel.suggestion.dismiss", { organizationId, suggestionId: suggestion.id }),
		).pipe(
			Effect.as(succeeded),
			Effect.catchTag("CustomersNotFoundError", () => Effect.succeed(succeeded)),
			catchCommon((reason) =>
				SuggestionMessage.FailedSuggestionAction({ suggestion, action: "dismiss", reason }),
			),
		)
	},
})

/** Why an accept or dismiss failed. */
export const suggestionFailureToast = (action: SuggestionAction, reason: SuggestionFailure): ToastRequest =>
	errorToastOf(
		failureMessage(reason, {
			NotFound: {
				title: action === "accept" ? "Couldn't link the channel" : "Couldn't dismiss the suggestion",
				description: "The suggestion or channel is no longer available.",
			},
			Invalid: {
				title: "Couldn't link the channel",
				description: "Threads and direct messages can't be linked to a customer.",
			},
		}),
	)

// VIEW

/** "Strong match" beside a strong suggestion; nothing for a possible one. */
export const strengthHint = <M>(h: HtmlBuilder<M>, suggestion: Pick<SuggestionRow, "strength">): Html =>
	suggestion.strength === "strong"
		? h.span([h.Class("shrink-0 font-medium text-2xs text-success")], ["Strong match"])
		: h.empty

/**
 * The strongest reason. With more, a disclosure ("+2") lists every reason: a native
 * `<details>`, so keyboard, touch and screen readers reach them too.
 */
export const reasonLine = <M>(
	h: HtmlBuilder<M>,
	suggestion: Pick<SuggestionRow, "reasons" | "accountName">,
): Html => {
	const summary = reasonSummary(suggestion)
	if (summary === null) return h.empty
	if (summary.others.length === 0)
		return h.span([h.Class("line-clamp-2 min-w-0 text-muted-fg text-xs")], [summary.top])
	const more = summary.others.length
	return h.details(
		[h.Class("group min-w-0 text-muted-fg text-xs")],
		[
			h.summary(
				[
					h.Class(
						"flex min-w-0 cursor-pointer list-none items-baseline gap-1.5 rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
					),
				],
				[
					h.span([h.Class("line-clamp-2 min-w-0 group-open:line-clamp-none")], [summary.top]),
					h.span(
						[h.Class("shrink-0 tabular-nums underline decoration-dotted underline-offset-2")],
						[
							`+${more}`,
							h.span([h.Class("sr-only")], [` more ${more === 1 ? "reason" : "reasons"}`]),
						],
					),
				],
			),
			h.ul(
				[h.Class("mt-1 flex list-disc flex-col gap-0.5 pl-4")],
				summary.others.map((reason) => h.li([], [reason])),
			),
		],
	)
}

export interface SuggestionRowOptions<M> {
	readonly shown: ShownSuggestion
	readonly onLink: M
	readonly onDismiss: M
	/** Name the account (the overview's channel → account); the customer page leaves it out. */
	readonly showAccount: boolean
	/** The account's page, when the account is named. */
	readonly accountHref?: string | undefined
}

/** One suggestion: channel (→ account), the strongest reason, strength, Link and dismiss. */
export const suggestionRow = <M>(h: HtmlBuilder<M>, options: SuggestionRowOptions<M>): Html => {
	const { suggestion, channel } = options.shown
	return h.li(
		[h.Key(suggestion.id), h.Class("flex items-center gap-3 py-2")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
				[
					h.span(
						[h.Class("flex min-w-0 items-center gap-1.5 text-sm")],
						[
							channelMark(h, channel),
							h.span([h.Class("min-w-0 truncate font-medium text-fg")], [channel.name]),
							...(options.showAccount
								? [
										h.span(
											[h.Class("shrink-0 text-muted-fg"), h.AriaHidden(true)],
											["→"],
										),
										options.accountHref === undefined
											? h.span(
													[h.Class("min-w-0 truncate font-medium text-fg")],
													[suggestion.accountName],
												)
											: link(
													h,
													{
														href: options.accountHref,
														className: "min-w-0 truncate font-medium text-fg",
													},
													[suggestion.accountName],
												),
									]
								: []),
							strengthHint(h, suggestion),
						],
					),
					reasonLine(h, suggestion),
				],
			),
			button(
				h,
				{
					intent: "outline",
					size: "xs",
					isTouchTarget: true,
					onPress: options.onLink,
					attributes: [h.AriaLabel(`Link ${channel.name} to ${suggestion.accountName}`)],
				},
				["Link"],
			),
			button(
				h,
				{
					intent: "plain",
					size: "sq-xs",
					isTouchTarget: true,
					onPress: options.onDismiss,
					attributes: [h.AriaLabel(`Dismiss: ${channel.name} is not ${suggestion.accountName}`)],
				},
				[IconClose(h, { className: "size-3.5" })],
			),
		],
	)
}
