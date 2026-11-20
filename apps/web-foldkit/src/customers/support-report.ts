/**
 * The Support report on the client (`customers.support.report`, `docs/customers/sla.md` §4): the RPC,
 * how its numbers read, and the four tiles the Customers overview and the report page share.
 */
import type * as Customers from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { HazelRpc } from "../rpc"
import { formatCount } from "./format"
import { formatSlaDuration } from "./sla"
import { kpiTile } from "./ui/kpi-tile"

/** First response and resolution times, % within SLA and breaches for issues opened in `range`. */
export const fetchSupportReport = (organizationId: OrganizationId, range: Customers.CustomersRange) =>
	HazelRpc.use((rpc) => rpc("customers.support.report", { organizationId, range }))

/** `47m`, `3h 10m`; `—` when nothing finished. */
export const formatResponse = (ms: number | null): string => (ms === null ? "—" : formatSlaDuration(ms))

/** `86%`; `—` when nothing finished. */
export const formatWithin = (share: number | null): string =>
	share === null ? "—" : `${Math.round(share * 100)}%`

export const SUPPORT_TILE_LABELS = [
	"Median first response",
	"P90 first response",
	"Within SLA",
	"Breaches",
] as const

/**
 * Median and P90 first response, % within SLA (first response), and breaches with "N overdue
 * now". Loading while `report` is undefined; each tile links to `href` when given.
 */
export const supportTiles = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		report: Customers.SupportReport | undefined
		idPrefix: string
		href?: string
		/** In place of the numbers when the report failed: a retry. */
		failure?: Html
	}>,
): ReadonlyArray<Html> => {
	const { report, idPrefix, href } = options
	const link = { href, linkLabel: "open the Support report" }
	if (report === undefined)
		return SUPPORT_TILE_LABELS.map((label, index) =>
			kpiTile(h, {
				id: `${idPrefix}-${index}`,
				label,
				state: options.failure === undefined ? "loading" : "empty",
				emptyAction: index === 0 ? options.failure : undefined,
			}),
		)
	const answered = report.firstResponse.count
	return [
		kpiTile(h, {
			...link,
			id: `${idPrefix}-median`,
			label: "Median first response",
			definition:
				"Half the issues opened in the range had a first team reply within this much working time.",
			value: formatResponse(report.firstResponse.medianMs),
			detail: answered === 0 ? undefined : `${formatCount(answered)} answered`,
		}),
		kpiTile(h, {
			...link,
			id: `${idPrefix}-p90`,
			label: "P90 first response",
			definition:
				"Nine in ten issues opened in the range had a first team reply within this much working time.",
			value: formatResponse(report.firstResponse.p90Ms),
		}),
		kpiTile(h, {
			...link,
			id: `${idPrefix}-within`,
			label: "Within SLA",
			definition: "Share of first replies sent before their policy's first-response target.",
			value: formatWithin(report.firstResponse.withinPct),
			detail: "first response",
		}),
		kpiTile(h, {
			...link,
			id: `${idPrefix}-breaches`,
			label: "Breaches",
			definition:
				"Issues opened in the range that missed a target: answered or resolved late, or overdue now.",
			value: formatCount(report.breaches),
			detail: `${formatCount(report.overdueNow)} overdue now`,
		}),
	]
}
