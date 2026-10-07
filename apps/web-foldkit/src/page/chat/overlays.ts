import { ChannelId, MessageId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import * as TooltipHost from "../../chat/tooltip-host"
import * as EmojiDialog from "../../emoji-picker/dialog"
import * as Picker from "../../emoji-picker/picker"
import * as Modal from "../../ui/modal"
import * as Menu from "../../ui/menu"
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
	imageViewer: Schema.NullOr(Schema.Struct({ messageId: MessageId, index: Schema.Number })),
	/** The toolbar's "Add reaction" picker while it is open. */
	reactionPicker: Schema.NullOr(Schema.Struct({ messageId: MessageId, dialog: EmojiDialog.Model })),
	/** The context menu's "Add Reaction": a modal holding the picker. */
	reactionModal: Schema.NullOr(Schema.Struct({ messageId: MessageId, modal: Modal.Model, picker: Picker.Model })),
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
	imageViewer: null,
	reactionPicker: null,
	reactionModal: null,
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
	ClickedDelete: { messageId: MessageId },
	ClickedCopy: { messageId: MessageId },
	ClickedEdit: { messageId: MessageId },
	ClickedReaction: { messageId: MessageId, emoji: Schema.String },
	ClickedAttachmentImage: { messageId: MessageId, index: Schema.Number },
	ClosedImageViewer: {},
	SelectedViewerImage: { index: Schema.Number },
	GotReactionPickerMessage: { messageId: MessageId, message: EmojiDialog.Message },
	GotReactionModalMessage: { message: Modal.Message },
	GotReactionModalPickerMessage: { message: Picker.Message },
	ClickedThreadPreview: { threadChannelId: ChannelId, messageId: MessageId },
	ClosedThread: {},
})
export type Message = typeof Message.Type

/** `useMessageActions` handlers the overlays trigger; the page runs them. */
export const MessageAction = Schema.Literals(["reply", "edit", "thread", "pin", "copy", "copy-id", "delete", "add-reaction"])
export type MessageAction = typeof MessageAction.Type

export const OutMessage = defineMessageUnion({
	RequestedMessageAction: { messageId: MessageId, action: MessageAction },
	RequestedReaction: { messageId: MessageId, emoji: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

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

export type OverlaysReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const set = (model: Model, fields: Partial<Model>): OverlaysReturn => ({ model: { ...model, ...fields } })

const action = (model: Model, messageId: MessageId, requested: MessageAction): OverlaysReturn => ({
	model,
	outMessage: OutMessage.RequestedMessageAction({ messageId, action: requested }),
})

/** A menu's selection, reported as the message action its item key names. */
const withSelection = (
	result: OverlaysReturn,
	messageId: MessageId,
	menuOut: Menu.OutMessage | undefined,
): OverlaysReturn => {
	if (menuOut === undefined || menuOut._tag !== "SelectedItem") return result
	const parsed = Schema.decodeUnknownOption(MessageAction)(menuOut.key)
	return parsed._tag === "Some"
		? { ...result, outMessage: OutMessage.RequestedMessageAction({ messageId, action: parsed.value }) }
		: result
}

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
		// The toolbar stays while its emoji picker is open (the picker is inside it).
		CompletedWaitForHideToolbar: ({ version }) =>
			version === model.hoverVersion && !model.isToolbarHovered && model.reactionPicker === null
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
		GotMoreMenuMessage: ({ messageId, message: menuMessage }) => {
			const result = Menu.update(moreMenuFor(model, messageId, facts), menuMessage)
			return withSelection(
				mapped(
					model,
					result,
					(menu) => ({ moreMenu: { messageId, menu } }),
					(inner) => Message.GotMoreMenuMessage({ messageId, message: inner }),
				),
				messageId,
				result.outMessage,
			)
		},
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
			const result = Menu.update(current.menu, menuMessage)
			return withSelection(
				mapped(
					model,
					result,
					(menu) => ({ contextMenu: { messageId: current.messageId, menu } }),
					(inner) => Message.GotContextMenuMessage({ message: inner }),
				),
				current.messageId,
				result.outMessage,
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
		ClickedReply: ({ messageId }) => action(model, messageId, "reply"),
		ClickedDelete: ({ messageId }) => action(model, messageId, "delete"),
		ClickedCopy: ({ messageId }) => action(model, messageId, "copy"),
		ClickedEdit: ({ messageId }) => action(model, messageId, "edit"),
		ClickedReaction: ({ messageId, emoji }) => ({
			model,
			outMessage: OutMessage.RequestedReaction({ messageId, emoji }),
		}),
		ClickedAttachmentImage: ({ messageId, index }) => set(model, { imageViewer: { messageId, index } }),
		ClosedImageViewer: () => set(model, { imageViewer: null }),
		SelectedViewerImage: ({ index }) =>
			model.imageViewer === null
				? { model }
				: set(model, { imageViewer: { ...model.imageViewer, index } }),
		GotReactionPickerMessage: ({ messageId, message: dialogMessage }) => {
			const current =
				model.reactionPicker?.messageId === messageId
					? model.reactionPicker.dialog
					: EmojiDialog.init(`reaction-picker-${messageId}`)
			const result = EmojiDialog.update(current, dialogMessage)
			const next = mapped(
				model,
				result,
				(dialog) => ({ reactionPicker: dialog.isOpen ? { messageId, dialog } : null }),
				(inner) => Message.GotReactionPickerMessage({ messageId, message: inner }),
			)
			// `handleReaction` with the picked emoji's string.
			return result.outMessage === undefined
				? next
				: { ...next, outMessage: OutMessage.RequestedReaction({ messageId, emoji: result.outMessage.emoji }) }
		},
		GotReactionModalMessage: ({ message: modalMessage }) => {
			const current = model.reactionModal
			if (current === null) return { model }
			const result = Modal.update(current.modal, modalMessage)
			return mapped(
				model,
				result,
				(modal) => ({ reactionModal: modal.isOpen ? { ...current, modal } : null }),
				(inner) => Message.GotReactionModalMessage({ message: inner }),
			)
		},
		GotReactionModalPickerMessage: ({ message: pickerMessage }) => {
			const current = model.reactionModal
			if (current === null) return { model }
			const result = Picker.update(current.picker, pickerMessage)
			const next = mapped(
				model,
				result,
				(picker) => ({ reactionModal: { ...current, picker } }),
				(inner) => Message.GotReactionModalPickerMessage({ message: inner }),
			)
			// `handleReaction(emoji)` then `modal.close()`.
			return result.outMessage === undefined
				? next
				: {
						...next,
						model: { ...next.model, reactionModal: null },
						outMessage: OutMessage.RequestedReaction({
							messageId: current.messageId,
							emoji: result.outMessage.emoji,
						}),
					}
		},
		ClickedThreadPreview: ({ threadChannelId, messageId }) =>
			set(model, { thread: { threadChannelId, messageId } }),
		ClosedThread: () => set(model, { thread: null }),
	})


/** The message id a tooltip or popover key belongs to (keys are `<messageId>:<part>`). */
const messageIdOfKey = (key: string) => key.split(":")[0]

/** Whether an open overlay renders inside this message's row (so the row cannot reuse its memo). */
export const ownsRow = (model: Model, messageId: MessageId): boolean =>
	(model.tooltip !== null && messageIdOfKey(model.tooltip.id) === messageId) ||
	(model.hoveredTriggerKey !== null && messageIdOfKey(model.hoveredTriggerKey) === messageId) ||
	(model.contextMenu !== null && model.contextMenu.messageId === messageId) ||
	(model.popover !== null && messageIdOfKey(model.popover.key) === messageId)

/** The context menu's "Add Reaction" opens the picker modal, which loads its data. */
export const openReactionModal = (model: Model, messageId: MessageId): OverlaysReturn => ({
	model: {
		...model,
		reactionModal: {
			messageId,
			modal: { id: "reaction-picker-modal", isOpen: true },
			picker: Picker.init("reaction-picker-modal-picker"),
		},
	},
	commands: Command.mapMessages([Picker.LoadEmojiData()], (message) =>
		Message.GotReactionModalPickerMessage({ message }),
	),
})
