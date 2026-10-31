import { MessageId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"
import * as TooltipHost from "../../chat/tooltip-host"
import * as EmojiDialog from "../../emoji-picker/dialog"
import * as Picker from "../../emoji-picker/picker"
import * as Modal from "../../ui/modal"
import * as Menu from "../../ui/menu"
import * as Popover from "../../ui/popover"
import * as Toolbar from "../../ui/toolbar"
import * as Tooltip from "../../ui/tooltip"

/** Reading overlays anchored to messages: hover toolbar, tooltips, menus, popovers, viewers. */

// MODEL

/** An image the viewer shows by URL (legacy `ViewerImage` `{ type: "url", url, alt }`). */
export const ViewerUrlImage = Schema.Struct({ url: Schema.String, alt: Schema.String })
export type ViewerUrlImage = typeof ViewerUrlImage.Type

/** The image viewer's toolbar actions (`ImageViewerAction`). */
export const ViewerAction = Schema.Literals(["download", "copyUrl", "openInBrowser"])
export type ViewerAction = typeof ViewerAction.Type

/** The kit Popover's id (and DOM slot) of a message's author popover. */
export const avatarPopoverKey = (messageId: MessageId) => `${messageId}:avatar`

/** The kit Popover's id of the profile popover opened from a message's `index`th mention. */
export const mentionPopoverKey = (messageId: MessageId, index: number) => `${messageId}:mention:${index}`

/** A tooltip trigger: its key (the Tooltip's id) and the message it renders in. */
export const Trigger = Schema.Struct({ key: Schema.String, messageId: MessageId })
export type Trigger = typeof Trigger.Type

/**
 * The one overlay open on a message at a time. A menu, popover, picker or viewer opening replaces
 * whatever was open, so two of them can never be up together.
 */
export const OpenOverlay = defineTaggedUnion({
	None: {},
	MoreMenu: { messageId: MessageId, menu: Menu.Model },
	ContextMenu: { messageId: MessageId, menu: Menu.Model },
	/** The profile popover open from a message's avatar or one of its mentions (`key`). */
	Popover: { messageId: MessageId, key: Schema.String, popover: Popover.Model },
	/** `urlImages` are a GIF or tweet photos (`ViewerImage` of type "url"); otherwise the attachments. */
	ImageViewer: {
		messageId: MessageId,
		index: Schema.Number,
		urlImages: Schema.NullOr(Schema.Array(ViewerUrlImage)),
	},
	/** The toolbar's "Add reaction" picker. */
	ReactionPicker: { messageId: MessageId, dialog: EmojiDialog.Model },
	/** The context menu's "Add Reaction": a modal holding the picker. */
	ReactionModal: { messageId: MessageId, modal: Modal.Model, picker: Picker.Model },
})
export type OpenOverlay = typeof OpenOverlay.Type

/**
 * `MessageHoverProvider`: the message under the pointer. Leaving the list starts a hide delay
 * (`HidePending`) that re-entering the message cancels; the toolbar holds the message while hovered.
 */
export const Hover = defineTaggedUnion({
	None: {},
	Shown: { messageId: MessageId, isToolbarHovered: Schema.Boolean },
	HidePending: { messageId: MessageId, version: Schema.Number },
})
export type Hover = typeof Hover.Type

export const Model = Schema.Struct({
	hover: Hover,
	/** Bumped for every hide delay started, so a stale one never acts. */
	hideVersion: Schema.Number,
	toolbar: Toolbar.Model,
	/** The tooltip host's one Tooltip, with the message its trigger renders in. */
	tooltip: Schema.NullOr(Schema.Struct({ messageId: MessageId, tooltip: Tooltip.Model })),
	/** The tooltip trigger under the pointer (`data-hovered`). */
	hoveredTrigger: Schema.NullOr(Trigger),
	/** The toolbar button with focus (React Aria useFocus, so `data-focused` at any modality). */
	focusedTrigger: Schema.NullOr(Trigger),
	open: OpenOverlay,
	/** The header's pinned messages popover. */
	pinned: Popover.Model,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	hover: Hover.None(),
	hideVersion: 0,
	toolbar: Toolbar.init({ label: "Message actions" }),
	tooltip: null,
	hoveredTrigger: null,
	focusedTrigger: null,
	open: OpenOverlay.None(),
	pinned: Popover.init("pinned-messages"),
})

/** The message the toolbar shows for. */
export const hoveredMessageIdOf = (model: Model): MessageId | null =>
	model.hover._tag === "None" ? null : model.hover.messageId

/**
 * The message whose row keeps its highlight without native `:hover`: the toolbar renders outside the
 * row, so the pointer on it leaves the row. Otherwise the row's own `hover:` is the highlight, so it
 * ends the moment the pointer leaves instead of lingering in gaps or through the hide delay.
 */
export const heldMessageIdOf = (model: Model): MessageId | null =>
	model.hover._tag === "Shown" && model.hover.isToolbarHovered ? model.hover.messageId : null

/** The active tooltip as the host renders it. */
export const activeTooltipOf = (model: Model): TooltipHost.Model => model.tooltip?.tooltip ?? null

export const imageViewerOf = (model: Model) => (model.open._tag === "ImageViewer" ? model.open : null)

export const reactionModalOf = (model: Model) => (model.open._tag === "ReactionModal" ? model.open : null)

export const contextMenuOf = (model: Model) => (model.open._tag === "ContextMenu" ? model.open : null)

/** The open popover in the shape the popover host takes. */
export const activePopoverOf = (model: Model) =>
	model.open._tag === "Popover" ? { key: model.open.key, popover: model.open.popover } : null

// MESSAGE

export const Message = defineMessageUnion({
	PointerEnteredMessage: { messageId: MessageId },
	PointerLeftList: {},
	CompletedWaitForHideToolbar: { version: Schema.Number },
	EnteredToolbar: {},
	LeftToolbar: {},
	GotToolbarMessage: { message: Toolbar.Message },
	GotTooltipMessage: { message: TooltipHost.Message },
	GotMoreMenuMessage: { messageId: MessageId, message: Menu.Message },
	RightClickedMessage: { messageId: MessageId, offset: Schema.Number, crossOffset: Schema.Number },
	GotContextMenuMessage: { message: Menu.Message },
	GotPopoverMessage: { messageId: MessageId, key: Schema.String, message: Popover.Message },
	GotPinnedMessage: { message: Popover.Message },
	ClickedReply: { messageId: MessageId },
	ClickedDelete: { messageId: MessageId },
	ClickedCopy: { messageId: MessageId },
	ClickedEdit: { messageId: MessageId },
	ClickedReaction: { messageId: MessageId, emoji: Schema.String },
	ClickedAttachmentImage: { messageId: MessageId, index: Schema.Number },
	ClickedEmbedImage: { messageId: MessageId, images: Schema.Array(ViewerUrlImage), index: Schema.Number },
	ClosedImageViewer: {},
	SelectedViewerImage: { index: Schema.Number },
	ClickedViewerAction: { action: ViewerAction, url: Schema.String, fileName: Schema.String },
	GotReactionPickerMessage: { messageId: MessageId, message: EmojiDialog.Message },
	GotReactionModalMessage: { message: Modal.Message },
	GotReactionModalPickerMessage: { message: Picker.Message },
})
export type Message = typeof Message.Type

/** `useMessageActions` handlers the overlays trigger; the page runs them. */
export const MessageAction = Schema.Literals([
	"reply",
	"edit",
	"thread",
	"pin",
	"copy",
	"copy-id",
	"delete",
	"add-reaction",
])
export type MessageAction = typeof MessageAction.Type

export const OutMessage = defineMessageUnion({
	RequestedMessageAction: { messageId: MessageId, action: MessageAction },
	RequestedReaction: { messageId: MessageId, emoji: Schema.String },
	RequestedViewerAction: { action: ViewerAction, url: Schema.String, fileName: Schema.String },
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

export const WaitForHideToolbar = Command.define("WaitForHideToolbar", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForHideToolbar],
	execute: ({ version }) =>
		Effect.sleep(HIDE_DELAY).pipe(Effect.as(Message.CompletedWaitForHideToolbar({ version }))),
})

// UPDATE

export type OverlaysReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

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

const isMenuOpen = (menu: Menu.Model) => menu.popup._tag === "Open"

/**
 * Folds a child overlay's result into `open`. The child is the open overlay when it is the current
 * one, or when it just opened; a closed child that is not current (a late transition of a menu that
 * another overlay replaced) leaves `open` alone. Its Commands still run.
 */
const withChild = <Child, ChildMessage>(
	model: Model,
	result: Pick<Update.Return<Child, ChildMessage>, "model" | "commands">,
	options: {
		readonly isCurrent: boolean
		readonly isOpen: (child: Child) => boolean
		readonly toOpen: (child: Child) => OpenOverlay
		readonly wrap: (message: ChildMessage) => Message
	},
): OverlaysReturn => ({
	model:
		options.isCurrent || options.isOpen(result.model)
			? modifyFields(model, { open: () => options.toOpen(result.model) })
			: model,
	commands: Command.mapMessages(result.commands ?? [], options.wrap),
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

/** The "More actions" menu of a message: the open one, or a closed one. */
export const moreMenuFor = (model: Model, messageId: MessageId): Menu.Model =>
	model.open._tag === "MoreMenu" && model.open.messageId === messageId
		? model.open.menu
		: Menu.init({ id: `more-${messageId}`, placement: "bottom end" })

/** The toolbar's reaction picker of a message: the open one, or a closed one. */
export const reactionPickerFor = (model: Model, messageId: MessageId): EmojiDialog.Model =>
	model.open._tag === "ReactionPicker" && model.open.messageId === messageId
		? model.open.dialog
		: EmojiDialog.init(`reaction-picker-${messageId}`)

const isSameTrigger = (a: Trigger | null, b: Trigger | null) =>
	a === b || (a !== null && b !== null && a.key === b.key && a.messageId === b.messageId)

/** Where the host's hovered or focused trigger moves for a tooltip message. */
const nextTrigger = (
	current: Trigger | null,
	{ key, messageId, message }: TooltipHost.Message,
	enter: Tooltip.Message["_tag"],
	leave: Tooltip.Message["_tag"],
): Trigger | null =>
	message._tag === enter
		? { key, messageId }
		: message._tag === leave && current?.key === key
			? null
			: current

/** `MessageHoverProvider`'s transitions. */
const hoverHandlers = (model: Model) => ({
	// `pointerover` fires for every child entered: within the hovered message only a pending hide changes.
	PointerEnteredMessage: ({ messageId }: { readonly messageId: MessageId }): OverlaysReturn =>
		Hover.match(model.hover, {
			None: () => ({
				model: modifyFields(model, {
					hover: () => Hover.Shown({ messageId, isToolbarHovered: false }),
				}),
			}),
			Shown: (shown) =>
				shown.messageId === messageId
					? { model }
					: { model: modifyFields(model, { hover: () => Hover.Shown({ ...shown, messageId }) }) },
			HidePending: () => ({
				model: modifyFields(model, {
					hover: () => Hover.Shown({ messageId, isToolbarHovered: false }),
				}),
			}),
		}),
	// The viewer is a portal inside the list in legacy and covers the screen, so React sees no
	// leave while it is open, even when the pointer moves before the viewer has rendered.
	PointerLeftList: (): OverlaysReturn => {
		const hover = model.hover
		if (hover._tag !== "Shown" || hover.isToolbarHovered || model.open._tag === "ImageViewer")
			return { model }
		const version = model.hideVersion + 1
		return {
			model: modifyFields(model, {
				hideVersion: () => version,
				hover: () => Hover.HidePending({ messageId: hover.messageId, version }),
			}),
			commands: [WaitForHideToolbar({ version })],
		}
	},
	// The toolbar stays while its emoji picker is open (the picker is inside it).
	CompletedWaitForHideToolbar: ({ version }: { readonly version: number }): OverlaysReturn => {
		const hover = model.hover
		if (hover._tag !== "HidePending" || hover.version !== version) return { model }
		return {
			model: modifyFields(model, {
				hover: () =>
					model.open._tag === "ReactionPicker"
						? Hover.Shown({ messageId: hover.messageId, isToolbarHovered: false })
						: Hover.None(),
			}),
		}
	},
	// Entering the toolbar cancels a pending hide.
	EnteredToolbar: (): OverlaysReturn => {
		const hover = model.hover
		return hover._tag === "None"
			? { model }
			: {
					model: modifyFields(model, {
						hover: () => Hover.Shown({ messageId: hover.messageId, isToolbarHovered: true }),
					}),
				}
	},
	LeftToolbar: (): OverlaysReturn => {
		const hover = model.hover
		return hover._tag === "Shown" && hover.isToolbarHovered
			? {
					model: modifyFields(model, {
						hover: () => Hover.Shown({ messageId: hover.messageId, isToolbarHovered: false }),
					}),
				}
			: { model }
	},
})

export const update = (model: Model, message: Message): OverlaysReturn =>
	Message.match<OverlaysReturn>(message, {
		...hoverHandlers(model),
		GotToolbarMessage: ({ message: toolbarMessage }) => {
			const result = Toolbar.update(model.toolbar, toolbarMessage)
			return {
				model: modifyFields(model, { toolbar: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotToolbarMessage({ message: inner }),
				),
			}
		},
		GotTooltipMessage: ({ message: tooltipMessage }) => {
			const result = TooltipHost.update(activeTooltipOf(model), tooltipMessage, (inner) =>
				Message.GotTooltipMessage({ message: inner }),
			)
			const hoveredTrigger = nextTrigger(
				model.hoveredTrigger,
				tooltipMessage,
				"EnteredTrigger",
				"LeftTrigger",
			)
			const focusedTrigger = nextTrigger(
				model.focusedTrigger,
				tooltipMessage,
				"FocusedTrigger",
				"BlurredTrigger",
			)
			const isUnchanged =
				result.model === activeTooltipOf(model) &&
				(result.commands ?? []).length === 0 &&
				isSameTrigger(hoveredTrigger, model.hoveredTrigger) &&
				isSameTrigger(focusedTrigger, model.focusedTrigger)
			if (isUnchanged) return { model }
			// The host only moves to a trigger on that trigger's own message, so its id names the owner.
			const owner =
				result.model?.id === tooltipMessage.key ? tooltipMessage.messageId : model.tooltip?.messageId
			return {
				model: modifyFields(model, {
					tooltip: () =>
						result.model === null || owner === undefined
							? null
							: { messageId: owner, tooltip: result.model },
					hoveredTrigger: () =>
						isSameTrigger(hoveredTrigger, model.hoveredTrigger)
							? model.hoveredTrigger
							: hoveredTrigger,
					focusedTrigger: () =>
						isSameTrigger(focusedTrigger, model.focusedTrigger)
							? model.focusedTrigger
							: focusedTrigger,
				}),
				commands: result.commands,
			}
		},
		GotMoreMenuMessage: ({ messageId, message: menuMessage }) => {
			const result = Menu.update(moreMenuFor(model, messageId), menuMessage)
			return withSelection(
				withChild(model, result, {
					isCurrent: model.open._tag === "MoreMenu" && model.open.messageId === messageId,
					isOpen: isMenuOpen,
					toOpen: (menu) => OpenOverlay.MoreMenu({ messageId, menu }),
					wrap: (inner) => Message.GotMoreMenuMessage({ messageId, message: inner }),
				}),
				messageId,
				result.outMessage,
			)
		},
		RightClickedMessage: ({ messageId, offset, crossOffset }) => {
			const menu = Menu.init({ id: "message-context-menu", anchor: "Pointer" })
			return withChild(
				model,
				Menu.update(menu, Menu.Message.PressedContextMenu({ offset, crossOffset })),
				{
					isCurrent: true,
					isOpen: isMenuOpen,
					toOpen: (opened) => OpenOverlay.ContextMenu({ messageId, menu: opened }),
					wrap: (inner) => Message.GotContextMenuMessage({ message: inner }),
				},
			)
		},
		GotContextMenuMessage: ({ message: menuMessage }) => {
			const current = contextMenuOf(model)
			if (current === null) return { model }
			const result = Menu.update(current.menu, menuMessage)
			return withSelection(
				withChild(model, result, {
					isCurrent: true,
					isOpen: isMenuOpen,
					toOpen: (menu) => OpenOverlay.ContextMenu({ messageId: current.messageId, menu }),
					wrap: (inner) => Message.GotContextMenuMessage({ message: inner }),
				}),
				current.messageId,
				result.outMessage,
			)
		},
		GotPopoverMessage: ({ messageId, key, message: popoverMessage }) => {
			const isCurrent = model.open._tag === "Popover" && model.open.key === key
			const current =
				model.open._tag === "Popover" && isCurrent ? model.open.popover : Popover.init(key)
			return withChild(model, Popover.update(current, popoverMessage), {
				isCurrent,
				isOpen: (popover) => popover.isOpen,
				toOpen: (popover) => OpenOverlay.Popover({ messageId, key, popover }),
				wrap: (inner) => Message.GotPopoverMessage({ messageId, key, message: inner }),
			})
		},
		GotPinnedMessage: ({ message: popoverMessage }) => {
			const result = Popover.update(model.pinned, popoverMessage)
			return {
				model: modifyFields(model, { pinned: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotPinnedMessage({ message: inner }),
				),
			}
		},
		ClickedReply: ({ messageId }) => action(model, messageId, "reply"),
		ClickedDelete: ({ messageId }) => action(model, messageId, "delete"),
		ClickedCopy: ({ messageId }) => action(model, messageId, "copy"),
		ClickedEdit: ({ messageId }) => action(model, messageId, "edit"),
		ClickedReaction: ({ messageId, emoji }) => ({
			model,
			outMessage: OutMessage.RequestedReaction({ messageId, emoji }),
		}),
		ClickedAttachmentImage: ({ messageId, index }) => ({
			model: modifyFields(model, {
				open: () => OpenOverlay.ImageViewer({ messageId, index, urlImages: null }),
			}),
		}),
		ClickedEmbedImage: ({ messageId, images, index }) => ({
			model: modifyFields(model, {
				open: () => OpenOverlay.ImageViewer({ messageId, index, urlImages: images }),
			}),
		}),
		ClosedImageViewer: () =>
			model.open._tag === "ImageViewer"
				? { model: modifyFields(model, { open: () => OpenOverlay.None() }) }
				: { model },
		SelectedViewerImage: ({ index }) => {
			const viewer = imageViewerOf(model)
			return viewer === null
				? { model }
				: {
						model: modifyFields(model, {
							open: () =>
								OpenOverlay.ImageViewer({
									messageId: viewer.messageId,
									urlImages: viewer.urlImages,
									index,
								}),
						}),
					}
		},
		ClickedViewerAction: ({ action, url, fileName }) =>
			model.open._tag === "ImageViewer"
				? { model, outMessage: OutMessage.RequestedViewerAction({ action, url, fileName }) }
				: { model },
		GotReactionPickerMessage: ({ messageId, message: dialogMessage }) => {
			const isCurrent = model.open._tag === "ReactionPicker" && model.open.messageId === messageId
			const result = EmojiDialog.update(reactionPickerFor(model, messageId), dialogMessage)
			const next = {
				model:
					isCurrent || result.model.isOpen
						? modifyFields(model, {
								open: () =>
									result.model.isOpen
										? OpenOverlay.ReactionPicker({ messageId, dialog: result.model })
										: OpenOverlay.None(),
							})
						: model,
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotReactionPickerMessage({ messageId, message: inner }),
				),
			}
			// `handleReaction` with the picked emoji's string.
			return result.outMessage === undefined
				? next
				: {
						...next,
						outMessage: OutMessage.RequestedReaction({
							messageId,
							emoji: result.outMessage.emoji,
						}),
					}
		},
		GotReactionModalMessage: ({ message: modalMessage }) => {
			const current = reactionModalOf(model)
			if (current === null) return { model }
			const result = Modal.update(current.modal, modalMessage)
			return {
				model: modifyFields(model, {
					open: () =>
						result.model.isOpen
							? OpenOverlay.ReactionModal({ ...current, modal: result.model })
							: OpenOverlay.None(),
				}),
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotReactionModalMessage({ message: inner }),
				),
			}
		},
		GotReactionModalPickerMessage: ({ message: pickerMessage }) => {
			const current = reactionModalOf(model)
			if (current === null) return { model }
			const result = Picker.update(current.picker, pickerMessage)
			const commands = Command.mapMessages(result.commands ?? [], (inner) =>
				Message.GotReactionModalPickerMessage({ message: inner }),
			)
			// `handleReaction(emoji)` then `modal.close()`.
			return result.outMessage === undefined
				? {
						model: modifyFields(model, {
							open: () => OpenOverlay.ReactionModal({ ...current, picker: result.model }),
						}),
						commands,
					}
				: {
						model: modifyFields(model, { open: () => OpenOverlay.None() }),
						commands,
						outMessage: OutMessage.RequestedReaction({
							messageId: current.messageId,
							emoji: result.outMessage.emoji,
						}),
					}
		},
	})

/** Whether an open overlay renders inside this message's row (so the row cannot reuse its memo). */
export const ownsRow = (model: Model, messageId: MessageId): boolean =>
	model.tooltip?.messageId === messageId ||
	model.hoveredTrigger?.messageId === messageId ||
	(model.open._tag === "ContextMenu" && model.open.messageId === messageId) ||
	(model.open._tag === "Popover" && model.open.messageId === messageId)

/**
 * Rows left the window (deleted, or the window slid): a viewer on a gone message closes, and a
 * toolbar on a gone message hides (the open viewer kept `PointerLeftList` from hiding it).
 */
export const forgetMissingMessages = (model: Model, isShown: (messageId: MessageId) => boolean): Model => {
	const isViewerGone = model.open._tag === "ImageViewer" && !isShown(model.open.messageId)
	const hovered = hoveredMessageIdOf(model)
	const isHoverGone = hovered !== null && !isShown(hovered)
	if (!isViewerGone && !isHoverGone) return model
	return modifyFields(model, {
		open: (open) => (isViewerGone ? OpenOverlay.None() : open),
		hover: (hover) => (isHoverGone ? Hover.None() : hover),
	})
}

/** The context menu's "Add Reaction" opens the picker modal, which loads its data. */
export const openReactionModal = (model: Model, messageId: MessageId): OverlaysReturn => {
	const opened = Modal.open(Modal.init("reaction-picker-modal"))
	return {
		model: modifyFields(model, {
			open: () =>
				OpenOverlay.ReactionModal({
					messageId,
					modal: opened.model,
					picker: Picker.init("reaction-picker-modal-picker"),
				}),
		}),
		commands: [
			...Command.mapMessages(opened.commands ?? [], (message) =>
				Message.GotReactionModalMessage({ message }),
			),
			...Command.mapMessages([Picker.LoadEmojiData()], (message) =>
				Message.GotReactionModalPickerMessage({ message }),
			),
		],
	}
}
