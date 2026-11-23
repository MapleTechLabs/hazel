import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary"

const TONE = {
	neutral: "bg-muted-fg",
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
	info: "bg-info-subtle-fg",
	primary: "bg-primary",
} as const satisfies Readonly<Record<StatusTone, string>>

/** A 6px state dot (synced, failing, pending). `isPulsing` for work in flight. */
export const statusDot = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly tone: StatusTone; readonly isPulsing?: boolean; readonly className?: string },
): Html =>
	h.span([
		h.AriaHidden(true),
		h.Class(
			twMerge(
				"inline-block size-1.5 shrink-0 rounded-full",
				TONE[options.tone],
				options.isPulsing && "animate-pulse",
				options.className,
			),
		),
	])

/** `● Synced 1h ago`: a dot and a short muted line, announced as it changes. */
export const statusLine = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly tone: StatusTone; readonly isPulsing?: boolean; readonly className?: string },
	label: string,
): Html =>
	h.span(
		[
			h.AriaLive("polite"),
			h.Class(
				twMerge(
					"inline-flex items-center gap-1.5 whitespace-nowrap text-muted-fg text-xs",
					options.className,
				),
			),
		],
		[statusDot(h, { tone: options.tone, isPulsing: options.isPulsing }), label],
	)
