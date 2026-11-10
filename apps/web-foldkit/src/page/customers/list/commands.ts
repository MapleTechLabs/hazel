import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSavedViewId, OrganizationId, UserId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, Mount } from "foldkit"
import * as Dom from "foldkit/dom"
import { bulkUpdateAccountsAction } from "../../../customers/actions"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { searchFieldIds } from "../../../ui/search-field"
import { createViewAction, deleteViewAction, updateViewAction } from "./data"
import { Message } from "./message"
import { SEARCH_ID, SPARKLINE_DAYS } from "./model"

/** The list's Commands: sparklines, saved views, bulk updates, CSV export, focus and the hover card. */

export const FetchListSparklines = Command.define("FetchListSparklines", {
	args: { organizationId: OrganizationId, accountIds: Schema.Array(CustomerAccountId) },
	messages: [Message.SucceededFetchSparklines, Message.FailedFetchSparklines],
	execute: ({ organizationId, accountIds }) =>
		HazelRpc.use((rpc) =>
			rpc("customers.sparklines", {
				organizationId,
				accountIds,
				metricKey: "active_users",
				days: SPARKLINE_DAYS,
			}),
		).pipe(
			Effect.map(({ sparklines }) => Message.SucceededFetchSparklines({ organizationId, sparklines })),
			catchCommon((reason) => Message.FailedFetchSparklines({ organizationId, reason })),
		),
})

/** Answers name their organization: one for the org shown before is dropped. */
const orgOf = ({ organizationId }: { readonly organizationId: OrganizationId }) => ({ organizationId })

const viewMessages = [Message.SucceededViewAction, Message.FailedViewAction]

export const CreateSavedView = Command.define("CreateSavedView", {
	args: {
		organizationId: OrganizationId,
		userId: UserId,
		view: Customers.ViewDraft,
		isShared: Schema.Boolean,
		position: Schema.Number,
	},
	messages: viewMessages,
	execute: (args) =>
		createViewAction(args).pipe(
			Effect.map((viewId) => Message.SucceededViewAction({ ...orgOf(args), action: "create", viewId })),
			catchCommon((reason) => Message.FailedViewAction({ ...orgOf(args), action: "create", reason })),
		),
})

export const UpdateSavedView = Command.define("UpdateSavedView", {
	args: { organizationId: OrganizationId, viewId: CustomerSavedViewId, view: Customers.ViewDraft },
	messages: viewMessages,
	execute: (args) =>
		updateViewAction(args).pipe(
			Effect.as(Message.SucceededViewAction({ ...orgOf(args), action: "update", viewId: args.viewId })),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(
					Message.FailedViewAction({ ...orgOf(args), action: "update", reason: "NotFound" }),
				),
			),
			catchCommon((reason) => Message.FailedViewAction({ ...orgOf(args), action: "update", reason })),
		),
})

export const DeleteSavedView = Command.define("DeleteSavedView", {
	args: { organizationId: OrganizationId, viewId: CustomerSavedViewId },
	messages: viewMessages,
	execute: (args) =>
		deleteViewAction(args).pipe(
			Effect.as(Message.SucceededViewAction({ ...orgOf(args), action: "delete", viewId: args.viewId })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(
						Message.FailedViewAction({ ...orgOf(args), action: "delete", reason: "NotFound" }),
					),
				CustomersInvalidRequestError: () =>
					Effect.succeed(
						Message.FailedViewAction({ ...orgOf(args), action: "delete", reason: "Refused" }),
					),
			}),
			catchCommon((reason) => Message.FailedViewAction({ ...orgOf(args), action: "delete", reason })),
		),
})

const bulkMessages = [Message.SucceededBulkUpdate, Message.FailedBulkUpdate]

/** `label` names the owner for the toast ("Maya Reinhardt", "nobody"). */
export const BulkAssignOwner = Command.define("BulkAssignOwner", {
	args: {
		organizationId: OrganizationId,
		accountIds: Schema.Array(CustomerAccountId),
		ownerUserId: Schema.NullOr(UserId),
		label: Schema.String,
	},
	messages: bulkMessages,
	execute: ({ label, ...args }) =>
		bulkUpdateAccountsAction(args).pipe(
			Effect.map(({ data }) =>
				Message.SucceededBulkUpdate({ ...orgOf(args), action: "owner", count: data.updated, label }),
			),
			// Over the per-call limit: the list never sends that many.
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(
					Message.FailedBulkUpdate({ ...orgOf(args), action: "owner", reason: "Unexpected" }),
				),
			),
			catchCommon((reason) => Message.FailedBulkUpdate({ ...orgOf(args), action: "owner", reason })),
		),
})

export const BulkAddTag = Command.define("BulkAddTag", {
	args: { organizationId: OrganizationId, accountIds: Schema.Array(CustomerAccountId), tag: Schema.String },
	messages: bulkMessages,
	execute: ({ tag, ...args }) =>
		bulkUpdateAccountsAction({ ...args, addTags: [tag] }).pipe(
			Effect.map(({ data }) =>
				Message.SucceededBulkUpdate({
					...orgOf(args),
					action: "tag",
					count: data.updated,
					label: tag,
				}),
			),
			// Over the per-call limit: the list never sends that many.
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(
					Message.FailedBulkUpdate({ ...orgOf(args), action: "tag", reason: "Unexpected" }),
				),
			),
			catchCommon((reason) => Message.FailedBulkUpdate({ ...orgOf(args), action: "tag", reason })),
		),
})

/** Downloads `csv` as `filename` through a temporary link. */
export const ExportCustomersCsv = Command.define("ExportCustomersCsv", {
	args: { filename: Schema.String, csv: Schema.String },
	messages: [Message.CompletedExport],
	execute: ({ filename, csv }) =>
		Effect.sync(() => {
			const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
			const link = document.createElement("a")
			link.href = url
			link.download = filename
			link.click()
			URL.revokeObjectURL(url)
		}).pipe(Effect.as(Message.CompletedExport())),
})

/** `/` focuses the search field. */
export const FocusListSearch = Command.define("FocusListSearch", {
	messages: [Message.CompletedFocusSearch],
	execute: Dom.focus(`#${searchFieldIds(SEARCH_ID).input}`).pipe(
		// Best effort: the first-run state has no search field.
		Effect.ignore,
		Effect.as(Message.CompletedFocusSearch()),
	),
})

const HOVER_DELAY = Duration.millis(400)

/** The hover card waits a moment, so sweeping across rows does not flash cards. */
export const WaitBeforeHoverCard = Command.define("WaitBeforeHoverCard", {
	args: { accountId: CustomerAccountId },
	messages: [Message.ElapsedHoverDelay],
	execute: ({ accountId }) =>
		Effect.sleep(HOVER_DELAY).pipe(Effect.as(Message.ElapsedHoverDelay({ accountId }))),
})

/** Places the hover card beside its row's name (fixed, so the table's scroll box does not clip it). */
export const PositionHoverCard = Mount.define("PositionHoverCard", {
	args: { anchorId: Schema.String },
	messages: [Message.CompletedPositionHoverCard],
	execute: ({ element, anchorId }) =>
		Effect.sync(() => {
			const anchor = element.ownerDocument.getElementById(anchorId)
			if (anchor === null || !(element instanceof HTMLElement)) return
			const rect = anchor.getBoundingClientRect()
			const height = element.offsetHeight
			const below = rect.bottom + 6
			const top = below + height > window.innerHeight - 12 ? Math.max(12, rect.top - height - 6) : below
			element.style.top = `${top}px`
			element.style.left = `${rect.left}px`
			element.style.visibility = "visible"
		}).pipe(Effect.as(Message.CompletedPositionHoverCard())),
})

/**
 * A Cmd/Ctrl/Shift/middle click on a link in the table (the customer's name) is the browser's: it
 * stops here, before the row's click opens the customer in this tab, and the link opens a new one.
 */
export const LetModifierClicksThrough = Mount.define("LetModifierClicksThrough", {
	messages: [Message.CompletedLetModifierClicksThrough],
	execute: ({ element }) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const onClick = (event: Event) => {
					if (!(event instanceof MouseEvent)) return
					const isModified =
						event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
					if (isModified && event.target instanceof Element && event.target.closest("a") !== null)
						event.stopPropagation()
				}
				element.addEventListener("click", onClick, { capture: true })
				return () => element.removeEventListener("click", onClick, { capture: true })
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.as(Message.CompletedLetModifierClicksThrough())),
})

/** Keeps the keyboard cursor's row on screen. */
export const ScrollListRowIntoView = Mount.define("ScrollListRowIntoView", {
	args: { tableId: Schema.String },
	messages: [Message.CompletedScrollRow],
	execute: ({ element, tableId }) =>
		Effect.sync(() =>
			element.ownerDocument
				.querySelector(`#${tableId} tr[data-focused]`)
				?.scrollIntoView({ block: "nearest" }),
		).pipe(Effect.as(Message.CompletedScrollRow())),
})
