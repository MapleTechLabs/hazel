import * as Customers from "@hazel/domain/customers"
import type {
	CustomerSignalTransitionError,
	CustomersInvalidRequestError,
	CustomersNotFoundError,
} from "@hazel/domain/rpc"
import { CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import type { CommonError } from "~/lib/error-messages"
import { assignSignalAction, markSignalDoneAction, snoozeSignalAction } from "../../../customers/actions"
import { catchCommon } from "../../../data/actions"
import { Message, type SignalAction } from "./message"

/** The customer page's optimistic signal actions (Needs attention itself is native now). */

const signalMessages = [Message.SucceededSignalAction, Message.FailedSignalAction] as const

/** Every signal action settles alike: gone (`NotFound`), status moved on (`Stale`), or a common reason. */
const settle =
	(signalId: CustomerSignalId, action: SignalAction) =>
	<A, R>(
		effect: Effect.Effect<
			A,
			| CustomersNotFoundError
			| CustomerSignalTransitionError
			| CustomersInvalidRequestError
			| CommonError,
			R
		>,
	) =>
		effect.pipe(
			Effect.as(Message.SucceededSignalAction({ signalId, action })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedSignalAction({ signalId, action, reason: "NotFound" })),
				CustomerSignalTransitionError: () =>
					Effect.succeed(Message.FailedSignalAction({ signalId, action, reason: "Stale" })),
				// The assignee left the organization since the menu showed them.
				CustomersInvalidRequestError: () =>
					Effect.succeed(Message.FailedSignalAction({ signalId, action, reason: "Stale" })),
			}),
			catchCommon((reason) => Message.FailedSignalAction({ signalId, action, reason })),
		)

const target = { organizationId: OrganizationId, signalId: CustomerSignalId }

export const AssignSignal = Command.define("AssignSignal", {
	args: { ...target, assigneeUserId: Schema.NullOr(UserId) },
	messages: signalMessages,
	execute: (args) => assignSignalAction(args).pipe(settle(args.signalId, "assign")),
})

export const SnoozeSignal = Command.define("SnoozeSignal", {
	args: { ...target, userId: UserId, untilMs: Schema.Finite },
	messages: signalMessages,
	execute: ({ untilMs, ...args }) =>
		snoozeSignalAction({ ...args, until: new Date(untilMs) }).pipe(settle(args.signalId, "snooze")),
})

export const MarkSignalDone = Command.define("MarkSignalDone", {
	args: { ...target, userId: UserId, outcome: Customers.SignalOutcome, note: Schema.String },
	messages: signalMessages,
	execute: ({ note, ...args }) =>
		markSignalDoneAction({ ...args, note: note.trim() === "" ? undefined : note.trim() }).pipe(
			settle(args.signalId, "done"),
		),
})
