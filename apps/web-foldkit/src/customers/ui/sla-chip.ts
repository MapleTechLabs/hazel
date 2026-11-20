import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconCheck, IconCirclePause, IconClock } from "../../icons"
import { badge } from "../../ui/badge"
import { type IssueSlaRow, slaChipCopy, slaDisplayOf, type SlaTone } from "../sla"

/**
 * An issue's SLA chip (`docs/customers/sla.md` §3): "Reply due in 3h 10m", "Reply overdue by 1h",
 * "Paused · waiting on customer", "First reply in 8m". Quiet while on time, warning when due soon,
 * danger once breached; nothing without a policy. Re-renders with the shared 30 s clock.
 */

const INTENT = {
	quiet: "outline",
	warning: "warning",
	danger: "danger",
	muted: "secondary",
	met: "outline",
} as const satisfies Record<SlaTone, string>

const TONE_CLASS = {
	quiet: "[--badge-fg:var(--color-muted-fg)]",
	warning: "",
	danger: "",
	muted: "[--badge-fg:var(--color-muted-fg)]",
	met: "[--badge-fg:var(--color-success-subtle-fg)]",
} as const satisfies Record<SlaTone, string>

const iconOf = <M>(h: HtmlBuilder<M>, tone: SlaTone): Html => {
	const attributes = { "data-slot": "icon" }
	return tone === "muted"
		? IconCirclePause(h, { attributes })
		: tone === "met"
			? IconCheck(h, { attributes })
			: IconClock(h, { attributes })
}

/** The chip for an issue's SLA row at `nowMs`; empty when it shows nothing. */
export const slaChip = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		sla: IssueSlaRow | undefined
		nowMs: number
		/** Words a pause: on hold, else waiting on the customer. */
		status?: Customers.IssueStatus
		className?: string
	}>,
): Html => {
	const sla = options.sla
	if (sla === undefined) return h.empty
	const copy = slaChipCopy(slaDisplayOf(sla, options.nowMs), {
		policyName: sla.policyName,
		nowMs: options.nowMs,
		status: options.status,
	})
	if (copy === null) return h.empty
	return badge(
		h,
		{
			intent: INTENT[copy.tone],
			className: twMerge("max-w-full", TONE_CLASS[copy.tone], options.className),
			attributes: [h.Title(copy.title), h.DataAttribute("sla", copy.tone)],
		},
		[iconOf(h, copy.tone), h.span([h.Class("truncate")], [copy.text])],
	)
}
