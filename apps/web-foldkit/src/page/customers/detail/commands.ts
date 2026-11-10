import * as Customers from "@hazel/domain/customers"
import type { CustomersNotFoundError } from "@hazel/domain/rpc"
import { CustomerAccountId, CustomerNoteId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import { type CommonError, failureMessage } from "~/lib/error-messages"
import {
	createNoteAction,
	deleteNoteAction,
	updateAccountAction,
	updateNoteAction,
} from "../../../customers/actions"
import { catchCommon, errorToastOf } from "../../../data/actions"
import { showBackgroundToast } from "../../../overlay/background-toasts"
import { HazelRpc } from "../../../rpc"
import { Message, type NoteAction, type NoteDraft } from "./message"
import { COMPOSER_ID, PAGE_SIZE } from "./model"
import { draftToRestore, readNoteDrafts, restoreNoteDraft } from "./note-drafts"

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
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedAccountUpdate({ reason: "NotFound" })),
				// The owner left the organization since the menu showed them.
				CustomersInvalidRequestError: () =>
					Effect.succeed(Message.FailedAccountUpdate({ reason: "Stale" })),
			}),
			catchCommon((reason) => Message.FailedAccountUpdate({ reason })),
		),
})

// NOTES

const NOTE_VERB = { create: "save", update: "update", delete: "delete" } as const satisfies Record<
	NoteAction,
	string
>

type NoteAnswer = Extract<Message, { readonly _tag: "SucceededNoteAction" | "FailedNoteAction" }>
type FailedNoteAction = Extract<NoteAnswer, { readonly _tag: "FailedNoteAction" }>

/** Told from here, and the text kept for its customer: the page that asked may be gone by now. */
const failedNote = (accountId: CustomerAccountId, failure: FailedNoteAction) => {
	const { action, reason } = failure
	const draft = draftToRestore(failure)
	return Effect.andThen(
		showBackgroundToast(
			errorToastOf(
				failureMessage(reason, {
					NotFound: {
						title: `Couldn't ${NOTE_VERB[action]} the note`,
						description: "It was deleted.",
					},
					Stale: { title: `Couldn't ${NOTE_VERB[action]} the note` },
				}),
			),
		),
		draft === null ? Effect.void : restoreNoteDraft(accountId, draft),
	)
}

/** `draft` is the text a failed save or edit hands back (null for pin and delete). */
const settleNote =
	(action: NoteAction, accountId: CustomerAccountId, draft: NoteDraft | null = null) =>
	<A, R>(
		effect: Effect.Effect<A, CustomersNotFoundError | CommonError, R>,
	): Effect.Effect<NoteAnswer, never, R> =>
		effect.pipe(
			Effect.as<NoteAnswer>(Message.SucceededNoteAction({ action })),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedNoteAction({ action, reason: "NotFound", draft })),
			),
			catchCommon((reason) => Message.FailedNoteAction({ action, reason, draft })),
			Effect.tap((message) =>
				message._tag === "FailedNoteAction" ? failedNote(accountId, message) : Effect.void,
			),
		)

const noteMessages = [Message.SucceededNoteAction, Message.FailedNoteAction]

export const CreateCustomerNote = Command.define("CreateCustomerNote", {
	args: { ...target, authorUserId: UserId, body: Schema.String, pinned: Schema.Boolean },
	messages: noteMessages,
	execute: (args) =>
		createNoteAction(args).pipe(settleNote("create", args.accountId, { noteId: null, body: args.body })),
})

export const UpdateCustomerNote = Command.define("UpdateCustomerNote", {
	args: {
		...target,
		noteId: CustomerNoteId,
		body: Schema.optionalKey(Schema.String),
		pinned: Schema.optionalKey(Schema.Boolean),
	},
	messages: noteMessages,
	execute: ({ accountId, ...edit }) =>
		updateNoteAction(edit).pipe(
			settleNote(
				"update",
				accountId,
				edit.body === undefined ? null : { noteId: edit.noteId, body: edit.body },
			),
		),
})

export const DeleteCustomerNote = Command.define("DeleteCustomerNote", {
	args: { ...target, noteId: CustomerNoteId },
	messages: noteMessages,
	execute: ({ accountId, ...note }) => deleteNoteAction(note).pipe(settleNote("delete", accountId)),
})

/** The drafts kept for this customer, for its new page instance. */
export const LoadNoteDrafts = Command.define("LoadNoteDrafts", {
	args: { accountId: CustomerAccountId },
	messages: [Message.LoadedNoteDrafts],
	execute: ({ accountId }) =>
		Effect.map(readNoteDrafts(accountId), (drafts) => Message.LoadedNoteDrafts({ drafts })),
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
