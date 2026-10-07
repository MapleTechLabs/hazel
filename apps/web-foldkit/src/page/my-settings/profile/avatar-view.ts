import { Option } from "effect"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { IconEdit } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { ariaButton, button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import { loader } from "../../../ui/loader"
import * as Modal from "../../../ui/modal"
import { cropArea } from "./crop"
import { Message } from "./message"
import { AVATAR_BUTTON, FILE_INPUT_ID, type Model } from "./model"
import { interaction, toCropModalMessage } from "./update"

/** Port of `components/profile/profile-picture-upload.tsx` and `avatar-crop-modal.tsx`. */

const squircle = <M>(h: HtmlBuilder<M>) => h.Attribute("style", "corner-shape: squircle;")
const ALLOWED_TYPES = "image/jpeg,image/png,image/webp"

const dropOverlay = <M>(h: HtmlBuilder<M>, label: string, labelClassName: string) =>
	h.div(
		[
			h.Class(
				"absolute inset-0 flex items-center justify-center rounded-xl border-2 border-primary border-dashed bg-primary/20 backdrop-blur-sm",
			),
			squircle(h),
		],
		[h.span([h.Class(labelClassName)], [label])],
	)

const editOverlay = <M>(h: HtmlBuilder<M>, isUploading: boolean) =>
	h.div(
		[
			h.Class(
				cx(
					"absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 transition-opacity duration-200",
					isUploading ? "opacity-100" : "opacity-0 group-hover:opacity-100",
				),
			),
			squircle(h),
		],
		[
			isUploading
				? h.div(
						[h.Class("flex flex-col items-center gap-2")],
						[
							loader(h, { className: "size-6 text-white drop-shadow-md" }),
							h.span(
								[h.Class("font-medium text-white text-xs drop-shadow-md")],
								["Uploading..."],
							),
						],
					)
				: h.div(
						[h.Class("flex flex-col items-center gap-1")],
						[
							IconEdit(h, { className: "size-6 text-white drop-shadow-md" }),
							h.span([h.Class("font-medium text-white text-xs drop-shadow-md")], ["Edit"]),
						],
					),
		],
	)

export const profilePictureUpload = (
	h: HtmlBuilder<Message>,
	model: Model,
	user: { readonly avatarUrl: string | null; readonly initials: string },
): Html => {
	const wiring = interaction.wiring(model)
	const isDraggingOnPage = model.dragDepth > 0
	return h.div(
		[h.Class("relative inline-block")],
		[
			h.div(
				[
					h.Class(
						"rounded-xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
					),
					h.DataAttribute("rac", ""),
					...(model.isDropTarget ? [h.DataAttribute("drop-target", "true")] : []),
					...(model.isUploading
						? [h.DataAttribute("disabled", "true")]
						: [
								h.OnDragEnter(Message.EnteredDropZone()),
								h.OnDragLeave(Message.LeftDropZone()),
								h.OnDragOver(Message.EnteredDropZone()),
								h.OnDropFiles((files) => Message.SelectedAvatarFiles({ files })),
							]),
				],
				[
					h.div(
						[
							h.Attribute(
								"style",
								"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;",
							),
						],
						[
							h.button([
								h.AriaLabel("DropZone"),
								h.Attribute("aria-labelledby", ""),
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
								model.isUploading && "pointer-events-none",
								model.isDropTarget && "scale-105",
							),
							onPress: Message.ClickedAvatar(),
							interaction: { wiring, target: AVATAR_BUTTON },
							attributes: [
								squircle(h),
								h.AriaLabel("Change profile picture"),
								...(model.isUploading ? [h.Attribute("aria-busy", "true")] : []),
							],
						},
						[
							avatar(h, {
								src: user.avatarUrl,
								alt: "Your profile picture",
								initials: user.initials,
								size: "4xl",
								className: "transition-all duration-200",
							}),
							...(model.isDropTarget
								? [
										dropOverlay(
											h,
											"Drop here",
											"font-medium text-white text-xs drop-shadow-md",
										),
									]
								: []),
							...(isDraggingOnPage && !model.isDropTarget
								? [dropOverlay(h, "Drop image", "font-medium text-fg text-xs")]
								: []),
							...(!model.isDropTarget && !isDraggingOnPage
								? [editOverlay(h, model.isUploading)]
								: []),
							...(model.isUploading
								? [
										h.div(
											[
												h.Class(
													"absolute right-0 bottom-0 left-0 h-1 overflow-hidden rounded-b-xl bg-white/20",
												),
											],
											[
												h.div(
													[
														h.Class(
															"h-full bg-white transition-[width] duration-150",
														),
														h.Style({ width: "50%" }),
													],
													[],
												),
											],
										),
									]
								: []),
						],
					),
					h.input([
						h.Id(FILE_INPUT_ID),
						h.Type("file"),
						h.Attribute("accept", ALLOWED_TYPES),
						h.Class(""),
						h.DataAttribute("rac", ""),
						h.Style({ display: "none" }),
						h.OnFileChange((files) => Message.SelectedAvatarFiles({ files })),
					]),
				],
			),
			h.p([h.Class("mt-2 text-center text-muted-fg text-xs")], ["Click or drop image"]),
			h.button(
				[
					h.Type("button"),
					h.OnClick(Message.ClickedResetAvatar()),
					h.Disabled(model.isResetting || model.isUploading),
					h.Class(
						"mt-1 w-full text-center text-muted-fg text-xs underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50",
					),
				],
				[model.isResetting ? "Resetting..." : "Reset to account photo"],
			),
			Modal.controlledModal(h, {
				model: model.cropModal,
				toParentMessage: toCropModalMessage,
				toContent: (closeAttributes) => cropContent(h, model, closeAttributes),
				size: "lg",
				isDismissable: model.crop._tag !== "Processing",
			}),
		],
	)
}

const cropContent = (
	h: HtmlBuilder<Message>,
	model: Model,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const crop = model.crop
	const image =
		crop._tag === "Ready" || crop._tag === "Processing" ? Option.some(crop.image) : Option.none()
	const isProcessing = crop._tag === "Processing"
	const isReady = Option.isSome(image)
	return [
		dialogHeader(h, { title: { id: Modal.titleId(model.cropModal.id), text: "Crop profile picture" } }),
		dialogBody(
			h,
			[
				Option.match(image, {
					onNone: () =>
						h.div(
							[h.Class("flex h-64 items-center justify-center")],
							[loader(h, { className: "size-8" })],
						),
					onSome: (ready) =>
						cropArea(h, ready, (mode, clientX, clientY) =>
							Message.PressedCropHandle({ mode, clientX, clientY }),
						),
				}),
			],
			"flex items-center justify-center py-6",
		),
		dialogFooter(h, [
			dialogClose(h, closeAttributes, [
				button(
					h,
					{ intent: "outline", onPress: Message.ClickedCancelCrop(), isDisabled: isProcessing },
					["Cancel"],
				),
			]),
			button(h, { onPress: Message.ClickedSaveCrop(), isDisabled: !isReady || isProcessing }, [
				...(isProcessing ? [loader(h, {}), "Saving..."] : ["Save"]),
			]),
		]),
	]
}
