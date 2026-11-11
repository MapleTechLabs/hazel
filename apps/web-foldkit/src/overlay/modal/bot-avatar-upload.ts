import type { File } from "foldkit/file"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { IconEdit } from "../../icons"
import { ALLOWED_AVATAR_TYPES } from "../../page/settings/upload"
import * as DropZone from "../../page/shared/drop-zone"
import { avatar } from "../../ui/avatar"
import { ariaButton } from "../../ui/button"
import { visuallyHiddenStyle } from "../../ui/checkbox"

/**
 * `components/bots/bot-avatar-upload.tsx` (DropZone > FileTrigger > Button): click or drop an image.
 * The modal owns the upload; this is its view. No crop step: the image is stored as picked, as for
 * the organization logo.
 */

export const BOT_AVATAR_INPUT_ID = "bot-avatar-input"

const squircle = "corner-shape: squircle;"

export interface BotAvatarUploadOptions<Message> {
	readonly name: string
	readonly avatarUrl: string | null
	readonly isUploading: boolean
	readonly dropZone: DropZone.Model
	readonly toDropZoneMessage: (message: DropZone.Message) => Message
	readonly onPress: Message
	readonly onFiles: (files: ReadonlyArray<File>) => Message
}

const overlay = <Message>(h: HtmlBuilder<Message>, isVisible: boolean, children: Array<Html>): Html =>
	h.div(
		[
			h.Class(
				cx(
					"absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 transition-opacity duration-200",
					isVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
				),
			),
			h.Attribute("style", squircle),
		],
		children,
	)

export const botAvatarUpload = <Message>(
	h: HtmlBuilder<Message>,
	options: BotAvatarUploadOptions<Message>,
): Html => {
	const isOver = options.dropZone.isOver
	return h.div(
		[h.Class(cx("relative inline-block"))],
		[
			h.div(
				[
					h.Class(
						"rounded-xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
					),
					...(options.isUploading
						? [h.DataAttribute("disabled", "true")]
						: DropZone.zoneAttributes(
								h,
								options.dropZone,
								options.toDropZoneMessage,
								options.onFiles,
							)),
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
							className: cx(
								"group relative size-24 cursor-pointer rounded-xl transition-all duration-200",
								options.isUploading && "pointer-events-none",
								isOver && "scale-105",
							),
							onPress: options.onPress,
							isPending: options.isUploading,
							attributes: [
								h.Attribute("style", squircle),
								h.AriaLabel("Change bot avatar"),
								h.Attribute("aria-busy", options.isUploading ? "true" : "false"),
							],
						},
						[
							// BotAvatar: the machine user's avatar, else the dithered initial of the name.
							avatar(h, {
								size: "4xl",
								src: options.avatarUrl,
								seed: options.name,
								alt: options.name ? `${options.name} avatar` : "Bot avatar",
								className: "transition-all duration-200",
							}),
							isOver
								? overlay(h, true, [
										h.span(
											[h.Class("font-medium text-white text-xs drop-shadow-md")],
											["Drop here"],
										),
									])
								: overlay(h, options.isUploading, [
										h.div(
											[h.Class("flex flex-col items-center gap-1")],
											[
												IconEdit(h, {
													className: "size-6 text-white drop-shadow-md",
												}),
												h.span(
													[
														h.Class(
															"font-medium text-white text-xs drop-shadow-md",
														),
													],
													[options.isUploading ? "Uploading..." : "Edit"],
												),
											],
										),
									]),
						],
					),
					h.input([
						h.Id(BOT_AVATAR_INPUT_ID),
						h.Type("file"),
						h.Attribute("accept", ALLOWED_AVATAR_TYPES.join(",")),
						h.Attribute("style", "display: none;"),
						h.OnFileChange((files) => options.onFiles(files)),
					]),
				],
			),
			h.p([h.Class("mt-2 text-center text-muted-fg text-xs")], ["Click or drop image"]),
		],
	)
}
