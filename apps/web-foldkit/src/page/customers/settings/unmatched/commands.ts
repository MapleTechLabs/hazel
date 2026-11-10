import { IgnoreRuleField } from "@hazel/domain/customers"
import type { CustomersInvalidRequestError, CustomersNotFoundError } from "@hazel/domain/rpc"
import {
	CustomerAccountId,
	CustomerIgnoreRuleId,
	CustomerUnmatchedRecordId,
	OrganizationId,
} from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import type { CommonError } from "~/lib/error-messages"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message, type RecordAction, type RecordActionFailure } from "./message"
import { PAGE_SIZE, RecordStatus, toIgnoreRuleRow, toRecordRow } from "./model"

/**
 * The resolver's Commands. Unmatched records are not synced: the lists are RPC pages, and an action's
 * `transactionId` has nothing to wait for, so a success keeps the page's optimistic state.
 */

export const FetchUnmatchedRecords = Command.define("FetchUnmatchedRecords", {
	args: { organizationId: OrganizationId, status: RecordStatus, cursor: Schema.NullOr(Schema.String) },
	messages: [Message.SucceededFetchRecords, Message.FailedFetchRecords],
	execute: ({ organizationId, status, cursor }) =>
		HazelRpc.use((rpc) => {
			const request = { organizationId, status, limit: PAGE_SIZE }
			return rpc("customers.unmatched.list", cursor === null ? request : { ...request, cursor })
		}).pipe(
			Effect.map((page) =>
				Message.SucceededFetchRecords({
					status,
					isMore: cursor !== null,
					items: page.items.map(toRecordRow),
					nextCursor: page.nextCursor,
					openCount: page.openCount,
				}),
			),
			catchCommon((reason) => Message.FailedFetchRecords({ status, isMore: cursor !== null, reason })),
		),
})

export const FetchUnmatchedIgnoreRules = Command.define("FetchUnmatchedIgnoreRules", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchIgnoreRules, Message.FailedFetchIgnoreRules],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("customers.ignoreRules.list", { organizationId })).pipe(
			Effect.map(({ items }) =>
				Message.SucceededFetchIgnoreRules({ rules: items.map(toIgnoreRuleRow) }),
			),
			catchCommon((reason) => Message.FailedFetchIgnoreRules({ reason })),
		),
})

// RECORD ACTIONS

type ActionError = CustomersNotFoundError | CustomersInvalidRequestError | CommonError

/** An action's outcome for one record: none, or why it failed. */
const outcomeOf = <A, R>(
	effect: Effect.Effect<A, ActionError, R>,
): Effect.Effect<RecordActionFailure | null, never, R> =>
	effect.pipe(
		Effect.as(null),
		Effect.catchTags({
			CustomersNotFoundError: () => Effect.succeed("NotFound" as const),
			CustomersInvalidRequestError: () => Effect.succeed("Invalid" as const),
		}),
		catchCommon((reason) => reason),
	)

const settle =
	(recordId: CustomerUnmatchedRecordId, action: RecordAction) =>
	<A, R>(effect: Effect.Effect<A, ActionError, R>) =>
		outcomeOf(effect).pipe(
			Effect.map((reason) =>
				reason === null
					? Message.SucceededRecordAction({ recordId, action })
					: Message.FailedRecordAction({ recordId, action, reason }),
			),
		)

const recordMessages = [Message.SucceededRecordAction, Message.FailedRecordAction]
const target = { organizationId: OrganizationId, recordId: CustomerUnmatchedRecordId }

const link = (
	organizationId: OrganizationId,
	recordId: CustomerUnmatchedRecordId,
	accountId: CustomerAccountId,
) => HazelRpc.use((rpc) => rpc("customers.unmatched.link", { organizationId, recordId, accountId }))

const ignore = (
	organizationId: OrganizationId,
	recordId: CustomerUnmatchedRecordId,
	rule?: { readonly field: IgnoreRuleField; readonly pattern: string },
) =>
	HazelRpc.use((rpc) => {
		const request = { organizationId, recordId }
		return rpc("customers.unmatched.ignore", rule === undefined ? request : { ...request, rule })
	})

export const LinkUnmatchedRecord = Command.define("LinkUnmatchedRecord", {
	args: { ...target, accountId: CustomerAccountId },
	messages: recordMessages,
	execute: ({ organizationId, recordId, accountId }) =>
		link(organizationId, recordId, accountId).pipe(settle(recordId, "link")),
})

export const CreateAccountFromUnmatched = Command.define("CreateAccountFromUnmatched", {
	args: target,
	messages: recordMessages,
	execute: ({ organizationId, recordId }) =>
		HazelRpc.use((rpc) => rpc("customers.unmatched.createAccount", { organizationId, recordId })).pipe(
			settle(recordId, "create"),
		),
})

/** With `rule`, every future record matching it is ignored too. */
export const IgnoreUnmatchedRecord = Command.define("IgnoreUnmatchedRecord", {
	args: {
		...target,
		rule: Schema.NullOr(Schema.Struct({ field: IgnoreRuleField, pattern: Schema.String })),
		/** The other loaded open records the rule covers: the server ignores them with it. */
		coveredIds: Schema.Array(CustomerUnmatchedRecordId),
	},
	messages: [...recordMessages, Message.SucceededIgnoreWithRule],
	execute: ({ organizationId, recordId, rule, coveredIds }) =>
		ignore(organizationId, recordId, rule ?? undefined).pipe(
			settle(recordId, "ignore"),
			Effect.map((message) =>
				message._tag === "SucceededRecordAction" && rule !== null
					? Message.SucceededIgnoreWithRule({ recordId, coveredIds })
					: message,
			),
		),
})

// BULK

/** There is no bulk RPC: one call per record, a few at a time. */
const BULK_CONCURRENCY = 4

const settleAll =
	(action: RecordAction) =>
	<R>(
		outcomes: Effect.Effect<
			ReadonlyArray<
				Readonly<{ recordId: CustomerUnmatchedRecordId; reason: RecordActionFailure | null }>
			>,
			never,
			R
		>,
	) =>
		outcomes.pipe(
			Effect.map((results) =>
				Message.CompletedBulkAction({
					action,
					succeeded: results
						.filter((result) => result.reason === null)
						.map((result) => result.recordId),
					failed: results.flatMap(({ recordId, reason }) =>
						reason === null ? [] : [{ recordId, reason }],
					),
				}),
			),
		)

export const LinkUnmatchedRecords = Command.define("LinkUnmatchedRecords", {
	args: {
		organizationId: OrganizationId,
		links: Schema.Array(
			Schema.Struct({ recordId: CustomerUnmatchedRecordId, accountId: CustomerAccountId }),
		),
	},
	messages: [Message.CompletedBulkAction],
	execute: ({ organizationId, links }) =>
		Effect.forEach(
			links,
			({ recordId, accountId }) =>
				outcomeOf(link(organizationId, recordId, accountId)).pipe(
					Effect.map((reason) => ({ recordId, reason })),
				),
			{ concurrency: BULK_CONCURRENCY },
		).pipe(settleAll("link")),
})

export const IgnoreUnmatchedRecords = Command.define("IgnoreUnmatchedRecords", {
	args: { organizationId: OrganizationId, recordIds: Schema.Array(CustomerUnmatchedRecordId) },
	messages: [Message.CompletedBulkAction],
	execute: ({ organizationId, recordIds }) =>
		Effect.forEach(
			recordIds,
			(recordId) =>
				outcomeOf(ignore(organizationId, recordId)).pipe(
					Effect.map((reason) => ({ recordId, reason })),
				),
			{ concurrency: BULK_CONCURRENCY },
		).pipe(settleAll("ignore")),
})

// IGNORE RULES

export const DeleteUnmatchedIgnoreRule = Command.define("DeleteUnmatchedIgnoreRule", {
	args: { organizationId: OrganizationId, ruleId: CustomerIgnoreRuleId },
	messages: [Message.SucceededDeleteRule, Message.FailedDeleteRule],
	execute: ({ organizationId, ruleId }) =>
		HazelRpc.use((rpc) => rpc("customers.ignoreRule.delete", { organizationId, ruleId })).pipe(
			Effect.as(Message.SucceededDeleteRule({ ruleId })),
			// Already gone is what the delete wanted.
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.SucceededDeleteRule({ ruleId })),
			),
			catchCommon((reason) => Message.FailedDeleteRule({ ruleId, reason })),
		),
})
