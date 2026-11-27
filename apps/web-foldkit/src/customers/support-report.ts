/**
 * The Support report on the client (`customers.support.report`, `docs/customers/sla.md` §4): the RPC,
 * and how its numbers read (the customer page; the report page and the overview are native now).
 */
import type * as Customers from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { HazelRpc } from "../rpc"
import { formatSlaDuration } from "./sla"

/** First response and resolution times, % within SLA and breaches for issues opened in `range`. */
export const fetchSupportReport = (organizationId: OrganizationId, range: Customers.CustomersRange) =>
	HazelRpc.use((rpc) => rpc("customers.support.report", { organizationId, range }))

/** `47m`, `3h 10m`; `—` when nothing finished. */
export const formatResponse = (ms: number | null): string => (ms === null ? "—" : formatSlaDuration(ms))

/** `86%`; `—` when nothing finished. */
export const formatWithin = (share: number | null): string =>
	share === null ? "—" : `${Math.round(share * 100)}%`
