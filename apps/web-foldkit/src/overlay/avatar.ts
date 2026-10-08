import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { IconCircleDottedUser } from "../icons"
import { type AvatarSize, styles } from "../ui/avatar-styles"
import { avatar as kitAvatar } from "../ui/avatar"

/**
 * The legacy `Avatar` convenience wrapper's fallbacks the kit avatar does not render yet:
 * initials, a custom placeholder, and the default `IconCircleDottedUser`.
 */
export interface FallbackAvatarProps {
	readonly size?: AvatarSize
	readonly src?: string | null
	readonly alt?: string
	readonly initials?: string
	readonly placeholder?: Html
	readonly className?: string
}

export const fallbackAvatar = <Message>(h: HtmlBuilder<Message>, props: FallbackAvatarProps): Html => {
	const size = props.size ?? "md"
	if (props.src) return kitAvatar(h, { size, src: props.src, alt: props.alt, className: props.className })
	const fallback = props.initials
		? h.span([h.Class(cx("text-quaternary", styles[size].initials))], [props.initials])
		: (props.placeholder ??
			IconCircleDottedUser(h, { className: cx("text-muted-fg", styles[size].icon) }))
	return h.div(
		[
			h.Attribute("data-avatar", "true"),
			h.Attribute("data-slot", "avatar"),
			h.Class(
				cx(
					"relative inline-flex shrink-0 items-center justify-center overflow-visible bg-muted outline-transparent",
					"rounded-xl",
					styles[size].root,
					props.className,
				),
			),
			h.Attribute("style", "corner-shape: squircle;"),
		],
		[fallback],
	)
}
