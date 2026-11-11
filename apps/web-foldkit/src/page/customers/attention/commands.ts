import * as Customers from "@hazel/domain/customers"
import type {
	CustomerSignalTransitionError,
	CustomersInvalidRequestError,
	CustomersNotFoundError,
} from "@hazel/domain/rpc"
import { CustomerAccountId, CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Mount } from "foldkit"
import * as Dom from "foldkit/dom"
import type { CommonError } from "~/lib/error-messages"
import {
	assignSignalAction,
	dismissSignalAction,
	markSignalDoneAction,
	reopenSignalAction,
	snoozeSignalAction,
} from "../../../customers/actions"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { searchFieldIds } from "../../../ui/search-field"
import { Message, type SignalAction } from "./message"
import { SEARCH_ID } from "./model"

/** The queue's Commands: the optimistic signal actions, the preview's detail, copying an email. */

const signalMessages = [Message.SucceededSignalAction, Message.FailedSignalAction]

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
	args: { ...target, userId: UserId, untilMs: Schema.Number },
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

export const DismissSignal = Command.define("DismissSignal", {
	args: { ...target, userId: UserId },
	messages: signalMessages,
	execute: (args) => dismissSignalAction(args).pipe(settle(args.signalId, "dismiss")),
})

export const ReopenSignal = Command.define("ReopenSignal", {
	args: target,
	messages: signalMessages,
	execute: (args) => reopenSignalAction(args).pipe(settle(args.signalId, "reopen")),
})

/** The preview panel's account summary, contacts to reach and recent timeline. */
export const FetchAccountDetail = Command.define("FetchAccountDetail", {
	args: { organizationId: OrganizationId, accountId: CustomerAccountId },
	messages: [Message.SucceededFetchDetail, Message.FailedFetchDetail],
	execute: ({ organizationId, accountId }) =>
		HazelRpc.use((rpc) => rpc("customers.account.detail", { organizationId, accountId })).pipe(
			Effect.map((detail) => Message.SucceededFetchDetail({ accountId, detail })),
			// A deleted account reads like an unreachable one: the panel offers a retry.
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedFetchDetail({ accountId, reason: "Unexpected" })),
			),
			catchCommon((reason) => Message.FailedFetchDetail({ accountId, reason })),
		),
})

export const CopyAttentionEmail = Command.define("CopyAttentionEmail", {
	args: { email: Schema.String },
	messages: [Message.SucceededCopyEmail, Message.FailedCopyEmail],
	execute: ({ email }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(email)).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededCopyEmail({ email }),
				onFailure: () => Message.FailedCopyEmail(),
			}),
		),
})

/** `/` focuses the search field. */
export const FocusAttentionSearch = Command.define("FocusAttentionSearch", {
	messages: [Message.CompletedFocusSearch],
	execute: Dom.focus(`#${searchFieldIds(SEARCH_ID).input}`).pipe(
		// Best effort: the field may not be on screen (the all-clear state still shows it).
		Effect.ignore,
		Effect.as(Message.CompletedFocusSearch()),
	),
})

/** Keeps the keyboard cursor's row on screen: mounted (keyed by the selection) beside the list. */
export const ScrollRowIntoView = Mount.define("ScrollQueueRowIntoView", {
	args: { rowId: Schema.String },
	messages: [Message.CompletedScrollRow],
	execute: ({ element, rowId }) =>
		Effect.sync(() =>
			element.ownerDocument.getElementById(rowId)?.scrollIntoView({ block: "nearest" }),
		).pipe(Effect.as(Message.CompletedScrollRow())),
})
