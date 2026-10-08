import type { Html, HtmlBuilder } from "foldkit/html"
import { formatFileSize, getFileTypeFromName } from "~/utils/file-utils"
import { fileIcon } from "../../../chat/file-icons"
import { IconArrowLeft, IconDownload, IconFolders } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { button } from "../../../ui/button"
import { searchField } from "../../../ui/search-field"
import { view as selectView } from "../../../ui/select-view"
import { documentsOf, filterAttachments, formatRelativeTime, mediaOf, uploaderIdentity } from "./derive"
import { type FilesContext, filesPath, mediaGalleryView, mediaGridView } from "./media-view"
import { Message, type Model, SEARCH_FIELD_ID } from "./page"
import type { FileAttachment } from "./queries"

/** The `files/` and `files/media` route outlets (the lead renders the chat header and tab bar). */

/** `ChannelFilesHeader`: search, type filter and the file count. */
const headerView = <M>(context: FilesContext<M>, fileCount: number): Html => {
	const { h, model, toParentMessage } = context
	return h.div(
		[h.Class("flex shrink-0 items-center gap-3 px-4 py-3")],
		[
			searchField(
				h,
				{
					id: SEARCH_FIELD_ID,
					value: model.searchQuery,
					className: "w-64",
					onInput: (value) => toParentMessage(Message.UpdatedSearch({ value })),
					onClear: toParentMessage(Message.ClearedSearch()),
					onClearPressStart: toParentMessage(Message.PressedSearchClear()),
					interaction: context.wiring,
				},
				(parts) => [parts.searchInput({ placeholder: "Search files..." })],
			),
			h.submodel({
				slotId: "channel-files-filter",
				model: model.filter,
				view: selectView,
				// Kit gap: legacy has no Label and puts `w-36` on the trigger (see the report).
				viewInputs: { triggerClassName: "w-36" },
				toParentMessage: (message) => toParentMessage(Message.GotFilterSelectMessage({ message })),
			}),
			h.span(
				[h.Class("whitespace-nowrap text-muted-fg text-sm")],
				[String(fileCount), " ", fileCount === 1 ? "file" : "files"],
			),
		],
	)
}

/** `DocumentItem` of `channel-files-documents-list.tsx`. */
const documentItem = <M>(context: FilesContext<M>, attachment: FileAttachment): Html => {
	const { h, model, toParentMessage } = context
	const uploader = uploaderIdentity(attachment.uploader)
	return h.keyed("div")(
		attachment.id,
		[
			h.Class(
				"group flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 transition-colors hover:bg-secondary/60",
			),
		],
		[
			fileIcon(h, getFileTypeFromName(attachment.fileName), {
				className: "size-10 shrink-0 text-muted-fg",
			}),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div([h.Class("truncate font-medium text-fg text-sm")], [attachment.fileName]),
					h.div(
						[h.Class("flex items-center gap-2 text-muted-fg text-xs")],
						[
							h.span([], [formatFileSize(attachment.fileSize)]),
							h.span([h.AriaHidden(true)], ["·"]),
							h.span([], [formatRelativeTime(attachment.uploadedAtMs, model.nowMs)]),
						],
					),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-2")],
				[
					avatar(h, {
						size: "xs",
						src: uploader.avatarUrl,
						alt: uploader.name,
						seed: uploader.seed,
					}),
					h.span([h.Class("hidden text-muted-fg text-xs sm:inline")], [uploader.name]),
				],
			),
			button(
				h,
				{
					intent: "plain",
					size: "sq-sm",
					className: "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
					onPress: toParentMessage(Message.ClickedDownload({ attachmentId: attachment.id })),
					interaction: {
						wiring: context.wiring,
						target: `files-document-download-${attachment.id}`,
					},
					attributes: [h.AriaLabel(`Download ${attachment.fileName}`)],
				},
				[IconDownload(h)],
			),
		],
	)
}

const sectionView = <M>(h: HtmlBuilder<M>, title: string, content: Html): Html =>
	h.section(
		[],
		[h.h2([h.Class("mb-3 font-medium text-muted-fg text-xs uppercase tracking-wide")], [title]), content],
	)

/** `ChannelFilesView`. */
const filesView = <M>(context: FilesContext<M>): Html => {
	const { h, model } = context
	const filtered = filterAttachments(model.attachments, model.searchQuery, model.filterType)
	const media = mediaOf(filtered)
	const documents = documentsOf(filtered)
	const isFiltered = model.searchQuery !== "" || model.filterType !== "all"
	return h.div(
		[h.Class("flex flex-1 flex-col overflow-hidden")],
		[
			headerView(context, filtered.length),
			h.div(
				[h.Class("flex-1 overflow-y-auto")],
				[
					h.div(
						[h.Class("flex flex-col gap-6 p-4")],
						[
							...(media.length === 0 && documents.length === 0
								? [
										h.div(
											[
												h.Class(
													"flex flex-col items-center justify-center py-16 text-center",
												),
											],
											[
												IconFolders(h, { className: "mb-3 size-12 text-muted-fg" }),
												h.h3(
													[h.Class("font-medium text-fg text-lg")],
													["No files found"],
												),
												h.p(
													[h.Class("text-muted-fg text-sm")],
													[
														isFiltered
															? "Try adjusting your search or filter"
															: "Files shared in this channel will appear here",
													],
												),
											],
										),
									]
								: []),
							...(media.length > 0
								? [sectionView(h, "Media", mediaGridView(context, media))]
								: []),
							...(documents.length > 0
								? [
										sectionView(
											h,
											"Documents",
											h.div(
												[h.Class("flex flex-col gap-2")],
												documents.map((attachment) =>
													documentItem(context, attachment),
												),
											),
										),
									]
								: []),
						],
					),
				],
			),
		],
	)
}

/** `MediaGalleryRoute`: back link (a TanStack `<Link>` around the Button, active on `files/`) and gallery. */
const mediaPageView = <M>(context: FilesContext<M>): Html => {
	const { h } = context
	return h.div(
		[h.Class("flex h-full flex-col")],
		[
			h.header(
				[h.Class("flex shrink-0 items-center gap-3 border-border border-b px-4 py-3")],
				[
					h.a(
						[
							h.AriaCurrent("page"),
							h.Class("active"),
							h.DataAttribute("status", "active"),
							h.Href(filesPath(context.model)),
						],
						[
							button(
								h,
								{
									intent: "plain",
									size: "sq-sm",
									interaction: { wiring: context.wiring, target: "files-media-back" },
									attributes: [h.AriaLabel("Go back")],
								},
								[IconArrowLeft(h, { className: "size-5" })],
							),
						],
					),
					h.h1([h.Class("font-semibold text-lg")], ["All Media"]),
				],
			),
			mediaGalleryView(context),
		],
	)
}

export const view = <M>(h: HtmlBuilder<M>, model: Model, toParentMessage: (message: Message) => M): Html => {
	const context: FilesContext<M> = {
		h,
		model,
		toParentMessage,
		wiring: {
			model: model.interaction,
			toParentMessage: (message) => toParentMessage(Message.GotInteractionMessage({ message })),
		},
	}
	return model.view === "media" ? mediaPageView(context) : filesView(context)
}
