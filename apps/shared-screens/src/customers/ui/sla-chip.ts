// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * An issue's SLA chip (today's `web-foldkit/src/customers/ui/sla-chip.ts`, `docs/customers/sla.md`
 * §3): "Reply due in 3h 10m", "Reply overdue by 1h", "Paused · waiting on customer". Quiet while on
 * time, warning when due soon, danger once breached; nothing without a policy.
 */
import type * as Customers from "@hazel/domain/customers"
import type { BadgeStyle, BadgeTone, Hazel } from "@hazel/ui/vocabulary/index"
import { type IssueSlaRow, slaChipCopy, slaDisplayOf, type SlaTone } from "../data/sla"

/** Today's badge intents per tone, as the badge recipe maps them. */
const LOOK = {
	// HAZEL-GAP(p4-customers-badge-quiet-outline): today's `quiet` is outlined with muted ink; `outline` keeps the default ink.
	quiet: { tone: "neutral", style: "outline" },
	warning: { tone: "warning", style: "solid" },
	danger: { tone: "danger", style: "solid" },
	paused: { tone: "neutral", style: "quiet" },
	met: { tone: "success", style: "outline" },
	late: { tone: "neutral", style: "solid" },
} as const satisfies Record<SlaTone, { tone: BadgeTone; style: BadgeStyle }>

/** The chip for an issue's SLA row at `nowMs`; `null` when it shows nothing. */
export const slaChip = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		sla: IssueSlaRow | undefined
		nowMs: number
		/** Words a pause: on hold, else waiting on the customer. */
		status?: Customers.IssueStatus
	}>,
) => {
	const sla = options.sla
	if (sla === undefined) return null
	const copy = slaChipCopy(slaDisplayOf(sla, options.nowMs), {
		policyName: sla.policyName,
		nowMs: options.nowMs,
		status: options.status,
	})
	if (copy === null) return null
	// HAZEL-GAP(p4-customers-badge-icon): today's chip leads with a clock, pause or check glyph.
	// HAZEL-GAP(p4-customers-badge-title): today's chip names its policy and due time on hover (`copy.title`); `badge` has no tooltip, and `tooltip` around it would change its box.
	return h.badge.tone(LOOK[copy.tone].tone).style(LOOK[copy.tone].style).label(copy.text)
}
