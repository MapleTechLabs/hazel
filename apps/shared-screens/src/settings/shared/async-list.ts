// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The body of a settings card that lists fetched records (pending invitations, connect invites):
 * a spinner while the first load runs, the reason when it fails, and once loaded the rows, with a
 * notice above them when a refetch fails. Takes a `Query`'s result as the page reads it.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Option } from "effect"
import { type CommonReason, commonCopy } from "../../modals/feedback"

/** A failure worth trying again: the network or the server, not the session or a bug. */
export const isRetryableReason = (reason: CommonReason): boolean =>
	reason === "Offline" || reason === "Timeout" || reason === "Unavailable"

const reasonOf = <E>(cause: Cause.Cause<E>, toReason: (error: E) => CommonReason): CommonReason =>
	Option.match(Cause.findErrorOption(cause), { onNone: () => "Unexpected", onSome: toReason })

/** A `Query`'s result as the list reads it (`AsyncResult`, structurally). */
export type ListResult<A, E> =
	| { readonly _tag: "Initial" }
	| { readonly _tag: "Success"; readonly value: A }
	| {
			readonly _tag: "Failure"
			readonly cause: Cause.Cause<E>
			readonly previousSuccess: Option.Option<{ readonly value: A }>
	  }

export interface AsyncListOptions<A, E, Msg> {
	/** `Loading invitations...` */
	readonly loadingLabel: string
	/** `Couldn't load invitations` */
	readonly failedTitle: string
	readonly onRetry: Msg
	/** The common reason of a failure (the identity when the query fails with one). */
	readonly reasonOf: (error: E) => CommonReason
	readonly loaded: (data: A) => Hazel.NoTextInput<Msg>
}

export const asyncListBody = <A, E, Msg>(
	h: Hazel.H<Msg>,
	result: ListResult<A, E>,
	options: AsyncListOptions<A, E, Msg>,
): Hazel.NoTextInput<Msg> => {
	const retry = (reason: CommonReason) =>
		isRetryableReason(reason)
			? h.button.label("Try again").variant("secondary").size("small").on("press", options.onRetry)
			: undefined
	// HAZEL-GAP(p4-async-list-box): today's loading and failed states fill a 256px box (`h-64`); the
	// spinner and empty state here take their own height.
	if (result._tag === "Initial")
		return h.progress.key("async-list:loading").style("spinner").label(options.loadingLabel)
	if (result._tag === "Success") return options.loaded(result.value)
	const reason = reasonOf(result.cause, options.reasonOf)
	const copy = commonCopy(reason)
	return Option.match(result.previousSuccess, {
		onNone: () =>
			h.emptyState
				.key("async-list:failed")
				.icon("warning")
				.title(options.failedTitle)
				.description(copy.description ?? copy.title)
				.action(retry(reason)),
		onSome: (stale) =>
			h.stack
				.key("async-list:stale")
				.density("none")
				.children(
					h.stack
						.inset("page")
						.children(
							h.banner
								.tone("danger")
								.description(`Couldn't refresh: ${copy.title}`)
								.actions(retry(reason)),
						),
					options.loaded(stale.value),
				),
	})
}
