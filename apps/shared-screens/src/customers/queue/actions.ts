/**
 * How a queue action fails, and its copy (today's attention `commands.ts` and `update.ts`): the signal
 * is gone (`NotFound`), someone acted first or the assignee left (`Stale`), or a common reason.
 */
import { Match, Schema } from "effect"
import { CommonReason, copyOf, type ErrorCopy, reasonOf } from "../../modals/feedback"

export const SignalAction = Schema.Literals(["assign", "snooze", "done", "reopen", "mute"])
export type SignalAction = typeof SignalAction.Type
export const SignalActionFailure = Schema.Union([Schema.Literals(["NotFound", "Stale"]), CommonReason])
export type SignalActionFailure = typeof SignalActionFailure.Type

const tagOf = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
		? error._tag
		: undefined

/** The failure a write's error reads as. */
export const failureOf = (error: unknown): SignalActionFailure =>
	Match.value(tagOf(error)).pipe(
		Match.when("CustomersNotFoundError", (): SignalActionFailure => "NotFound"),
		Match.when("CustomerSignalTransitionError", (): SignalActionFailure => "Stale"),
		Match.when("CustomersInvalidRequestError", (): SignalActionFailure => "Stale"),
		Match.orElse(() => reasonOf(error)),
	)

const VERB = {
	assign: "assign",
	snooze: "snooze",
	done: "mark done",
	reopen: "reopen",
	mute: "mute",
} as const satisfies Record<SignalAction, string>

export const failureCopy = (action: SignalAction, failure: SignalActionFailure): ErrorCopy =>
	action === "mute"
		? copyOf(failure, {
				NotFound: { title: "Couldn't mute the customer", description: "It was removed." },
				Stale: { title: "Couldn't mute the customer" },
			})
		: copyOf(failure, {
				NotFound: {
					title: `Couldn't ${VERB[action]} the signal`,
					description: "It was resolved or removed in the meantime.",
				},
				Stale: {
					title: `Couldn't ${VERB[action]} the signal`,
					description: "Someone else acted on it first.",
				},
			})
