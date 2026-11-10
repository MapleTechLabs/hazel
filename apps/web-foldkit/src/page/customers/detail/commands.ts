import * as Customers from "@hazel/domain/customers"
import type { CustomerSignalTransitionError, CustomersNotFoundError } from "@hazel/domain/rpc"
import { CustomerAccountId, CustomerNoteId, CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import type { CommonError } from "~/lib/error-messages"
import {
	assignSignalAction,
	createNoteAction,
	deleteNoteAction,
	dismissSignalAction,
	markSignalDoneAction,
	snoozeSignalAction,
	updateAccountAction,
	updateNoteAction,
} from "../../../customers/actions"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { Message, type NoteAction, type NoteDraft, type SignalAction } from "./message"
import { COMPOSER_ID, PAGE_SIZE } from "./model"

/** The customer page's Commands: its reads, and the account, note and signal actions. */

const target = { organizationId: OrganizationId, accountId: CustomerAccountId }

// READS

export const FetchCustomerDetail = Command.define("FetchCustomerDetail", {
	args: target,
	messages: [Message.SucceededFetchDetail, Message.FailedFetchDetail],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("customers.account.detail", args)).pipe(
			Effect.map((detail) => Message.SucceededFetchDetail({ accountId: args.accountId, detail })),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedFetchDetail({ accountId: args.accountId, reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedFetchDetail({ accountId: args.accountId, reason })),
		),
})

export const FetchCustomerUsage = Command.define("FetchCustomerUsage", {
	args: { ...target, metricKey: Schema.String, range: Customers.CustomersRange },
	messages: [Message.SucceededFetchUsage, Message.FailedFetchUsage],
	execute: ({ metricKey, range, ...args }) => {
		const asked = { accountId: args.accountId, metricKey, range }
		return HazelRpc.use((rpc) =>
			rpc("customers.account.series", { ...args, metricKeys: [metricKey], range }),
		).pipe(
			Effect.map(({ series }) => Message.SucceededFetchUsage({ ...asked, series })),
			// A deleted account shows its not-found state from the detail call; the chart only retries.
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedFetchUsage({ ...asked, reason: "Unexpected" })),
			),
			catchCommon((reason) => Message.FailedFetchUsage({ ...asked, reason })),
		)
	},
})

export const FetchCustomerMrrHistory = Command.define("FetchCustomerMrrHistory", {
	args: target,
	messages: [Message.SucceededFetchMrrHistory, Message.FailedFetchMrrHistory],
	execute: (args) =>
		HazelRpc.use((rpc) =>
			rpc("customers.account.series", { ...args, metricKeys: ["mrr"], range: "12m" }),
		).pipe(
			Effect.map(({ series }) =>
				Message.SucceededFetchMrrHistory({ accountId: args.accountId, series }),
			),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(
					Message.FailedFetchMrrHistory({ accountId: args.accountId, reason: "Unexpected" }),
				),
			),
			catchCommon((reason) => Message.FailedFetchMrrHistory({ accountId: args.accountId, reason })),
		),
})

const page = (cursor: string | null) =>
	cursor === null ? { limit: PAGE_SIZE } : { cursor, limit: PAGE_SIZE }

export const FetchCustomerContacts = Command.define("FetchCustomerContacts", {
	args: { ...target, cursor: Schema.NullOr(Schema.String) },
	messages: [Message.SucceededFetchContacts, Message.FailedFetchContacts],
	execute: ({ cursor, ...args }) =>
		HazelRpc.use((rpc) => rpc("customers.contacts.list", { ...args, ...page(cursor) })).pipe(
			Effect.map((result) =>
				Message.SucceededFetchContacts({ accountId: args.accountId, page: result }),
			),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(
					Message.FailedFetchContacts({ accountId: args.accountId, reason: "Unexpected" }),
				),
			),
			catchCommon((reason) => Message.FailedFetchContacts({ accountId: args.accountId, reason })),
		),
})

export const FetchCustomerInvoices = Command.define("FetchCustomerInvoices", {
	args: { ...target, cursor: Schema.NullOr(Schema.String) },
	messages: [Message.SucceededFetchInvoices, Message.FailedFetchInvoices],
	execute: ({ cursor, ...args }) =>
		HazelRpc.use((rpc) => rpc("customers.invoices.list", { ...args, ...page(cursor) })).pipe(
			Effect.map((result) =>
				Message.SucceededFetchInvoices({ accountId: args.accountId, page: result }),
			),
			catchCommon((reason) => Message.FailedFetchInvoices({ accountId: args.accountId, reason })),
		),
})

export const FetchCustomerEvents = Command.define("FetchCustomerEvents", {
	args: {
		...target,
		filter: Schema.String,
		providers: Schema.Array(Customers.CustomerSource),
		types: Schema.Array(Schema.String),
		cursor: Schema.NullOr(Schema.String),
	},
	messages: [Message.SucceededFetchEvents, Message.FailedFetchEvents],
	execute: ({ filter, providers, types, cursor, ...args }) =>
		HazelRpc.use((rpc) =>
			rpc("customers.events.list", {
				...args,
				// Empty lists filter nothing, as absent ones do.
				providers,
				types,
				...page(cursor),
			}),
		).pipe(
			Effect.map((result) =>
				Message.SucceededFetchEvents({ accountId: args.accountId, filter, page: result }),
			),
			catchCommon((reason) => Message.FailedFetchEvents({ accountId: args.accountId, filter, reason })),
		),
})

// ACCOUNT

export const UpdateCustomerAccount = Command.define("UpdateCustomerAccount", {
	args: {
		...target,
		ownerUserId: Schema.optionalKey(Schema.NullOr(UserId)),
		tags: Schema.optionalKey(Schema.Array(Schema.String)),
	},
	messages: [Message.SucceededAccountUpdate, Message.FailedAccountUpdate],
	execute: (args) =>
		updateAccountAction(args).pipe(
			Effect.as(Message.SucceededAccountUpdate()),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedAccountUpdate({ reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedAccountUpdate({ reason })),
		),
})

// NOTES

/** `draft` is the text a failed save or edit hands back (null for pin and delete). */
const settleNote =
	(action: NoteAction, draft: NoteDraft | null = null) =>
	<A, R>(effect: Effect.Effect<A, CustomersNotFoundError | CommonError, R>) =>
		effect.pipe(
			Effect.as(Message.SucceededNoteAction({ action })),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedNoteAction({ action, reason: "NotFound", draft })),
			),
			catchCommon((reason) => Message.FailedNoteAction({ action, reason, draft })),
		)

const noteMessages = [Message.SucceededNoteAction, Message.FailedNoteAction]

export const CreateCustomerNote = Command.define("CreateCustomerNote", {
	args: { ...target, authorUserId: UserId, body: Schema.String, pinned: Schema.Boolean },
	messages: noteMessages,
	execute: (args) => createNoteAction(args).pipe(settleNote("create", { noteId: null, body: args.body })),
})

export const UpdateCustomerNote = Command.define("UpdateCustomerNote", {
	args: {
		organizationId: OrganizationId,
		noteId: CustomerNoteId,
		body: Schema.optionalKey(Schema.String),
		pinned: Schema.optionalKey(Schema.Boolean),
	},
	messages: noteMessages,
	execute: (args) =>
		updateNoteAction(args).pipe(
			settleNote("update", args.body === undefined ? null : { noteId: args.noteId, body: args.body }),
		),
})

export const DeleteCustomerNote = Command.define("DeleteCustomerNote", {
	args: { organizationId: OrganizationId, noteId: CustomerNoteId },
	messages: noteMessages,
	execute: (args) => deleteNoteAction(args).pipe(settleNote("delete")),
})

// SIGNALS

const settleSignal =
	(action: SignalAction) =>
	<A, R>(
		effect: Effect.Effect<A, CustomersNotFoundError | CustomerSignalTransitionError | CommonError, R>,
	) =>
		effect.pipe(
			Effect.as(Message.SucceededSignalAction({ action })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedSignalAction({ action, reason: "NotFound" })),
				CustomerSignalTransitionError: () =>
					Effect.succeed(Message.FailedSignalAction({ action, reason: "Stale" })),
			}),
			catchCommon((reason) => Message.FailedSignalAction({ action, reason })),
		)

const signalMessages = [Message.SucceededSignalAction, Message.FailedSignalAction]
const signalTarget = { organizationId: OrganizationId, signalId: CustomerSignalId }

export const AssignCustomerSignal = Command.define("AssignCustomerSignal", {
	args: { ...signalTarget, assigneeUserId: Schema.NullOr(UserId) },
	messages: signalMessages,
	execute: (args) => assignSignalAction(args).pipe(settleSignal("assign")),
})

export const SnoozeCustomerSignal = Command.define("SnoozeCustomerSignal", {
	args: { ...signalTarget, userId: UserId, untilMs: Schema.Number },
	messages: signalMessages,
	execute: ({ untilMs, ...args }) =>
		snoozeSignalAction({ ...args, until: new Date(untilMs) }).pipe(settleSignal("snooze")),
})

export const MarkCustomerSignalDone = Command.define("MarkCustomerSignalDone", {
	args: { ...signalTarget, userId: UserId, outcome: Customers.SignalOutcome },
	messages: signalMessages,
	execute: (args) => markSignalDoneAction(args).pipe(settleSignal("done")),
})

export const DismissCustomerSignal = Command.define("DismissCustomerSignal", {
	args: { ...signalTarget, userId: UserId },
	messages: signalMessages,
	execute: (args) => dismissSignalAction(args).pipe(settleSignal("dismiss")),
})

// LOCAL

/** Copies `text`; a path (`/…`) becomes a full link on this origin. */
export const CopyCustomerText = Command.define("CopyCustomerText", {
	args: { text: Schema.String, label: Schema.String },
	messages: [Message.CompletedCopy],
	execute: ({ text, label }) =>
		Effect.tryPromise(() =>
			navigator.clipboard.writeText(
				text.startsWith("/") ? new URL(text, window.location.origin).href : text,
			),
		).pipe(
			Effect.match({
				onSuccess: () => Message.CompletedCopy({ label, isCopied: true }),
				onFailure: () => Message.CompletedCopy({ label, isCopied: false }),
			}),
		),
})

export const FocusNoteComposer = Command.define("FocusNoteComposer", {
	messages: [Message.CompletedFocusComposer],
	execute: Dom.focus(`#${COMPOSER_ID}`).pipe(
		// Best effort: the notes tab may not have rendered yet.
		Effect.ignore,
		Effect.as(Message.CompletedFocusComposer()),
	),
})
