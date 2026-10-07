import { ChannelId, MessageId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import * as TooltipHost from "../../chat/tooltip-host"
import * as Menu from "../../ui/menu"
import * as Modal from "../../ui/modal"
import * as Popover from "../../ui/popover"
import * as Toolbar from "../../ui/toolbar"

/** Reading overlays anchored to messages: hover toolbar, tooltips, menus, popovers, viewers. */

// MODEL

export const MessageMenu = Schema.Struct({ messageId: MessageId, menu: Menu.Model })
export const MessagePopover = Schema.Struct({ key: Schema.String, popover: Popover.Model })

export const Model = Schema.Struct({
	/** `MessageHoverProvider`: the message under the pointer, and whether the toolbar holds it. */
	hoveredMessageId: Schema.NullOr(MessageId),
	isToolbarHovered: Schema.Boolean,
	/** Bumped on every hover change so a stale hide delay never acts. */
	hoverVersion: Schema.Number,
	toolbar: Toolbar.Model,
	tooltip: TooltipHost.Model,
	/** The tooltip trigger under the pointer (`data-hovered`). */
	hoveredTriggerKey: Schema.NullOr(Schema.String),
	moreMenu: Schema.NullOr(MessageMenu),
	contextMenu: Schema.NullOr(MessageMenu),
	/** The author popover open from an avatar (key `<messageId>:avatar`) or a pinned row. */
	popover: Schema.NullOr(MessagePopover),
	pinned: Popover.Model,
	deleteModal: Modal.Model,
	replyToMessageId: Schema.NullOr(MessageId),
	imageViewer: Schema.NullOr(Schema.Struct({ messageId: MessageId, index: Schema.Number })),
	/** `useChatThread`: the thread panel beside the channel. */
	thread: Schema.NullOr(Schema.Struct({ threadChannelId: ChannelId, messageId: MessageId })),
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	hoveredMessageId: null,
	isToolbarHovered: false,
	hoverVersion: 0,
	toolbar: Toolbar.init({ label: "Message actions" }),
	tooltip: null,
	hoveredTriggerKey: null,
	moreMenu: null,
	contextMenu: null,
	popover: null,
	pinned: Popover.init("pinned-messages"),
	deleteModal: Modal.init("delete-message"),
	replyToMessageId: null,
	imageViewer: null,
	thread: null,
})

// MESSAGE

export const Message = defineMessageUnion({
	PointerEnteredMessage: { messageId: MessageId },
	PointerLeftList: {},
	CompletedWaitForHideToolbar: { version: Schema.Number },
	EnteredToolbar: {},
	LeftToolbar: {},
	GotToolbarMessage: { message: Toolbar.Message },
	GotTooltipMessage: { tooltip: TooltipHost.Message },
	GotMoreMenuMessage: { messageId: MessageId, message: Menu.Message },
	RightClickedMessage: { messageId: MessageId, offset: Schema.Number, crossOffset: Schema.Number },
	GotContextMenuMessage: { message: Menu.Message },
	GotPopoverMessage: { key: Schema.String, message: Popover.Message },
	GotPinnedMessage: { message: Popover.Message },
	ClickedReply: { messageId: MessageId },
	ClickedCancelReply: {},
	ClickedDelete: { messageId: MessageId },
	GotDeleteModalMessage: { message: Modal.Message },
	ClickedAttachmentImage: { messageId: MessageId, index: Schema.Number },
	ClosedImageViewer: {},
	SelectedViewerImage: { index: Schema.Number },
	ClickedThreadPreview: { threadChannelId: ChannelId, messageId: MessageId },
	ClosedThread: {},
})
export type Message = typeof Message.Type

/** What the overlays need to know about a message when a menu opens. */
export interface MessageFacts {
	readonly isOwnMessage: (messageId: MessageId) => boolean
	readonly isPinned: (messageId: MessageId) => boolean
	readonly isThreadChannel: boolean
}

// COMMAND

const HIDE_DELAY = Duration.millis(200)

const WaitForHideToolbar = Command.define("WaitForHideToolbar", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForHideToolbar],
	execute: ({ version }) =>
		Effect.sleep(HIDE_DELAY).pipe(Effect.as(Message.CompletedWaitForHideToolbar({ version }))),
})

// UPDATE

export type OverlaysReturn = Update.Return<Model, Message>

const set = (model: Model, fields: Partial<Model>): OverlaysReturn => ({ model: { ...model, ...fields } })

const mapped = <Child, ChildMessage>(
	model: Model,
	result: Pick<Update.Return<Child, ChildMessage>, "model" | "commands">,
	write: (child: Child) => Partial<Model>,
	wrap: (message: ChildMessage) => Message,
): OverlaysReturn => ({
	model: { ...model, ...write(result.model) },
	commands: Command.mapMessages(result.commands ?? [], wrap),
})

export const moreMenuEntries = (facts: MessageFacts): ReadonlyArray<Menu.Entry> => [
	...(facts.isThreadChannel ? [] : [Menu.item("thread")]),
	Menu.item("pin"),
]

export const contextMenuEntries = (facts: MessageFacts, messageId: MessageId): ReadonlyArray<Menu.Entry> => [
	Menu.separator,
	Menu.item("add-reaction"),
	Menu.separator,
	Menu.item("reply"),
	...(facts.isOwnMessage(messageId) ? [Menu.item("edit")] : []),
	...(facts.isThreadChannel ? [] : [Menu.item("thread")]),
	Menu.separator,
	Menu.item("copy"),
	Menu.item("pin"),
	Menu.separator,
	...(facts.isOwnMessage(messageId) ? [Menu.item("delete", { intent: "Danger" })] : []),
	Menu.item("copy-id"),
]

/** The closed "More actions" menu of a message. */
export const moreMenuFor = (model: Model, messageId: MessageId, facts: MessageFacts): Menu.Model =>
	model.moreMenu !== null && model.moreMenu.messageId === messageId
		? model.moreMenu.menu
		: Menu.init({ id: `more-${messageId}`, entries: moreMenuEntries(facts), placement: "bottom end" })

export const update = (model: Model, message: Message, facts: MessageFacts): OverlaysReturn =>
	Message.match<OverlaysReturn>(message, {
		PointerEnteredMessage: ({ messageId }) =>
			model.hoveredMessageId === messageId
				? set(model, { hoverVersion: model.hoverVersion + 1 })
				: set(model, { hoveredMessageId: messageId, hoverVersion: model.hoverVersion + 1 }),
		PointerLeftList: () => {
			if (model.hoveredMessageId === null || model.isToolbarHovered) return { model }
			const version = model.hoverVersion + 1
			return { model: { ...model, hoverVersion: version }, commands: [WaitForHideToolbar({ version })] }
		},
		CompletedWaitForHideToolbar: ({ version }) =>
			version === model.hoverVersion && !model.isToolbarHovered
				? set(model, { hoveredMessageId: null })
				: { model },
		EnteredToolbar: () => set(model, { isToolbarHovered: true, hoverVersion: model.hoverVersion + 1 }),
		LeftToolbar: () => set(model, { isToolbarHovered: false }),
		GotToolbarMessage: ({ message: toolbarMessage }) =>
			mapped(
				model,
				Toolbar.update(model.toolbar, toolbarMessage),
				(toolbar) => ({ toolbar }),
				(inner) => Message.GotToolbarMessage({ message: inner }),
			),
		GotTooltipMessage: ({ tooltip }) => {
			const result = TooltipHost.update(model.tooltip, tooltip, (inner) =>
				Message.GotTooltipMessage({ tooltip: inner }),
			)
			const hoveredTriggerKey =
				tooltip.message._tag === "HoveredTrigger"
					? tooltip.key
					: tooltip.message._tag === "UnhoveredTrigger" && model.hoveredTriggerKey === tooltip.key
						? null
						: model.hoveredTriggerKey
			return result.model === model.tooltip &&
				(result.commands ?? []).length === 0 &&
				hoveredTriggerKey === model.hoveredTriggerKey
				? { model }
				: { model: { ...model, tooltip: result.model, hoveredTriggerKey }, commands: result.commands }
		},
		GotMoreMenuMessage: ({ messageId, message: menuMessage }) =>
			mapped(
				model,
				Menu.update(moreMenuFor(model, messageId, facts), menuMessage),
				(menu) => ({ moreMenu: { messageId, menu } }),
				(inner) => Message.GotMoreMenuMessage({ messageId, message: inner }),
			),
		RightClickedMessage: ({ messageId, offset, crossOffset }) => {
			const menu = Menu.init({
				id: "message-context-menu",
				anchor: "Pointer",
				entries: contextMenuEntries(facts, messageId),
			})
			return mapped(
				model,
				Menu.update(menu, Menu.Message.PressedContextMenu({ offset, crossOffset })),
				(opened) => ({ contextMenu: { messageId, menu: opened } }),
				(inner) => Message.GotContextMenuMessage({ message: inner }),
			)
		},
		GotContextMenuMessage: ({ message: menuMessage }) => {
			const current = model.contextMenu
			if (current === null) return { model }
			return mapped(
				model,
				Menu.update(current.menu, menuMessage),
				(menu) => ({ contextMenu: { messageId: current.messageId, menu } }),
				(inner) => Message.GotContextMenuMessage({ message: inner }),
			)
		},
		GotPopoverMessage: ({ key, message: popoverMessage }) => {
			const current =
				model.popover !== null && model.popover.key === key
					? model.popover.popover
					: Popover.init(key)
			return mapped(
				model,
				Popover.update(current, popoverMessage),
				(popover) => ({ popover: { key, popover } }),
				(inner) => Message.GotPopoverMessage({ key, message: inner }),
			)
		},
		GotPinnedMessage: ({ message: popoverMessage }) =>
			mapped(
				model,
				Popover.update(model.pinned, popoverMessage),
				(pinned) => ({ pinned }),
				(inner) => Message.GotPinnedMessage({ message: inner }),
			),
		ClickedReply: ({ messageId }) => set(model, { replyToMessageId: messageId }),
		ClickedCancelReply: () => set(model, { replyToMessageId: null }),
		ClickedDelete: () =>
			mapped(model, Modal.open(model.deleteModal), (deleteModal) => ({ deleteModal }), wrapModal),
		GotDeleteModalMessage: ({ message: modalMessage }) =>
			mapped(
				model,
				Modal.update(model.deleteModal, modalMessage),
				(deleteModal) => ({ deleteModal }),
				wrapModal,
			),
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

const wrapModal = (message: Modal.Message) => Message.GotDeleteModalMessage({ message })

/** The message id a tooltip or popover key belongs to (keys are `<messageId>:<part>`). */
const messageIdOfKey = (key: string) => key.split(":")[0]

/** Whether an open overlay renders inside this message's row (so the row cannot reuse its memo). */
export const ownsRow = (model: Model, messageId: MessageId): boolean =>
	(model.tooltip !== null && messageIdOfKey(model.tooltip.id) === messageId) ||
	(model.hoveredTriggerKey !== null && messageIdOfKey(model.hoveredTriggerKey) === messageId) ||
	(model.contextMenu !== null && model.contextMenu.messageId === messageId) ||
	(model.popover !== null && messageIdOfKey(model.popover.key) === messageId)
