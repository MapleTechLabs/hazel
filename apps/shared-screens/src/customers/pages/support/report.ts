// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The Support report on the client (`customers.support.report`, `docs/customers/sla.md` §4): the
 * query the report page and the overview's Support card share, and how its numbers read.
 */
import { Query } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { CommonReason, reasonOf } from "../../../modals/feedback"
import { formatSlaDuration } from "../../data/sla"

/**
 * First response and resolution times, % within SLA and breaches for issues opened in `range`.
 * `attempt` counts "Try again": a failed report is fetched again under a new key.
 */
export class GetSupportReport extends Query.Service<GetSupportReport>()("hazel/customers/GetSupportReport", {
	args: { organizationId: OrganizationId, range: Customers.CustomersRange, attempt: Schema.Finite },
	success: Customers.SupportReport,
	error: CommonReason,
	staleTime: "1 minute",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId, range }) =>
				rpc("customers.support.report", { organizationId, range }).pipe(
					Effect.tapError((error) => Effect.logWarning("support report failed", error)),
					Effect.mapError(reasonOf),
				)
		}),
	)
}

/** The dash for a number nothing finished yet (U+2014, as today). */
export const NO_VALUE = "\u2014"

/** `47m`, `3h 10m`; the dash when nothing finished. */
export const formatResponse = (ms: number | null): string => (ms === null ? NO_VALUE : formatSlaDuration(ms))

/** `86%`; the dash when nothing finished. */
export const formatWithin = (share: number | null): string =>
	share === null ? NO_VALUE : `${Math.round(share * 100)}%`

/** Nothing opened under an SLA in the range, and nothing overdue from before it. */
export const isEmptyReport = (report: Customers.SupportReport): boolean =>
	report.issues === 0 && report.overdueNow === 0
