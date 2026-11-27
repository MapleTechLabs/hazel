import { CustomerSignalId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"

/**
 * The signal Commands' Messages (`commands.ts`), all that is left of the Foldkit queue (the page is
 * `@hazel/shared-screens/customers/pages/attention`): the customer page still runs these Commands.
 */

/** A queue action's failure: the signal is gone, or its status no longer allows the action. */
export const SignalActionFailure = Schema.Union([Schema.Literals(["NotFound", "Stale"]), CommonReason])
export type SignalActionFailure = typeof SignalActionFailure.Type

export const SignalAction = Schema.Literals(["assign", "snooze", "done", "reopen"])
export type SignalAction = typeof SignalAction.Type

export const Message = defineMessageUnion({
	SucceededSignalAction: { signalId: CustomerSignalId, action: SignalAction },
	FailedSignalAction: { signalId: CustomerSignalId, action: SignalAction, reason: SignalActionFailure },
})
export type Message = typeof Message.Type
