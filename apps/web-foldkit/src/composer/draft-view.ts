import type { AttachmentId } from "@hazel/schema"
import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { formatFileSize, getFileTypeFromName } from "~/utils/file-utils"
import { fileIcon } from "../chat/file-icons"
import { IconClose, IconEdit } from "../icons"
import { button } from "../ui/button"
import { loader } from "../ui/loader"
import { fileInputId, hasTopContent, isUploading, Message, type Model } from "./draft"
import * as EmojiDialog from "../emoji-picker/dialog"
import { TrackFileDrop } from "./drop"
import { composerBoxView, type PickerButton } from "./view"

/** A draft's composer: `SlateMessageComposer` with previews, indicators, the drop zone and the actions. */

/** What `ReplyIndicator` shows: the replied-to author and first line. */
export interface ReplyPreview {
	readonly authorName: string
	readonly firstLine: string
}

export interface DraftViewInputs<M> {
	readonly toMessage: (message: Message) => M
	readonly replyPreview: ReplyPreview | null
	readonly attachmentInfo: (id: AttachmentId) => { readonly fileName: string; readonly fileSize: number } | null
	readonly gifTrigger?: (render: PickerButton) => Html
}

const removeButton = <M>(h: HtmlBuilder<M>, onPress: M, label?: string) =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-xs",
			...(label === undefined ? {} : { className: "!p-1" }),
			onPress,
			attributes: label === undefined ? [] : [h.Attribute("aria-label", label)],
		},
		[IconClose(h, { ...(label === undefined ? {} : { className: "size-3.5" }), attributes: { "data-slot": "icon" } })],
	)

/** `ComposerAttachmentPreviews`. */
const attachmentPreviews = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	if (model.attachmentIds.length === 0 && model.uploadingFiles.length === 0) return h.empty
	const card = (key: string, className: string, children: ReadonlyArray<Html>) =>
		h.keyed("div")(key, [h.Class(className)], children)
	const fileText = (name: string, detail: string) =>
		h.div(
			[h.Class("min-w-0 flex-1")],
			[
				h.div([h.Class("truncate font-medium text-fg text-sm")], [name]),
				h.div([h.Class("text-muted-fg text-xs")], [detail]),
			],
		)
	return h.div(
		[
			h.Class(
				cn(
					"border border-border border-b-0 bg-secondary px-2 py-1",
					model.uploadingFiles.length > 0 ? "rounded-t-none border-t-0" : "rounded-t-lg",
					model.replyToMessageId !== null && "border-b-0",
				),
			),
		],
		[
			h.div(
				[h.Class("grid grid-cols-2 gap-1 md:grid-cols-3 lg:grid-cols-4")],
				[
					...model.attachmentIds.map((attachmentId) => {
						const info = inputs.attachmentInfo(attachmentId)
						const fileName = info?.fileName || "File"
						return card(
							attachmentId,
							"group flex items-center gap-2 rounded-lg bg-bg p-2 transition-colors hover:bg-secondary",
							[
								fileIcon(h, getFileTypeFromName(fileName), { className: "size-8 shrink-0 text-muted-fg" }),
								fileText(fileName, formatFileSize(info?.fileSize || 0)),
								removeButton(h, inputs.toMessage(Message.ClickedRemoveAttachment({ attachmentId }))),
							],
						)
					}),
					...model.uploadingFiles.map((file) =>
						card(
							file.fileId,
							"group relative flex items-center gap-2 overflow-hidden rounded-lg bg-bg p-2 transition-colors hover:bg-secondary",
							[
								fileIcon(h, getFileTypeFromName(file.fileName), { className: "size-8 shrink-0 text-muted-fg" }),
								fileText(
									file.fileName,
									file.progress < 100
										? `${file.progress}% of ${formatFileSize(file.fileSize)}`
										: formatFileSize(file.fileSize),
								),
								loader(h, { className: "size-4" }),
								h.div(
									[h.Class("absolute inset-x-0 -bottom-px h-1 bg-muted")],
									[
										h.div([
											h.Class("h-full bg-primary transition-all duration-200"),
											h.Attribute("style", `width: ${file.progress}%;`),
										]),
									],
								),
							],
						),
					),
				],
			),
		],
	)
}

const indicatorClass = "flex items-center justify-between gap-2 rounded-t-lg border border-border border-b-0 bg-secondary px-3 py-2"

/** `ComposerReplyIndicator` (`ReplyIndicator`). */
const replyIndicator = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	const reply = inputs.replyPreview
	if (model.replyToMessageId === null || reply === null) return h.empty
	const hasFiles = model.uploadingFiles.length > 0 || model.attachmentIds.length > 0
	return h.div(
		[h.Class(cn(indicatorClass, hasFiles ? "rounded-t-none border-t-0" : ""))],
		[
			h.div(
				[h.Class("flex items-center gap-2 text-sm")],
				[
					h.span([h.Class("text-muted-fg")], ["Replying to"]),
					h.span([h.Class("font-semibold text-fg")], [reply.authorName]),
					h.span([h.Class("max-w-xs truncate text-muted-fg")], [reply.firstLine]),
				],
			),
			removeButton(h, inputs.toMessage(Message.ClickedCancelReply()), "Cancel reply"),
		],
	)
}

/** `ComposerEditIndicator`. */
const editIndicator = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	if (model.editingMessageId === null) return h.empty
	const hasFiles = model.uploadingFiles.length > 0 || model.attachmentIds.length > 0
	return h.div(
		[h.Class(cn(indicatorClass, hasFiles ? "rounded-t-none border-t-0" : ""))],
		[
			h.div(
				[h.Class("flex items-center gap-2 text-sm")],
				[
					IconEdit(h, { className: "size-3.5 text-primary" }),
					h.span([h.Class("font-semibold text-primary")], ["Editing message"]),
				],
			),
			removeButton(h, inputs.toMessage(Message.ClickedCancelEdit()), "Cancel editing"),
		],
	)
}

/** The drop zone's overlays: strong over the zone, subtle while dragging anywhere. */
const dropOverlay = <M>(h: HtmlBuilder<M>, model: Model): Html =>
	model.isDropTarget
		? h.div(
				[
					h.Class(
						"absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-primary border-dashed bg-primary/10",
					),
				],
				[h.span([h.Class("font-medium text-primary")], ["Drop files here"])],
			)
		: model.isDraggingOnPage
			? h.div(
					[
						h.Class(
							"absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-primary/50 border-dashed bg-primary/5",
						),
					],
					[h.span([h.Class("font-medium text-primary/70")], ["Drop files here"])],
				)
			: h.empty

export const draftView = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	const { toMessage } = inputs
	const uploading = isUploading(model)
	return composerBoxView(h, model.composer, {
		toMessage: (message) => toMessage(Message.GotComposerMessage({ message })),
		topContent: [
			attachmentPreviews(h, model, inputs),
			replyIndicator(h, model, inputs),
			editIndicator(h, model, inputs),
		],
		hasTopContent: hasTopContent(model),
		dropOverlay: dropOverlay(h, model),
		dropZoneAttributes: [
			h.OnMount(
				Mount.mapMessage(TrackFileDrop({ isDisabled: uploading }), (event) =>
					toMessage(Message.GotDropEvent({ event })),
				),
			),
		],
		fileInputAttributes: [
			h.Id(fileInputId(model)),
			h.OnFileChange((files) => toMessage(Message.SelectedFiles({ files }))),
		],
		attachAttributes: [
			h.OnClick(toMessage(Message.ClickedAttach())),
			...(uploading ? [h.Attribute("disabled", "")] : []),
		],
		...(inputs.gifTrigger === undefined ? {} : { gifTrigger: inputs.gifTrigger }),
		emojiTrigger: (render) =>
			EmojiDialog.view(h, model.emojiPicker, {
				toMessage: (message) => toMessage(Message.GotEmojiPickerMessage({ message })),
				toTrigger: render,
				customEmojis: model.composer.customEmojis,
			}),
	})
}
