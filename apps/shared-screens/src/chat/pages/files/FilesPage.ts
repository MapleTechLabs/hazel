// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/chat/$id/files`, the channel's Files tab (`web-foldkit/src/page/chat/files`, now
 * deleted): search and a type filter over the channel's files, one row of media whose last tile
 * opens All media, the documents list, and the viewer over the channel's images. The channel header
 * and tab bar above it are still the Foldkit channel page's (it leaves the `channel-files` hole).
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ChannelId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema, Stream } from "effect"
import { Navigate, ShowToast } from "../../../app/requests"
import {
	type FileAction,
	FileActionOutcome,
	FilesHost,
	isFileAction,
	outcomeToast,
	RunFileAction,
	viewerEntries,
} from "../../files/actions"
import {
	Breakpoint,
	channelFilesStream,
	documentsOf,
	FileAttachment,
	FileFilterType,
	filterAttachments,
	filterOptions,
	isVideo,
	mediaOf,
	toAttachment,
	toViewerItem,
	toFileRow,
	visibleCountFor,
} from "../../files/attachments"
import { mediaHref, viewerOf } from "../../files/viewer"

export const FilesMessage = UiSchema.TaggedEnum({
	UpdatedAttachments: { attachments: Schema.Array(FileAttachment), nowMs: Schema.optional(Schema.Finite) },
	ChangedBreakpoint: { breakpoint: Breakpoint },
	ChangedSearch: { payload: TextField.ChangePayload },
	ChangedFilter: { value: Schema.String },
	PressedMedia: { id: Schema.String },
	PressedDocument: { id: Schema.String },
	PressedDownload: { id: Schema.String },
	PressedSeeAll: {},
	ChangedViewer: { index: Schema.Finite },
	SelectedViewerEntry: { id: Schema.String },
	DismissedViewer: {},
	CompletedFileAction: { outcome: FileActionOutcome, fromViewer: Schema.Boolean },
})
export type FilesMessage = typeof FilesMessage.Type

export const FilesProps = Schema.Struct({
	channelId: ChannelId,
	orgSlug: Schema.String,
	/** Where attachments without their own url live (today's `currentServer().cdn`). */
	cdnUrl: Schema.String,
})
export type FilesProps = typeof FilesProps.Type

export const FilesModel = Schema.Struct({
	/** Newest first; null until the query first answers (a loader, not "No files"). */
	attachments: Schema.NullOr(Schema.Array(FileAttachment)),
	search: TextField.State,
	filter: FileFilterType,
	breakpoint: Breakpoint,
	/** The image the viewer shows, among the channel's images. */
	viewerId: Schema.NullOr(Schema.String),
	/** The clock when the files last arrived, for the rows' "Yesterday"; null before. */
	nowMs: Schema.NullOr(Schema.Finite),
})
export type FilesModel = typeof FilesModel.Type

const Def = Hazel.component({
	name: "FilesPage",
	props: FilesProps,
	model: FilesModel,
	message: FilesMessage,
})

type H = Parameters<Parameters<typeof Def.make>[0]["view"]>[0]

const isFilter = Schema.is(FileFilterType)

const filteredOf = (model: FilesModel) =>
	filterAttachments(model.attachments ?? [], model.search.text, model.filter)

/** One row of media; with more, its last tile opens All media (`ChannelFilesMediaGrid`). */
const mediaStrip = (model: FilesModel, media: ReadonlyArray<FileAttachment>) => {
	const visible = media.slice(0, visibleCountFor(model.breakpoint))
	return { visible, more: media.length - visible.length }
}

const fileAction = (file: FileAttachment, action: FileAction, fromViewer: boolean) =>
	RunFileAction.make({ action, url: file.url, fileName: file.fileName }).pipe(
		Command.map((outcome) => FilesMessage.CompletedFileAction({ outcome, fromViewer })),
	)

const labelled = (h: H, title: string, content: ReturnType<H["attachmentGrid"]["layout"]>) =>
	h.stack.density("compact").children(h.text.role("overline").tone("subtle").children(title), content)

const body = (h: H, model: FilesModel) => {
	const filtered = filteredOf(model)
	const media = mediaOf(filtered)
	const documents = documentsOf(filtered)
	if (media.length === 0 && documents.length === 0) {
		const isFiltered = model.search.text !== "" || model.filter !== "all"
		return [
			h.emptyState
				.icon("folders")
				.title("No files found")
				.description(
					isFiltered
						? "Try another search or filter."
						: "Files shared in this channel will appear here.",
				),
		]
	}
	return [
		media.length > 0
			? labelled(
					h,
					"Media",
					h.attachmentGrid
						.layout("grid")
						.attachments(mediaStrip(model, media).visible.map(toAttachment))
						.more(mediaStrip(model, media).more)
						.on("press", ({ id }) => FilesMessage.PressedMedia({ id }))
						.on("download", ({ id }) => FilesMessage.PressedDownload({ id }))
						.on("pressMore", () => FilesMessage.PressedSeeAll()),
				)
			: null,
		documents.length > 0
			? labelled(
					h,
					"Documents",
					h.attachmentGrid
						.layout("list")
						.attachments(documents.map((each) => toFileRow(each, model.nowMs)))
						.on("press", ({ id }) => FilesMessage.PressedDocument({ id }))
						.on("download", ({ id }) => FilesMessage.PressedDownload({ id })),
				)
			: null,
	]
}

const header = (h: H, model: FilesModel, count: number) =>
	// The filter's field takes the row's rest (the count at its end); on a phone the row wraps.
	h.stack
		.axis("horizontal")
		.align("center")
		.density("compact")
		.wrap()
		.children(
			h.searchField
				.placeholder("Search files…")
				.width("regular")
				.value(model.search)
				.on("change", (payload) => FilesMessage.ChangedSearch({ payload })),
			h.select
				.options(filterOptions.map((option) => ({ value: option.value, label: option.label })))
				.value(model.filter)
				.width("narrow")
				.on("change", ({ value }) => FilesMessage.ChangedFilter({ value })),
			h.text
				.role("label")
				.tone("muted")
				.children(`${count} ${count === 1 ? "file" : "files"}`),
		)

const viewer = (h: H, model: FilesModel) => {
	const { images, index } = viewerOf(model.attachments ?? [], model.viewerId)
	return h.lightbox
		.open(index !== -1)
		.items(images.map(toViewerItem))
		.index(Math.max(index, 0))
		.entries(viewerEntries)
		.on("change", ({ index }) => FilesMessage.ChangedViewer({ index }))
		.on("select", ({ id }) => FilesMessage.SelectedViewerEntry({ id }))
		.on("dismiss", () => FilesMessage.DismissedViewer())
}

export const FilesPageNoDeps = Def.make({
	init: () => ({
		attachments: null,
		search: TextField.empty,
		filter: "all",
		breakpoint: "base",
		viewerId: null,
		nowMs: null,
	}),
	update: {
		UpdatedAttachments: ($, { attachments, nowMs }) =>
			$.evolve({
				attachments: () => attachments,
				nowMs: (current) => nowMs ?? current,
				// A deleted image closes the viewer.
				viewerId: (id) => (id !== null && attachments.some((each) => each.id === id) ? id : null),
			}),
		ChangedBreakpoint: ($, { breakpoint }) => $.evolve({ breakpoint: () => breakpoint }),
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		ChangedFilter: ($, { value }) => (isFilter(value) ? $.evolve({ filter: () => value }) : $.model),
		PressedMedia: ($, { id }) => {
			const found = mediaStrip($.model, mediaOf(filteredOf($.model))).visible.find(
				(each) => each.id === id,
			)
			if (found === undefined) return $.model
			return isVideo(found)
				? $.run(fileAction(found, "openInBrowser", false))
				: $.evolve({ viewerId: () => found.id })
		},
		PressedSeeAll: ($) =>
			$.run(Navigate.make({ href: mediaHref($.props.orgSlug, $.props.channelId), replace: false })),
		PressedDownload: ($, { id }) => {
			const found = $.model.attachments?.find((each) => each.id === id)
			return found === undefined ? $.model : $.run(fileAction(found, "download", false))
		},
		PressedDocument: ($, { id }) => {
			const found = $.model.attachments?.find((each) => each.id === id)
			return found === undefined ? $.model : $.run(fileAction(found, "download", false))
		},
		ChangedViewer: ($, { index }) => {
			const image = viewerOf($.model.attachments ?? [], $.model.viewerId).images[index]
			return image === undefined ? $.model : $.evolve({ viewerId: () => image.id })
		},
		SelectedViewerEntry: ($, { id }) => {
			const { current } = viewerOf($.model.attachments ?? [], $.model.viewerId)
			return current === undefined || !isFileAction(id) ? $.model : $.run(fileAction(current, id, true))
		},
		DismissedViewer: ($) => $.evolve({ viewerId: () => null }),
		CompletedFileAction: ($, { outcome, fromViewer }) => {
			const toast = outcomeToast(outcome, fromViewer)
			return toast === null ? $.model : $.run(ShowToast.make({ toast }))
		},
	},
	subscriptions: ({ props }) => [
		Subscription.make("files", [props.channelId, props.cdnUrl], ([channelId, cdnUrl]) =>
			channelFilesStream(ChannelId.make(channelId), cdnUrl, (attachments, nowMs) =>
				FilesMessage.UpdatedAttachments({ attachments, nowMs }),
			),
		),
		Subscription.make("breakpoint", [], () =>
			Stream.unwrap(
				Effect.map(Effect.service(FilesHost), (host) =>
					Stream.map(host.breakpoint, (breakpoint) =>
						FilesMessage.ChangedBreakpoint({ breakpoint }),
					),
				),
			),
		),
	],
	view: (h, model) =>
		// HAZEL-GAP(p4-page-gutter): today's header is `px-4 py-3` and the content `p-4`; no container insets.
		h.stack.children(
			header(h, model, filteredOf(model).length),
			h.scroll.children(
				h.stack
					.density("relaxed")
					.children(
						...(model.attachments === null
							? [h.progress.style("spinner").label("Loading files…")]
							: body(h, model)),
					),
			),
			viewer(h, model),
		),
})

/** The page with its file actions, on the host's `FilesHost` and `ClientData`. */
export const FilesPage = FilesPageNoDeps.pipe(Component.provide(RunFileAction.layer))
