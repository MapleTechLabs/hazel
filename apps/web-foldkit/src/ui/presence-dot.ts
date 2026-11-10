import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import type { PresenceStatus } from "~/utils/presence"
import { getStatusDotColor, getStatusLabel } from "~/utils/status"

/** Dot size per avatar size it sits on: about a third of the avatar, as Discord does. */
const SIZES = {
	xs: "size-2.5 ring-2",
	sm: "size-3 ring-[2.5px]",
} as const

export type PresenceDotSize = keyof typeof SIZES

/**
 * The online / away / dnd / offline dot for an avatar's `badge`. Offline is a hollow ring so it reads
 * as "not here" on both themes; the `ring-bg` cuts the dot out of the avatar's corner.
 */
export const presenceDot = <M>(
	h: HtmlBuilder<M>,
	status: PresenceStatus,
	size: PresenceDotSize = "xs",
): Html => {
	const label = getStatusLabel(status)
	return h.span([
		h.Class(
			cx(
				"block translate-x-1/4 translate-y-1/4 rounded-full ring-bg",
				SIZES[size],
				getStatusDotColor(status),
			),
		),
		h.Attribute("role", "img"),
		h.Attribute("aria-label", label),
		h.Attribute("title", label),
	])
}
