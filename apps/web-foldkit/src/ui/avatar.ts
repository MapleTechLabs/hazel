import type { Html, HtmlBuilder } from "foldkit/html"
import { styles, type AvatarSize } from "./avatar-styles"
import { cx } from "~/utils/cx"
import { facehash } from "./facehash"

/**
 * Port of `components/ui/avatar` (image or facehash fallback). Same classes via the
 * same `cx` (tailwind-merge), so the class strings match the legacy DOM exactly.
 */
export interface AvatarProps {
	readonly size?: AvatarSize
	readonly src?: string | null
	readonly alt?: string
	readonly seed?: string
	readonly isSquare?: boolean
	readonly className?: string
	readonly badge?: Html
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
						[facehash(h, seed)],
					),
				]
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
