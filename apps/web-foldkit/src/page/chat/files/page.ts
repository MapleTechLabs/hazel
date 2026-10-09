import { AttachmentId, ChannelId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command, Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../../ui/aria/interaction"
import { searchFieldIds } from "../../../ui/search-field"
import * as Select from "../../../ui/select"
import { FileFilterType, filterOptions } from "./derive"
import { Breakpoint, FileAttachment } from "./queries"

/** Files tab (`chat/$id/files/index.tsx`) and All Media page (`chat/$id/files/media.tsx`). */

// MODEL

export const FilesView = Schema.Literals(["files", "media"])
export type FilesView = typeof FilesView.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	orgSlug: Schema.String,
	view: FilesView,
	/** Newest first, as the query returns them. */
	attachments: Schema.Array(FileAttachment),
	/** Clock of the last query result, for "Today" / "Yesterday". */
	nowMs: Schema.Number,
	searchQuery: Schema.String,
	filterType: FileFilterType,
	filter: Select.Model,
	breakpoint: Breakpoint,
	/** Media whose `<img>`/`<video>` fired `error`; legacy renders them as nothing. */
	failedMediaIds: Schema.Array(AttachmentId),
	/** The image the legacy `ImageViewerModal` would show. */
	viewerImageId: Schema.NullOr(AttachmentId),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedAttachments: { attachments: Schema.Array(FileAttachment), nowMs: Schema.Number },
	ResizedViewport: { breakpoint: Breakpoint },
	UpdatedSearch: { value: Schema.String },
	ClearedSearch: {},
	PressedSearchClear: {},
	CompletedFocusSearchInput: {},
	GotFilterSelectMessage: { message: Select.Message },
	GotInteractionMessage: { message: Interaction.Message },
	FailedToLoadMedia: { attachmentId: AttachmentId },
	ClickedMedia: { attachmentId: AttachmentId, isVideo: Schema.Boolean },
	ClickedDownload: { attachmentId: AttachmentId },
	CompletedDownloadAttachment: {},
	CompletedOpenMediaTab: {},
})
export type Message = typeof Message.Type

// INIT

export const SEARCH_FIELD_ID = "channel-files-search"
export const FILTER_SELECT_ID = "channel-files-filter"

export const init = (channelId: ChannelId, orgSlug: string, view: FilesView): Model => ({
	channelId,
	orgSlug,
	view,
	attachments: [],
	nowMs: 0,
	searchQuery: "",
	filterType: "all",
	filter: Select.init({
		id: FILTER_SELECT_ID,
		items: filterOptions.map((option) => Select.item(option.id, option.label)),
		selectedKey: "all",
	}),
	breakpoint: "base",
	failedMediaIds: [],
	viewerImageId: null,
	interaction: Interaction.init(),
})

/** Route change between `files/` and `files/media`: legacy remounts the outlet, so local state resets. */
export const setView = (model: Model, view: FilesView): Model =>
	model.view === view
		? model
		: {
				...init(model.channelId, model.orgSlug, view),
				attachments: model.attachments,
				nowMs: model.nowMs,
				breakpoint: model.breakpoint,
			}

// COMMAND

const FocusFilesSearchInput = Command.define("FocusFilesSearchInput", {
	messages: [Message.CompletedFocusSearchInput],
	execute: Dom.focus(`#${searchFieldIds(SEARCH_FIELD_ID).input}`).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedFocusSearchInput()),
	),
})

/** `handleDownload`: a temporary `<a download target="_blank">` clicked and removed. */
const DownloadAttachment = Command.define("DownloadAttachment", {
	args: { url: Schema.String, fileName: Schema.String },
	messages: [Message.CompletedDownloadAttachment],
	execute: ({ url, fileName }) =>
		Effect.sync(() => {
			const link = document.createElement("a")
			link.href = url
			link.download = fileName
			link.target = "_blank"
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			return Message.CompletedDownloadAttachment()
		}),
})

const OpenMediaTab = Command.define("OpenMediaTab", {
	args: { url: Schema.String },
	messages: [Message.CompletedOpenMediaTab],
	execute: ({ url }) =>
		Effect.sync(() => {
			window.open(url, "_blank")
			return Message.CompletedOpenMediaTab()
		}),
})

// UPDATE

export type FilesReturn = Update.Return<Model, Message>

const foldInteraction = Update.foldChild({
	update: Interaction.update,
	read: (model: Model) => Option.some(model.interaction),
	write: (model: Model, interaction: Interaction.Model): Model =>
		modifyFields(model, { interaction: () => interaction }),
	toParentMessage: (message: Interaction.Message) => Message.GotInteractionMessage({ message }),
})

const foldFilter = Update.foldChild({
	update: Select.update,
	read: (model: Model) => Option.some(model.filter),
	write: (model: Model, filter: Select.Model): Model => modifyFields(model, { filter: () => filter }),
	toParentMessage: (message: Select.Message) => Message.GotFilterSelectMessage({ message }),
	foldOutMessage: Select.OutMessage.match<Update.Step<Model, Message>>({
		ChangedSelection:
			({ key }) =>
			(model) => ({
				model: Schema.is(FileFilterType)(key)
					? modifyFields(model, { filterType: () => key })
					: model,
			}),
	}),
})

const withAttachment = (
	model: Model,
	attachmentId: AttachmentId,
	onFound: (found: FileAttachment) => FilesReturn,
) => {
	const found = model.attachments.find((attachment) => attachment.id === attachmentId)
	return found ? onFound(found) : { model }
}

export const update = (model: Model, message: Message): FilesReturn =>
	Message.match<FilesReturn>(message, {
		UpdatedAttachments: ({ attachments, nowMs }) => ({
			model: modifyFields(model, { attachments: () => attachments, nowMs: () => nowMs }),
		}),
		ResizedViewport: ({ breakpoint }) => ({
			model:
				model.breakpoint === breakpoint
					? model
					: modifyFields(model, { breakpoint: () => breakpoint }),
		}),
		UpdatedSearch: ({ value }) => ({ model: modifyFields(model, { searchQuery: () => value }) }),
		ClearedSearch: () => ({ model: modifyFields(model, { searchQuery: () => "" }) }),
		PressedSearchClear: () => ({ model, commands: [FocusFilesSearchInput()] }),
		CompletedFocusSearchInput: () => ({ model }),
		GotFilterSelectMessage: ({ message: selectMessage }) => foldFilter(model, selectMessage),
		GotInteractionMessage: ({ message: interactionMessage }) =>
			foldInteraction(model, interactionMessage),
		FailedToLoadMedia: ({ attachmentId }) => ({
			model: model.failedMediaIds.includes(attachmentId)
				? model
				: modifyFields(model, { failedMediaIds: (ids) => [...ids, attachmentId] }),
		}),
		ClickedMedia: ({ attachmentId, isVideo }) =>
			withAttachment(model, attachmentId, (found) =>
				isVideo
					? { model, commands: [OpenMediaTab({ url: found.url })] }
					: { model: modifyFields(model, { viewerImageId: () => attachmentId }) },
			),
		ClickedDownload: ({ attachmentId }) =>
			withAttachment(model, attachmentId, (found) => ({
				model,
				commands: [DownloadAttachment({ url: found.url, fileName: found.fileName })],
			})),
		CompletedDownloadAttachment: () => ({ model }),
		CompletedOpenMediaTab: () => ({ model }),
	})
