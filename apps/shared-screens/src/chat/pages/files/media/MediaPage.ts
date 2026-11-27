// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/chat/$id/files/media`, All media (`MediaGalleryRoute`, `web-foldkit/src/page/chat/files`,
 * now deleted): a back button to Files, the photo and video counts, and every image and video in
 * masonry columns. An image opens the viewer over the channel's images; a video opens in a tab.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ChannelId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Navigate, ShowToast } from "../../../../app/requests"
import {
	type FileAction,
	FileActionOutcome,
	isFileAction,
	outcomeToast,
	RunFileAction,
	viewerEntries,
} from "../../../files/actions"
import {
	channelFilesStream,
	FileAttachment,
	isVideo,
	isViewerImage,
	mediaOf,
	toAttachment,
} from "../../../files/attachments"
import { filesHref, viewerOf } from "../../../files/viewer"

export const MediaMessage = UiSchema.TaggedEnum({
	UpdatedAttachments: { attachments: Schema.Array(FileAttachment) },
	PressedBack: {},
	PressedMedia: { id: Schema.String },
	ChangedViewer: { index: Schema.Finite },
	SelectedViewerEntry: { id: Schema.String },
	DismissedViewer: {},
	CompletedFileAction: { outcome: FileActionOutcome },
})
export type MediaMessage = typeof MediaMessage.Type

export const MediaProps = Schema.Struct({
	channelId: ChannelId,
	orgSlug: Schema.String,
	/** Where attachments without their own url live (today's `currentServer().cdn`). */
	cdnUrl: Schema.String,
})
export type MediaProps = typeof MediaProps.Type

export const MediaModel = Schema.Struct({
	/** Newest first; null until the query first answers. */
	attachments: Schema.NullOr(Schema.Array(FileAttachment)),
	viewerId: Schema.NullOr(Schema.String),
})
export type MediaModel = typeof MediaModel.Type

const Def = Hazel.component({
	name: "MediaPage",
	props: MediaProps,
	model: MediaModel,
	message: MediaMessage,
})

type H = Parameters<Parameters<typeof Def.make>[0]["view"]>[0]

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** "3 photos, 1 video" (`MediaGalleryView`'s stats line). */
export const countsLine = (media: ReadonlyArray<FileAttachment>) => {
	const photos = media.filter(isViewerImage).length
	const videos = media.length - photos
	return `${plural(photos, "photo", "photos")}${videos > 0 ? `, ${plural(videos, "video", "videos")}` : ""}`
}

const fileAction = (file: FileAttachment, action: FileAction) =>
	RunFileAction.make({ action, url: file.url, fileName: file.fileName }).pipe(
		Command.map((outcome) => MediaMessage.CompletedFileAction({ outcome })),
	)

const gallery = (h: H, attachments: ReadonlyArray<FileAttachment> | null) => {
	if (attachments === null) return h.progress.style("spinner").label("Loading media…")
	const media = mediaOf(attachments)
	if (media.length === 0)
		return h.emptyState
			.icon("image")
			.title("No media yet")
			.description("Images and videos shared in this channel will appear here.")
	// HAZEL-GAP(p4-media-download): today's tiles have a hover download button.
	// HAZEL-GAP(p4-masonry-natural-size): unsized tiles hold 4:3; today's take the picture's height.
	// HAZEL-GAP(p4-media-load-error): today drops a tile whose picture fails to load.
	return h.stack
		.density("regular")
		.children(
			h.text.role("label").tone("muted").children(countsLine(media)),
			h.attachmentGrid
				.layout("masonry")
				.attachments(media.map(toAttachment))
				.on("press", ({ id }) => MediaMessage.PressedMedia({ id })),
		)
}

const viewer = (h: H, model: MediaModel) => {
	const { images, index } = viewerOf(model.attachments ?? [], model.viewerId)
	// HAZEL-GAP(lightbox-caption-author): today's viewer shows the uploader and the upload time.
	return h.lightbox
		.open(index !== -1)
		.items(images.map(toAttachment))
		.index(Math.max(index, 0))
		.entries(viewerEntries)
		.on("change", ({ index }) => MediaMessage.ChangedViewer({ index }))
		.on("select", ({ id }) => MediaMessage.SelectedViewerEntry({ id }))
		.on("dismiss", () => MediaMessage.DismissedViewer())
}

export const MediaPageNoDeps = Def.make({
	init: () => ({ attachments: null, viewerId: null }),
	update: {
		UpdatedAttachments: ($, { attachments }) =>
			$.evolve({
				attachments: () => attachments,
				viewerId: (id) => (id !== null && attachments.some((each) => each.id === id) ? id : null),
			}),
		PressedBack: ($) =>
			$.run(Navigate.make({ href: filesHref($.props.orgSlug, $.props.channelId), replace: false })),
		PressedMedia: ($, { id }) => {
			const found = mediaOf($.model.attachments ?? []).find((each) => each.id === id)
			if (found === undefined) return $.model
			return isVideo(found) ? $.run(fileAction(found, "openInBrowser")) : $.evolve({ viewerId: () => id })
		},
		ChangedViewer: ($, { index }) => {
			const image = viewerOf($.model.attachments ?? [], $.model.viewerId).images[index]
			return image === undefined ? $.model : $.evolve({ viewerId: () => image.id })
		},
		SelectedViewerEntry: ($, { id }) => {
			const { current } = viewerOf($.model.attachments ?? [], $.model.viewerId)
			return current === undefined || !isFileAction(id) ? $.model : $.run(fileAction(current, id))
		},
		DismissedViewer: ($) => $.evolve({ viewerId: () => null }),
		CompletedFileAction: ($, { outcome }) => {
			const toast = outcomeToast(outcome, true)
			return toast === null ? $.model : $.run(ShowToast.make({ toast }))
		},
	},
	subscriptions: ({ props }) => [
		Subscription.make("files", [props.channelId, props.cdnUrl], ([channelId, cdnUrl]) =>
			channelFilesStream(ChannelId.make(channelId), cdnUrl, (attachments) =>
				MediaMessage.UpdatedAttachments({ attachments }),
			),
		),
	],
	view: (h, model) =>
		// HAZEL-GAP(p4-page-gutter): today's gallery is inset `p-4`; no container insets.
		// HAZEL-GAP(p4-media-page-header): today's back is an arrow icon and the title 18px semibold.
		h.screen
			.surface("page")
			.title("All media")
			.back(true)
			.on("back", () => MediaMessage.PressedBack())
			.children(h.scroll.children(gallery(h, model.attachments)), viewer(h, model)),
})

/** The page with its file actions, on the host's `FilesHost` and `ClientData`. */
export const MediaPage = MediaPageNoDeps.pipe(Component.provide(RunFileAction.layer))
