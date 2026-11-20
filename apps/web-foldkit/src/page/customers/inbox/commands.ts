import * as Customers from "@hazel/domain/customers"
import type { CustomersInvalidRequestError, CustomersNotFoundError } from "@hazel/domain/rpc"
import { CustomerIssueId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Mount } from "foldkit"
import * as Dom from "foldkit/dom"
import type { CommonError } from "~/lib/error-messages"
import { type IssueChange, updateIssueAction } from "../../../customers/issues"
import { catchCommon } from "../../../data/actions"
import { searchFieldIds } from "../../../ui/search-field"
import { IssueAction, Message } from "./message"
import { SEARCH_ID } from "./model"

/** The inbox's Commands: the optimistic issue changes, focusing search, keeping the cursor on screen. */

const settle =
	(issueId: CustomerIssueId, action: IssueAction) =>
	<A, R>(
		effect: Effect.Effect<A, CustomersNotFoundError | CustomersInvalidRequestError | CommonError, R>,
	) =>
		effect.pipe(
			Effect.as(Message.SucceededIssueAction({ issueId, action })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedIssueAction({ issueId, action, reason: "NotFound" })),
				// The assignee left the organization since the menu showed them.
				CustomersInvalidRequestError: () =>
					Effect.succeed(Message.FailedIssueAction({ issueId, action, reason: "Stale" })),
			}),
			catchCommon((reason) => Message.FailedIssueAction({ issueId, action, reason })),
		)

export const UpdateInboxIssue = Command.define("UpdateInboxIssue", {
	args: {
		organizationId: OrganizationId,
		issueId: CustomerIssueId,
		actor: UserId,
		action: IssueAction,
		status: Schema.optionalKey(Customers.IssueStatus),
		priority: Schema.optionalKey(Customers.IssuePriority),
		assigneeUserId: Schema.optionalKey(Schema.NullOr(UserId)),
	},
	messages: [Message.SucceededIssueAction, Message.FailedIssueAction],
	execute: ({ organizationId, issueId, actor, action, ...fields }) => {
		const change: IssueChange = {}
		if (fields.status !== undefined) change.status = fields.status
		if (fields.priority !== undefined) change.priority = fields.priority
		if (fields.assigneeUserId !== undefined) change.assigneeUserId = fields.assigneeUserId
		return updateIssueAction({ organizationId, issueId, change, actor }).pipe(settle(issueId, action))
	},
})

export const FocusInboxSearch = Command.define("FocusInboxSearch", {
	messages: [Message.CompletedFocusSearch],
	execute: Dom.focus(`#${searchFieldIds(SEARCH_ID).input}`).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedFocusSearch()),
	),
})

/** Keeps the keyboard cursor's row on screen: mounted (keyed by the selection) beside the list. */
export const ScrollInboxRow = Mount.define("ScrollInboxRowIntoView", {
	args: { rowId: Schema.String },
	messages: [Message.CompletedScrollRow],
	execute: ({ element, rowId }) =>
		Effect.sync(() =>
			element.ownerDocument.getElementById(rowId)?.scrollIntoView({ block: "nearest" }),
		).pipe(Effect.as(Message.CompletedScrollRow())),
})
