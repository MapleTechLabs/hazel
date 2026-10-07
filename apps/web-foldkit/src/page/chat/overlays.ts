import { ChannelId, MessageId } from "@hazel/schema"
import { Schema } from "effect"
import type { Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as TooltipHost from "../../chat/tooltip-host"

/** Reading overlays anchored to messages: hover toolbar, tooltips, menus, popovers, viewers. */

// MODEL

export const ImageViewer = Schema.Struct({ messageId: MessageId, index: Schema.Number })
export const OpenThread = Schema.Struct({ threadChannelId: ChannelId, messageId: MessageId })

export const Model = Schema.Struct({
	/** `MessageHoverProvider`: the message under the pointer, and whether the toolbar holds it. */
	hoveredMessageId: Schema.NullOr(MessageId),
	isToolbarHovered: Schema.Boolean,
	tooltip: TooltipHost.Model,
	imageViewer: Schema.NullOr(ImageViewer),
	/** `useChatThread`: the thread panel beside the channel. */
	thread: Schema.NullOr(OpenThread),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	hoveredMessageId: null,
	isToolbarHovered: false,
	tooltip: null,
	imageViewer: null,
	thread: null,
})

// MESSAGE

export const Message = defineMessageUnion({
	HoveredMessage: { messageId: MessageId },
	LeftMessageList: {},
	HoveredToolbar: {},
	LeftToolbar: {},
	GotTooltipMessage: { tooltip: TooltipHost.Message },
	ClickedAttachmentImage: { messageId: MessageId, index: Schema.Number },
	ClosedImageViewer: {},
	SelectedViewerImage: { index: Schema.Number },
	ClickedThreadPreview: { threadChannelId: ChannelId, messageId: MessageId },
	ClosedThread: {},
})
export type Message = typeof Message.Type

// UPDATE

export type OverlaysReturn = Update.Return<Model, Message>

const set = (model: Model, fields: Partial<Model>): OverlaysReturn => ({ model: { ...model, ...fields } })

export const update = (model: Model, message: Message): OverlaysReturn =>
	Message.match<OverlaysReturn>(message, {
		HoveredMessage: ({ messageId }) =>
			model.hoveredMessageId === messageId ? { model } : set(model, { hoveredMessageId: messageId }),
		LeftMessageList: () =>
			model.hoveredMessageId === null || model.isToolbarHovered
				? { model }
				: set(model, { hoveredMessageId: null }),
		HoveredToolbar: () => set(model, { isToolbarHovered: true }),
		LeftToolbar: () => set(model, { isToolbarHovered: false }),
		GotTooltipMessage: ({ tooltip }) => {
			const result = TooltipHost.update(model.tooltip, tooltip, (inner) =>
				Message.GotTooltipMessage({ tooltip: inner }),
			)
			return {
				model:
					result.model === model.tooltip
						? model
						: modifyFields(model, { tooltip: () => result.model }),
				commands: result.commands,
			}
		},
		ClickedAttachmentImage: ({ messageId, index }) => set(model, { imageViewer: { messageId, index } }),
		ClosedImageViewer: () => set(model, { imageViewer: null }),
		SelectedViewerImage: ({ index }) =>
			model.imageViewer === null
				? { model }
				: set(model, { imageViewer: { ...model.imageViewer, index } }),
		ClickedThreadPreview: ({ threadChannelId, messageId }) =>
			set(model, { thread: { threadChannelId, messageId } }),
		ClosedThread: () => set(model, { thread: null }),
	})

/** The message id a tooltip key belongs to (keys are `<messageId>:<part>`). */
const messageIdOfKey = (key: string) => key.split(":")[0]

/** Whether an open overlay renders inside this message's row (so the row cannot reuse its memo). */
export const ownsRow = (model: Model, messageId: MessageId): boolean =>
	model.tooltip !== null && messageIdOfKey(model.tooltip.id) === messageId
