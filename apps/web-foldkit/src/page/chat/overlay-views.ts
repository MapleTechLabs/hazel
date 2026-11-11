import type { Html, HtmlBuilder } from "foldkit/html"
import * as EmojiDialog from "../../emoji-picker/dialog"
import { pickerView } from "../../emoji-picker/view"
import type * as Picker from "../../emoji-picker/picker"
import type * as TooltipHost from "../../chat/tooltip-host"
import { controlledModal, type Message as ModalMessage } from "../../ui/modal"
import { Mount } from "foldkit"
import { IconDotsVertical, IconStar, IconThread } from "../../icons"
import {
	HoverEvent,
	PlaceMessageToolbar,
	TOOLBAR_TARGET_ATTRIBUTE,
	ToolbarEvent,
	TrackMessageHover,
	toolbarContent,
} from "../../chat/message/toolbar"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../ui/menu-view"
import * as Toolbar from "../../ui/toolbar"
import * as Overlays from "./overlays"
import { factsOf, Message, type Model } from "./channel/page"

/** Overlays rendered outside the rows: hover toolbar, delete confirmation, reply indicator. */

type H = HtmlBuilder<Message>

const toOverlay = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })

const toTooltipMessage = (message: TooltipHost.Message) =>
	toOverlay(Overlays.Message.GotTooltipMessage({ message }))

const toToolbarMessage = (message: Toolbar.Message) =>
	toOverlay(Overlays.Message.GotToolbarMessage({ message }))

const toReactionModalMessage = (message: ModalMessage) =>
	toOverlay(Overlays.Message.GotReactionModalMessage({ message }))

const toReactionModalPickerMessage = (message: Picker.Message) =>
	toOverlay(Overlays.Message.GotReactionModalPickerMessage({ message }))

/** The list container's delegated hover and context menu handling. */
export const trackHoverAttribute = (h: H) =>
	h.OnMount(
		Mount.mapMessage(TrackMessageHover(), (event) =>
			toOverlay(
				HoverEvent.match(event, {
					PointerEnteredMessage: ({ messageId }) =>
						Overlays.Message.PointerEnteredMessage({ messageId }),
					PointerLeftList: () => Overlays.Message.PointerLeftList(),
					RightClickedMessage: ({ messageId, offset, crossOffset }) =>
						Overlays.Message.RightClickedMessage({
							messageId,
							offset,
							crossOffset,
						}),
				}),
			),
		),
	)

/** `MessageToolbar` in its body portal, for the hovered message. */
export const messageToolbarOverlay = (h: H, model: Model): Html => {
	const overlays = model.overlays
	const messageId = Overlays.hoveredMessageIdOf(overlays)
	const row = messageId === null ? undefined : model.rows.find((candidate) => candidate.key === messageId)
	if (messageId === null || row === undefined || row._tag !== "MessageRow") return h.empty
	const facts = factsOf(model)
	const menu = Overlays.moreMenuFor(overlays, messageId)
	const isPinned = facts.isPinned(messageId)
	const moreActions = h.submodel({
		slotId: "message-more-actions",
		model: menu,
		view: menuView,
		viewInputs: {
			entries: Overlays.moreMenuEntries(facts),
			toTrigger: (attributes, overlay) =>
				h.button(
					[
						...attributes,
						h.Attribute("aria-label", "More actions"),
						h.Class(menuTriggerClassName("p-1.5! rounded-md hover:bg-secondary")),
						h.Attribute("data-react-aria-pressable", "true"),
						h.Attribute("data-slot", "menu-trigger"),
						h.Attribute("tabindex", "0"),
						h.Attribute("type", "button"),
					],
					[IconDotsVertical(h, { className: "size-3.5" }), overlay],
				),
			content: (key) =>
				key === "thread"
					? [
							IconThread(h, { attributes: { "data-slot": "icon" } }),
							menuLabel(h, menu.id, key, "Reply in thread"),
						]
					: [
							IconStar(h, { attributes: { "data-slot": "icon" } }),
							menuLabel(h, menu.id, key, isPinned ? "Unpin message" : "Pin message"),
						],
		},
		toParentMessage: (message) => toOverlay(Overlays.Message.GotMoreMenuMessage({ messageId, message })),
	})
	// The slot stays in the column while the toolbar inside it is portaled to <body>. One slot for
	// every message: a hover change patches and retargets the toolbar instead of remounting it.
	return h.keyed("div")(
		"message-toolbar",
		[h.Style({ display: "contents" })],
		[
			h.div(
				[
					h.Role("group"),
					h.Attribute(TOOLBAR_TARGET_ATTRIBUTE, messageId),
					h.OnMount(
						Mount.mapMessage(PlaceMessageToolbar(), (event) =>
							toOverlay(
								ToolbarEvent.match(event, {
									EnteredToolbar: () => Overlays.Message.EnteredToolbar(),
									LeftToolbar: () => Overlays.Message.LeftToolbar(),
								}),
							),
						),
					),
				],
				[
					// Keyed by message: the buttons' Mounts and Submodel boundaries carry the message id.
					h.keyed("div")(
						messageId,
						[],
						[
							h.submodel({
								slotId: "message-toolbar",
								model: overlays.toolbar,
								view: Toolbar.view,
								viewInputs: {
									className: "rounded-lg border border-border bg-bg shadow-sm",
									content: () =>
										toolbarContent(h, {
											messageId,
											isOwnMessage: facts.isOwnMessage(messageId),
											tooltip: Overlays.activeTooltipOf(overlays),
											hoveredKey: overlays.hoveredTrigger?.key ?? null,
											focusedKey: overlays.focusedTrigger?.key ?? null,
											toTooltipMessage,
											onReact: (emoji) =>
												toOverlay(
													Overlays.Message.ClickedReaction({
														messageId,
														emoji,
													}),
												),
											onCopy: toOverlay(Overlays.Message.ClickedCopy({ messageId })),
											onEdit: toOverlay(Overlays.Message.ClickedEdit({ messageId })),
											onReply: toOverlay(Overlays.Message.ClickedReply({ messageId })),
											onDelete: toOverlay(
												Overlays.Message.ClickedDelete({ messageId }),
											),
											addReaction: (render) =>
												EmojiDialog.view(
													h,
													Overlays.reactionPickerFor(overlays, messageId),
													{
														toMessage: (message) =>
															toOverlay(
																Overlays.Message.GotReactionPickerMessage({
																	messageId,
																	message,
																}),
															),
														toTrigger: render,
														customEmojis: model.lookups.customEmojis,
													},
												),
											moreActions,
										}),
								},
								toParentMessage: toToolbarMessage,
							}),
						],
					),
				],
			),
		],
	)
}

/** The context menu's emoji picker modal (`ModalContent size="xs"` around the picker). */
export const reactionModalView = (h: H, model: Model): Html => {
	const current = Overlays.reactionModalOf(model.overlays)
	if (current === null) return h.empty
	return controlledModal(h, {
		model: current.modal,
		toParentMessage: toReactionModalMessage,
		size: "xs",
		closeButton: false,
		className: "overflow-hidden p-0!",
		toContent: () => [
			pickerView(h, current.picker, {
				toMessage: toReactionModalPickerMessage,
				className: "h-[420px]",
			}),
		],
	})
}
