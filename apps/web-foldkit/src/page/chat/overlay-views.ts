import type { Html, HtmlBuilder } from "foldkit/html"
import { Mount } from "foldkit"
import { cn } from "~/lib/utils"
import { IconClose, IconDotsVertical, IconStar, IconThread, IconWarning } from "../../icons"
import {
	HoverEvent,
	PlaceMessageToolbar,
	ToolbarEvent,
	TrackMessageHover,
	toolbarContent,
} from "../../chat/message/toolbar"
import { button } from "../../ui/button"
import { dialogDescription, dialogFooter, dialogHeader, dialogTitle } from "../../ui/dialog"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../ui/menu-view"
import * as Modal from "../../ui/modal"
import * as Toolbar from "../../ui/toolbar"
import { identityOf, toDeriveContext } from "./derive"
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
						Overlays.Message.RightClickedMessage({ messageId, offset, crossOffset }),
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
	return h.keyed("div")(
		`toolbar-${messageId}`,
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
									toTooltipMessage: (tooltip) =>
										toOverlay(Overlays.Message.GotTooltipMessage({ tooltip })),
									onReply: toOverlay(Overlays.Message.ClickedReply({ messageId })),
									onDelete: toOverlay(Overlays.Message.ClickedDelete({ messageId })),
									moreActions,
								}),
						},
						toParentMessage: (message) =>
							toOverlay(Overlays.Message.GotToolbarMessage({ message })),
					}),
				],
			),
		],
	)
}

/** `DeleteMessageModal` (opened from the toolbar or the context menu). */
export const deleteMessageModal = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: ToParent<M>,
): Html => {
	const modal = model.overlays.deleteModal
	if (!modal.isOpen) return h.empty
	return h.submodel({
		slotId: "delete-message-modal",
		model: modal,
		view: Modal.view,
		viewInputs: {
			toTrigger: (_attributes, overlay) => overlay,
			size: "md",
			toContent: (closeAttributes) => [
				dialogHeader(h, {}, [
					h.div(
						[
							h.Class(
								"flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5",
							),
						],
						[IconWarning(h, { className: "size-6 text-danger" })],
					),
					dialogTitle(h, { id: Modal.titleId(modal.id) }, "Delete message"),
					dialogDescription(
						h,
						"Are you sure you want to delete this message? This action cannot be undone.",
					),
				]),
				dialogFooter(h, [
					button(h, { intent: "outline", attributes: [...closeAttributes] }, ["Cancel"]),
					button(h, { intent: "danger", attributes: [...closeAttributes] }, ["Delete message"]),
				]),
			],
		},
		toParentMessage: (message) =>
			toOverlays(toParentMessage)(Overlays.Message.GotDeleteModalMessage({ message })),
	})
}

/** What `ReplyIndicator` shows: the replied-to author and first line. */
export interface ReplyPreview {
	readonly authorName: string
	readonly firstLine: string
}

let lastReply: ReplyPreview | null = null

/** The reply being composed, reusing the previous object while it shows the same text. */
export const replyPreviewOf = (model: Model): ReplyPreview | null => {
	const replyTo = model.overlays.replyToMessageId
	const message =
		replyTo === null ? undefined : model.messages.find((candidate) => candidate.id === replyTo)
	if (message === undefined) return (lastReply = null)
	const author = identityOf(
		toDeriveContext(model.lookups, model.currentUserId ?? undefined),
		message.authorId,
	)
	const next = { authorName: author?.displayName ?? "", firstLine: message.content.split("\n")[0] ?? "" }
	if (
		lastReply !== null &&
		lastReply.authorName === next.authorName &&
		lastReply.firstLine === next.firstLine
	)
		return lastReply
	return (lastReply = next)
}

/** `ReplyIndicator` above the composer while replying. */
export const replyIndicatorView = <M>(
	h: HtmlBuilder<M>,
	reply: ReplyPreview,
	toParentMessage: ToParent<M>,
): Html =>
	h.div(
		[
			h.Class(
				cn(
					"flex items-center justify-between gap-2 rounded-t-lg border border-border border-b-0 bg-secondary px-3 py-2",
				),
			),
		],
		[
			h.div(
				[h.Class("flex items-center gap-2 text-sm")],
				[
					h.span([h.Class("text-muted-fg")], ["Replying to"]),
					h.span([h.Class("font-semibold text-fg")], [reply.authorName]),
					h.span([h.Class("max-w-xs truncate text-muted-fg")], [reply.firstLine]),
				],
			),
			button(
				h,
				{
					size: "sq-xs",
					intent: "plain",
					className: "!p-1",
					onPress: toOverlays(toParentMessage)(Overlays.Message.ClickedCancelReply()),
					attributes: [h.Attribute("aria-label", "Cancel reply")],
				},
				[IconClose(h, { className: "size-3.5", attributes: { "data-slot": "icon" } })],
			),
		],
	)
