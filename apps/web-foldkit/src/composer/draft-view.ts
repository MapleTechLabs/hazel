import type { AttachmentId } from "@hazel/schema"
import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { formatFileSize, getFileTypeFromName } from "~/utils/file-utils"
import { isImageFileName } from "../chat/attachments"
import { fileIcon } from "../chat/file-icons"
import { IconClose, IconEdit } from "../icons"
import { button } from "../ui/button"
import { loader } from "../ui/loader"
import { fileInputId, hasTopContent, isUploading, Message, type Model, ShowLocalImage } from "./draft"
import * as EmojiDialog from "../emoji-picker/dialog"
import * as GifPickerView from "../gif-picker/view"
import { DragState, TrackFileDrop } from "./drop"
import { composerBoxView } from "./view"

/** A draft's composer: `SlateMessageComposer` with previews, indicators, the drop zone and the actions. */

/** What `ReplyIndicator` shows: the replied-to author and first line. */
export interface ReplyPreview {
	readonly authorName: string
	readonly firstLine: string
}

export interface DraftViewInputs<M> {
	readonly toMessage: (message: Message) => M
	readonly replyPreview: ReplyPreview | null
	readonly attachmentInfo: (
		id: AttachmentId,
	) => { readonly fileName: string; readonly fileSize: number; readonly url: string } | null
}

const removeButton = <M>(h: HtmlBuilder<M>, onPress: M, label: string, isCompact = false) =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-xs",
			...(isCompact ? { className: "!p-1" } : {}),
			onPress,
			attributes: [h.AriaLabel(label)],
		},
		[
			IconClose(h, {
				...(isCompact ? { className: "size-3.5" } : {}),
				attributes: { "data-slot": "icon" },
			}),
		],
	)

/** The image's source: the uploaded attachment's URL, or the local file while it uploads. */
type ImageSource =
	| { readonly _tag: "Url"; readonly url: string }
	| { readonly _tag: "File"; readonly file: File }

const thumbnail = <M>(
	h: HtmlBuilder<M>,
	toMessage: (message: Message) => M,
	source: ImageSource,
	fileName: string,
): Html =>
	h.img([
		...(source._tag === "Url"
			? [h.Src(source.url)]
			: [h.OnMount(Mount.mapMessage(ShowLocalImage({ file: source.file }), toMessage))]),
		h.Attribute("alt", fileName),
		h.Attribute("draggable", "false"),
		h.Class("max-h-full max-w-full rounded-sm object-contain"),
	])

/**
 * `ComposerAttachmentPreviews`, as Discord lays them out: one row of tiles of one size, scrolling
 * sideways. A tile shows the image whole (fitted, never cropped) or the file's icon, its name under
 * it, and the remove button on its corner. A file still uploading shows a spinner and its progress.
 */
const attachmentPreviews = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	const uploading = model.currentUpload === null ? [] : [model.currentUpload]
	if (model.attachmentIds.length === 0 && uploading.length === 0) return h.empty
	const preview = (fileName: string, source: ImageSource | null) =>
		source !== null && isImageFileName(fileName)
			? thumbnail(h, inputs.toMessage, source, fileName)
			: fileIcon(h, getFileTypeFromName(fileName), { className: "size-14 text-muted-fg" })
	const tile = (options: {
		readonly key: string
		readonly fileName: string
		readonly detail: string
		readonly preview: Html
		readonly overlay: ReadonlyArray<Html>
		readonly corner: Html
	}) =>
		h.keyed("div")(
			options.key,
			[h.Class("relative flex w-44 shrink-0 flex-col gap-2 rounded-lg border border-border bg-bg p-2")],
			[
				h.div(
					[
						h.Class(
							"relative flex h-32 items-center justify-center overflow-hidden rounded-md bg-secondary",
						),
					],
					[options.preview, ...options.overlay],
				),
				h.div(
					[h.Class("min-w-0 px-0.5")],
					[
						h.div([h.Class("truncate font-medium text-fg text-sm")], [options.fileName]),
						h.div([h.Class("truncate text-muted-fg text-xs")], [options.detail]),
					],
				),
				options.corner,
			],
		)
	const corner = (children: ReadonlyArray<Html>) =>
		h.div([h.Class("absolute top-1 right-1 rounded-md border border-border bg-bg shadow-xs")], children)
	return h.keyed("div")(
		"attachment-previews",
		[
			h.Class(
				cn(
					"border border-border border-b-0 bg-secondary",
					uploading.length > 0 ? "rounded-t-none border-t-0" : "rounded-t-lg",
					model.composeMode._tag === "Replying" && "border-b-0",
				),
			),
		],
		[
			h.div(
				[h.Class("flex gap-2 overflow-x-auto p-2")],
				[
					...model.attachmentIds.map((attachmentId) => {
						const info = inputs.attachmentInfo(attachmentId)
						const fileName = info?.fileName || "File"
						return tile({
							key: attachmentId,
							fileName,
							detail: formatFileSize(info?.fileSize || 0),
							preview: preview(fileName, info === null ? null : { _tag: "Url", url: info.url }),
							overlay: [],
							corner: corner([
								removeButton(
									h,
									inputs.toMessage(Message.ClickedRemoveAttachment({ attachmentId })),
									`Remove ${fileName}`,
								),
							]),
						})
					}),
					...uploading.map((upload) =>
						tile({
							key: upload.fileId,
							fileName: upload.file.name,
							detail:
								upload.progress < 100
									? `${upload.progress}% of ${formatFileSize(upload.file.size)}`
									: formatFileSize(upload.file.size),
							preview: preview(upload.file.name, { _tag: "File", file: upload.file }),
							overlay: [
								h.div(
									[h.Class("absolute inset-0 flex items-center justify-center bg-bg/40")],
									[loader(h, { className: "size-5" })],
								),
								h.div(
									[h.Class("absolute inset-x-0 bottom-0 h-1 bg-muted")],
									[
										h.div([
											h.Class("h-full bg-primary transition-[width] duration-200"),
											h.Attribute("style", `width: ${upload.progress}%;`),
										]),
									],
								),
							],
							corner: h.empty,
						}),
					),
				],
			),
		],
	)
}

const indicatorClass =
	"flex items-center justify-between gap-2 rounded-t-lg border border-border border-b-0 bg-secondary px-3 py-2"

/** `ComposerReplyIndicator` (`ReplyIndicator`). */
const replyIndicator = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	const reply = inputs.replyPreview
	if (model.composeMode._tag !== "Replying" || reply === null) return h.empty
	const hasFiles = model.currentUpload !== null || model.attachmentIds.length > 0
	return h.keyed("div")(
		"reply-indicator",
		[h.Class(cn(indicatorClass, hasFiles ? "rounded-t-none border-t-0" : ""))],
		[
			h.div(
				[h.Class("flex items-center gap-2 text-sm max-md:min-w-0")],
				[
					h.span([h.Class("text-muted-fg max-md:shrink-0")], ["Replying to"]),
					h.span([h.Class("font-semibold text-fg max-md:truncate")], [reply.authorName]),
					h.span([h.Class("max-w-xs truncate text-muted-fg")], [reply.firstLine]),
				],
			),
			removeButton(h, inputs.toMessage(Message.ClickedCancelReply()), "Cancel reply", true),
		],
	)
}

/** `ComposerEditIndicator`. */
const editIndicator = <M>(h: HtmlBuilder<M>, model: Model, inputs: DraftViewInputs<M>): Html => {
	if (model.composeMode._tag !== "Editing") return h.empty
	const hasFiles = model.currentUpload !== null || model.attachmentIds.length > 0
	return h.keyed("div")(
		"edit-indicator",
		[h.Class(cn(indicatorClass, hasFiles ? "rounded-t-none border-t-0" : ""))],
		[
			h.div(
				[h.Class("flex items-center gap-2 text-sm")],
				[
					IconEdit(h, { className: "size-3.5 text-primary" }),
					h.span([h.Class("font-semibold text-primary")], ["Editing message"]),
				],
			),
			removeButton(h, inputs.toMessage(Message.ClickedCancelEdit()), "Cancel editing", true),
		],
	)
}

/** The drop zone's overlays: strong over the zone, subtle while dragging anywhere; none while a file uploads. */
const dropOverlay = <M>(h: HtmlBuilder<M>, model: Model): Html =>
	isUploading(model)
		? h.empty
		: DragState.match(model.drag, {
				Idle: () => h.empty,
				OverDropZone: () =>
					h.div(
						[
							h.Class(
								"absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-primary border-dashed bg-primary/10",
							),
						],
						[h.span([h.Class("font-medium text-primary")], ["Drop files here"])],
					),
				DraggingOnPage: () =>
					h.div(
						[
							h.Class(
								"absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-primary/50 border-dashed bg-primary/5",
							),
						],
						[h.span([h.Class("font-medium text-primary/70")], ["Drop files here"])],
					),
			})

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
				Mount.mapMessage(TrackFileDrop(), (event) => toMessage(Message.ReceivedDropEvent({ event }))),
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
		gifTrigger: (render) =>
			GifPickerView.view(h, model.gifPicker, {
				toMessage: (message) => toMessage(Message.GotGifPickerMessage({ message })),
				toTrigger: render,
			}),
		emojiTrigger: (render) =>
			EmojiDialog.view(h, model.emojiPicker, {
				toMessage: (message) => toMessage(Message.GotEmojiPickerMessage({ message })),
				toTrigger: render,
				customEmojis: model.composer.customEmojis,
			}),
	})
}
