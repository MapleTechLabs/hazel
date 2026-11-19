import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerOverviewLayoutId, OrganizationId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerOverviewLayoutCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { type LayoutWriteFailure, Message } from "./message"
import { DRY_RUN_DEBOUNCE_MS } from "./model"

/**
 * The layout pages' Commands: layout writes (each waits until its change has synced, so the list and
 * the editor show it at once), the debounced dry run behind "Who gets this layout", and the previewed
 * customer's detail (the built-in sections).
 */

/** Best effort: the write happened either way, and the rows show it once they arrive. */
const awaitSynced = (
	transactionId: Parameters<typeof customerOverviewLayoutCollection.utils.awaitSeqEffect>[0],
) => Effect.ignore(customerOverviewLayoutCollection.utils.awaitSeqEffect(transactionId))

const failWith =
	<M>(toMessage: (reason: LayoutWriteFailure) => M) =>
	(reason: LayoutWriteFailure) =>
		Effect.succeed(toMessage(reason))

/** At `position` (absent: first in the order). */
export const CreateOverviewLayout = Command.define("CreateOverviewLayout", {
	args: {
		organizationId: OrganizationId,
		layout: Customers.LayoutDraft,
		position: Schema.NullOr(Schema.Number),
	},
	messages: [Message.SucceededCreateLayout, Message.FailedCreateLayout],
	execute: ({ organizationId, layout, position }) => {
		const failed = failWith((reason) => Message.FailedCreateLayout({ reason }))
		return HazelRpc.use((rpc) =>
			rpc(
				"customers.layout.create",
				position === null ? { organizationId, layout } : { organizationId, layout, position },
			),
		).pipe(
			Effect.tap((result) => awaitSynced(result.transactionId)),
			Effect.as(Message.SucceededCreateLayout()),
			Effect.catchTag("CustomersInvalidRequestError", () => failed("Invalid")),
			catchCommon((reason) => Message.FailedCreateLayout({ reason })),
		)
	},
})

export const UpdateOverviewLayout = Command.define("UpdateOverviewLayout", {
	args: {
		organizationId: OrganizationId,
		layoutId: CustomerOverviewLayoutId,
		layout: Customers.LayoutDraft,
	},
	messages: [Message.SucceededUpdateLayout, Message.FailedUpdateLayout],
	execute: (args) => {
		const failed = failWith((reason) => Message.FailedUpdateLayout({ layoutId: args.layoutId, reason }))
		return HazelRpc.use((rpc) => rpc("customers.layout.update", args)).pipe(
			Effect.tap((result) => awaitSynced(result.transactionId)),
			Effect.as(Message.SucceededUpdateLayout({ layoutId: args.layoutId })),
			Effect.catchTags({
				CustomersNotFoundError: () => failed("NotFound"),
				CustomersInvalidRequestError: () => failed("Invalid"),
			}),
			catchCommon((reason) => Message.FailedUpdateLayout({ layoutId: args.layoutId, reason })),
		)
	},
})

/** Every non-default layout, in the new order. */
export const ReorderOverviewLayouts = Command.define("ReorderOverviewLayouts", {
	args: { organizationId: OrganizationId, layoutIds: Schema.Array(CustomerOverviewLayoutId) },
	messages: [Message.SucceededReorderLayouts, Message.FailedReorderLayouts],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("customers.layout.reorder", args)).pipe(
			Effect.tap((result) => awaitSynced(result.transactionId)),
			Effect.as(Message.SucceededReorderLayouts()),
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(Message.FailedReorderLayouts({ reason: "Invalid" })),
			),
			catchCommon((reason) => Message.FailedReorderLayouts({ reason })),
		),
})

export const DeleteOverviewLayout = Command.define("DeleteOverviewLayout", {
	args: { organizationId: OrganizationId, layoutId: CustomerOverviewLayoutId },
	messages: [Message.SucceededDeleteLayout, Message.FailedDeleteLayout],
	execute: (args) => {
		const failed = failWith((reason) => Message.FailedDeleteLayout({ layoutId: args.layoutId, reason }))
		return HazelRpc.use((rpc) => rpc("customers.layout.delete", args)).pipe(
			Effect.tap((result) => awaitSynced(result.transactionId)),
			Effect.as(Message.SucceededDeleteLayout({ layoutId: args.layoutId })),
			Effect.catchTags({
				CustomersNotFoundError: () => failed("NotFound"),
				CustomersInvalidRequestError: () => failed("Invalid"),
			}),
			catchCommon((reason) => Message.FailedDeleteLayout({ layoutId: args.layoutId, reason })),
		)
	},
})

/** The pause after a rule edit before the dry run reruns; a later edit's version supersedes it. */
export const WaitForLayoutDryRunDelay = Command.define("WaitForLayoutDryRunDelay", {
	args: { version: Schema.Int },
	messages: [Message.ElapsedLayoutDryRunDelay],
	execute: ({ version }) =>
		Effect.sleep(Duration.millis(DRY_RUN_DEBOUNCE_MS)).pipe(
			Effect.as(Message.ElapsedLayoutDryRunDelay({ version })),
		),
})

interface DryRunPayload {
	organizationId: OrganizationId
	rule: Customers.LayoutRule
	layoutId?: CustomerOverviewLayoutId
	position?: number
}

/** Who the draft rule matches at its place in the order, and who earlier layouts take. */
export const FetchLayoutDryRun = Command.define("FetchLayoutDryRun", {
	args: {
		organizationId: OrganizationId,
		version: Schema.Int,
		rule: Customers.LayoutRule,
		layoutId: Schema.NullOr(CustomerOverviewLayoutId),
		position: Schema.NullOr(Schema.Number),
	},
	messages: [Message.SucceededFetchLayoutDryRun, Message.FailedFetchLayoutDryRun],
	execute: ({ organizationId, version, rule, layoutId, position }) => {
		// Optional keys: absent, never undefined.
		const payload: DryRunPayload = { organizationId, rule }
		if (layoutId !== null) payload.layoutId = layoutId
		if (position !== null) payload.position = position
		return HazelRpc.use((rpc) => rpc("customers.layout.dryRun", payload)).pipe(
			Effect.map((result) => Message.SucceededFetchLayoutDryRun({ version, result })),
			catchCommon((reason) => Message.FailedFetchLayoutDryRun({ version, reason })),
		)
	},
})

/** The previewed customer's detail: what the built-in sections draw. */
export const FetchLayoutPreviewDetail = Command.define("FetchLayoutPreviewDetail", {
	args: { organizationId: OrganizationId, accountId: CustomerAccountId },
	messages: [Message.SucceededFetchPreviewDetail, Message.FailedFetchPreviewDetail],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("customers.account.detail", args)).pipe(
			Effect.map((detail) =>
				Message.SucceededFetchPreviewDetail({ accountId: args.accountId, detail }),
			),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(
					Message.FailedFetchPreviewDetail({ accountId: args.accountId, reason: "Unexpected" }),
				),
			),
			catchCommon((reason) => Message.FailedFetchPreviewDetail({ accountId: args.accountId, reason })),
		),
})
