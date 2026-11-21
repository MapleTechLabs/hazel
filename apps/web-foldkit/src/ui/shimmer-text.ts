import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/**
 * Text for something still happening: "Thinking", a step that runs. While `isActive` a soft light
 * sweeps across muted text (the `shimmer` utility in styles.css); otherwise it is plain text in the
 * surrounding colour. Reduced motion leaves it still.
 */
export interface ShimmerTextOptions {
	readonly isActive?: boolean
	readonly className?: string
}

export const shimmerText = <Message>(
	h: HtmlBuilder<Message>,
	options: ShimmerTextOptions,
	text: string,
): Html =>
	h.span(
		[
			h.Class(twMerge((options.isActive ?? true) && "shimmer", options.className)),
			h.Attribute("data-slot", "shimmer-text"),
		],
		[text],
	)
