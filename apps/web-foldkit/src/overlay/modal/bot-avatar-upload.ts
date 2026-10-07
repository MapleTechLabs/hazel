import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { IconEdit } from "../../icons"
import { avatar } from "../../ui/avatar"
import { ariaButton } from "../../ui/button"
import { visuallyHiddenStyle } from "../../ui/checkbox"

/**
 * Idle DOM of `components/bots/bot-avatar-upload.tsx` (DropZone > FileTrigger > Button). The
 * upload itself (file picker, drop, crop modal, presigned upload) is not ported yet.
 */

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const squircle = "corner-shape: squircle;"

export interface BotAvatarUploadOptions {
	readonly name: string
	readonly avatarUrl: string | null
}

export const botAvatarUpload = <Message>(h: HtmlBuilder<Message>, options: BotAvatarUploadOptions): Html =>
	h.div(
		[h.Class(cx("relative inline-block"))],
		[
			h.div(
				[
					h.Class("rounded-xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"),
					h.DataAttribute("rac", ""),
				],
				[
					h.div(
						[h.Attribute("style", visuallyHiddenStyle)],
						[
							h.button([
								h.AriaLabel("DropZone"),
								h.DataAttribute("react-aria-pressable", "true"),
								h.Tabindex(0),
								h.Type("button"),
							]),
						],
					),
					ariaButton(
						h,
						{
							className: cx("group relative size-24 cursor-pointer rounded-xl transition-all duration-200"),
							attributes: [
								h.Attribute("style", squircle),
								h.AriaLabel("Change bot avatar"),
								h.Attribute("aria-busy", "false"),
							],
						},
						[
							// BotAvatar: the machine user's avatar, else the facehash of the name.
							avatar(h, {
								size: "4xl",
								src: options.avatarUrl,
								seed: options.name,
								alt: options.name ? `${options.name} avatar` : "Bot avatar",
								className: "transition-all duration-200",
							}),
							h.div(
								[
									h.Class(
										cx(
											"absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 transition-opacity duration-200",
											"opacity-0 group-hover:opacity-100",
										),
									),
									h.Attribute("style", squircle),
								],
								[
									h.div(
										[h.Class("flex flex-col items-center gap-1")],
										[
											IconEdit(h, { className: "size-6 text-white drop-shadow-md" }),
											h.span([h.Class("font-medium text-white text-xs drop-shadow-md")], ["Edit"]),
										],
									),
								],
							),
						],
					),
					h.input([
						h.Type("file"),
						h.Attribute("accept", ALLOWED_TYPES.join(",")),
						h.Attribute("style", "display: none;"),
					]),
				],
			),
			h.p([h.Class("mt-2 text-center text-muted-fg text-xs")], ["Click or drop image"]),
		],
	)
