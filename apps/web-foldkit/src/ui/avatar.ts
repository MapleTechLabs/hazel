import type { Html, HtmlBuilder } from "foldkit/html"
import { type AvatarSize, styles } from "~/components/ui/avatar/styles"
import { cx } from "~/utils/cx"
import { IconCircleDottedUser } from "../icons"
import { ditherAvatar } from "./dither-avatar"

/**
 * Port of `components/ui/avatar`: the image, else a dithered initial seeded by `seed`.
 */
export interface AvatarProps {
	readonly size?: AvatarSize
	readonly src?: string | null
	readonly alt?: string
	readonly seed?: string
	readonly isSquare?: boolean
	readonly className?: string
	readonly badge?: Html
	/** Legacy `initials`: shown when there is no image and no seed. */
	readonly initials?: string
	/** Custom fallback shown when there is no image, seed or initials. */
	readonly placeholder?: Html
	/** Legacy default fallback (IconCircleDottedUser) when nothing else applies; opt-in here. */
	readonly fallbackIcon?: boolean
}

export const avatar = <Message>(h: HtmlBuilder<Message>, props: AvatarProps): Html => {
	const { size = "md", isSquare = true, src, seed } = props
	const rounded = isSquare ? "rounded-xl" : "rounded-3xl"
	// `corner-shape` is not a CSSStyleDeclaration property, so Foldkit's h.Style rejects it; React writes it as raw style text.
	const squircle = h.Attribute("style", "corner-shape: squircle;")
	const content: Html[] = src
		? [
				h.img([
					h.Attribute("data-avatar-img", ""),
					h.Class(cx("size-full object-cover", rounded)),
					squircle,
					h.Attribute("src", src),
					h.Attribute("alt", props.alt ?? ""),
				]),
			]
		: seed
			? [
					h.div(
						[h.Class(cx("absolute inset-0 overflow-hidden", rounded)), squircle],
						[ditherAvatar(h, seed, styles[size].px)],
					),
				]
			: props.initials
				? [h.span([h.Class(cx("text-quaternary", styles[size].initials))], [props.initials])]
				: props.placeholder
					? [props.placeholder]
					: props.fallbackIcon
						? [IconCircleDottedUser(h, { className: cx("text-muted-fg", styles[size].icon) })]
						: []
	return h.div(
		[
			h.Attribute("data-avatar", "true"),
			h.Attribute("data-slot", "avatar"),
			h.Class(
				cx(
					"relative inline-flex shrink-0 items-center justify-center overflow-visible bg-muted outline-transparent",
					rounded,
					styles[size].root,
					props.className,
				),
			),
			squircle,
		],
		props.badge ? [...content, h.span([h.Class("absolute right-0 bottom-0")], [props.badge])] : content,
	)
}
