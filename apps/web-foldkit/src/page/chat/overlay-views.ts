import type { Html, HtmlBuilder } from "foldkit/html"
import * as EmojiDialog from "../../emoji-picker/dialog"
import { pickerView } from "../../emoji-picker/view"
import { controlledModal } from "../../ui/modal"
import { Mount } from "foldkit"
import { IconDotsVertical, IconStar, IconThread } from "../../icons"
import {
	HoverEvent,
	PlaceMessageToolbar,
	ToolbarEvent,
	TrackMessageHover,
	toolbarContent,
} from "../../chat/message/toolbar"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../ui/menu-view"
import * as Toolbar from "../../ui/toolbar"
import * as Overlays from "./overlays"
import { factsOf, Message, type Model } from "./channel/page"

/** Overlays rendered outside the rows: hover toolbar, delete confirmation, reply indicator. */

type ToParent<M> = (message: Message) => M

const toOverlays =
	<M>(toParentMessage: ToParent<M>) =>
	(message: Overlays.Message) =>
		toParentMessage(Message.GotOverlaysMessage({ message }))

/** The list container's delegated hover and context menu handling. */
export const trackHoverAttribute = <M>(h: HtmlBuilder<M>, toParentMessage: ToParent<M>) =>
	h.OnMount(
		Mount.mapMessage(TrackMessageHover(), (event) =>
			toOverlays(toParentMessage)(
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
export const messageToolbarOverlay = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: ToParent<M>,
): Html => {
	const overlays = model.overlays
	const messageId = overlays.hoveredMessageId
	const row = messageId === null ? undefined : model.rows.find((candidate) => candidate.key === messageId)
	if (messageId === null || row === undefined || row._tag !== "MessageRow") return h.empty
	const toOverlay = toOverlays(toParentMessage)
	const facts = factsOf(model)
	const menu = Overlays.moreMenuFor(overlays, messageId, facts)
	const isPinned = facts.isPinned(messageId)
	const moreActions = h.submodel({
		slotId: "message-more-actions",
		model: menu,
		view: menuView,
		viewInputs: {
			toTrigger: (attributes, overlay) =>
				h.button(
					[
						...attributes,
						h.Attribute("aria-label", "More actions"),
						h.Class(menuTriggerClassName("p-1.5! rounded-md hover:bg-secondary")),
						h.Attribute("data-rac", ""),
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
	// The keyed slot stays in the column while the toolbar inside it is portaled to <body>, so
	// hovering another message replaces the slot instead of inserting before a node in <body>.
	return h.keyed("div")(
		`toolbar-${messageId}`,
		[h.Style({ display: "contents" })],
		[
			h.div(
				[
					h.Role("group"),
					h.OnMount(
						Mount.mapMessage(PlaceMessageToolbar({ messageId }), (event) =>
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
					h.div(
						[h.Class("-m-3 p-3")],
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
											tooltip: overlays.tooltip,
											hoveredKey: overlays.hoveredTriggerKey,
											focusedKey: overlays.focusedTriggerKey,
											toTooltipMessage: (tooltip) =>
												toOverlay(Overlays.Message.GotTooltipMessage({ tooltip })),
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
													overlays.reactionPicker?.messageId === messageId
														? overlays.reactionPicker.dialog
														: EmojiDialog.init(`reaction-picker-${messageId}`),
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
								toParentMessage: (message) =>
									toOverlay(Overlays.Message.GotToolbarMessage({ message })),
							}),
						],
					),
				],
			),
		],
	)
}

/** The context menu's emoji picker modal (`ModalContent size="xs"` around the picker). */
export const reactionModalView = <M>(h: HtmlBuilder<M>, model: Model, toParentMessage: ToParent<M>): Html => {
	const current = model.overlays.reactionModal
	if (current === null) return h.empty
	const toOverlay = toOverlays(toParentMessage)
	return controlledModal(h, {
		model: current.modal,
		toParentMessage: (message) => toOverlay(Overlays.Message.GotReactionModalMessage({ message })),
		size: "xs",
		closeButton: false,
		className: "overflow-hidden p-0!",
		toContent: () => [
			pickerView(h, current.picker, {
				toMessage: (message) =>
					toOverlay(Overlays.Message.GotReactionModalPickerMessage({ message })),
				className: "h-[420px]",
			}),
		],
	})
}
