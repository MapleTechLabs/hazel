import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

export type IconTileIntent = "neutral" | "primary" | "danger" | "warning" | "success"
export type IconTileSize = "sm" | "md" | "lg"

const INTENT = {
	neutral: "border-border bg-secondary text-muted-fg",
	primary: "border-primary/10 bg-primary/5 text-primary",
	danger: "border-danger/10 bg-danger/5 text-danger",
	warning: "border-warning/20 bg-warning-subtle text-warning-subtle-fg",
	success: "border-success/20 bg-success-subtle text-success-subtle-fg",
} as const satisfies Readonly<Record<IconTileIntent, string>>

const SIZE = {
	sm: "size-8 rounded-lg *:size-4",
	md: "size-10 rounded-lg *:size-5",
	lg: "size-12 rounded-xl *:size-6",
} as const satisfies Readonly<Record<IconTileSize, string>>

/**
 * A glyph on a tinted square: what heads a confirm dialog (danger), an empty state (neutral) or an
 * integration card. The tile sizes the glyph; pass the icon without a size class.
 */
export const iconTile = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly intent?: IconTileIntent; readonly size?: IconTileSize; readonly className?: string },
	icon: Html,
): Html =>
	h.div(
		[
			h.AriaHidden(true),
			h.Class(
				twMerge(
					"flex shrink-0 items-center justify-center border",
					INTENT[options.intent ?? "neutral"],
					SIZE[options.size ?? "lg"],
					options.className,
				),
			),
		],
		[icon],
	)
