import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconCheck, IconWarning } from "../icons"

export type CalloutIntent = "info" | "success" | "warning" | "danger"

const INTENT = {
	info: "border-info-subtle-fg/15 bg-info-subtle text-info-subtle-fg",
	success: "border-success/20 bg-success-subtle text-success-subtle-fg",
	warning: "border-warning/20 bg-warning-subtle text-warning-subtle-fg",
	danger: "border-danger/15 bg-danger-subtle text-danger-subtle-fg",
} as const satisfies Readonly<Record<CalloutIntent, string>>

/** `info` carries no glyph by default: the tint is enough for a note. */
const GLYPH = {
	info: null,
	success: IconCheck,
	warning: IconWarning,
	danger: IconWarning,
} as const

/**
 * A note inline in a page or dialog: a warning before a destructive step, a stale-data notice, a
 * one-time secret. `danger` is announced as an alert, the rest as a status. Actions sit under the
 * text.
 */
export const callout = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly intent?: CalloutIntent
		readonly title?: string
		/** Replaces the intent's glyph; `null` drops it. */
		readonly icon?: Html | null
		readonly actions?: ReadonlyArray<Html>
		readonly className?: string
	},
	children: ReadonlyArray<Html | string> = [],
): Html => {
	const intent = options.intent ?? "info"
	const glyph = GLYPH[intent]
	const icon =
		options.icon !== undefined
			? options.icon
			: glyph === null
				? null
				: glyph(h, { className: "mt-0.5 size-4 shrink-0" })
	return h.div(
		[
			h.Role(intent === "danger" ? "alert" : "status"),
			h.Class(twMerge("flex gap-3 rounded-lg border p-3 text-sm", INTENT[intent], options.className)),
		],
		[
			...(icon === null ? [] : [icon]),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-1")],
				[
					...(options.title === undefined ? [] : [h.p([h.Class("font-medium")], [options.title])]),
					...(children.length === 0 ? [] : [h.div([h.Class("opacity-90")], [...children])]),
					...(options.actions === undefined || options.actions.length === 0
						? []
						: [h.div([h.Class("mt-2 flex flex-wrap items-center gap-2")], [...options.actions])]),
				],
			),
		],
	)
}
