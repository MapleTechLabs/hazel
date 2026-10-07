import { MessageId } from "@hazel/schema"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconCopy, IconEdit, IconEmojiAdd, IconReply, IconTrash } from "../../icons"
import { LIST_PORTAL_ATTRIBUTE } from "../image-viewer"
import { calculatePosition } from "../../ui/aria/position"
import { button } from "../../ui/button"
import { separator } from "../../ui/separator"
import * as TooltipHost from "../tooltip-host"

/** Port of `MessageToolbar` and the hover overlay around it (`useMessageToolbarOverlay`). */

/** `topEmojisAtom` with no usage data yet. */
export const TOP_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🎉"] as const

const POSITION_PADDING = 12

/** `useOverlayPosition({ placement: "top end", offset: -6, shouldFlip: true })`, with `zIndex: 50`. */
const placeToolbar = (overlay: HTMLElement, target: HTMLElement) => {
	overlay.style.position = "absolute"
	overlay.style.zIndex = "50"
	for (const side of ["top", "bottom", "left", "right"]) overlay.style.removeProperty(side)
	overlay.style.top = "0px"
	overlay.style.maxHeight = `${window.visualViewport?.height ?? window.innerHeight}px`
	const result = calculatePosition({
		placement: "top right",
		overlayNode: overlay,
		targetNode: target,
		scrollNode: overlay,
		padding: POSITION_PADDING,
		shouldFlip: true,
		boundaryElement: document.body,
		offset: -6,
		crossOffset: 0,
		maxHeight: undefined,
		arrowSize: 0,
		arrowBoundaryOffset: 0,
	})
	for (const side of ["top", "bottom", "left", "right"]) overlay.style.removeProperty(side)
	overlay.style.maxHeight = `${result.maxHeight}px`
	for (const [key, value] of Object.entries(result.position)) overlay.style.setProperty(key, `${value}px`)
}

export const ToolbarEvent = defineMessageUnion({ EnteredToolbar: {}, LeftToolbar: {} })
export type ToolbarEvent = typeof ToolbarEvent.Type

/** Portals the toolbar to `<body>`, keeps it on its message and reports pointer enter and leave. */
export const PlaceMessageToolbar = Mount.defineStream("PlaceMessageToolbar", {
	args: { messageId: Schema.String },
	messages: [ToolbarEvent.EnteredToolbar, ToolbarEvent.LeftToolbar],
	execute: ({ element, messageId }) =>
		Stream.callback<ToolbarEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const target = document.getElementById(`message-${messageId}`)
					if (!(element instanceof HTMLElement) || target === null) return () => undefined
					document.body.appendChild(element)
					const update = () => placeToolbar(element, target)
					update()
					const observer = new ResizeObserver(update)
					observer.observe(element)
					observer.observe(target)
					const onEnter = () => Queue.offerUnsafe(queue, ToolbarEvent.EnteredToolbar())
					const onLeave = () => Queue.offerUnsafe(queue, ToolbarEvent.LeftToolbar())
					element.addEventListener("mouseenter", onEnter)
					element.addEventListener("mouseleave", onLeave)
					return () => {
						observer.disconnect()
						element.removeEventListener("mouseenter", onEnter)
						element.removeEventListener("mouseleave", onLeave)
						element.remove()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

const decodeMessageId = Schema.decodeUnknownOption(MessageId)

export const HoverEvent = defineMessageUnion({
	PointerEnteredMessage: { messageId: MessageId },
	PointerLeftList: {},
	RightClickedMessage: { messageId: MessageId, offset: Schema.Number, crossOffset: Schema.Number },
})
export type HoverEvent = typeof HoverEvent.Type

/** `MessageListContent`'s delegated `onPointerOver` / `onPointerLeave`. */
export const TrackMessageHover = Mount.defineStream("TrackMessageHover", {
	messages: [HoverEvent.PointerEnteredMessage, HoverEvent.PointerLeftList, HoverEvent.RightClickedMessage],
	execute: ({ element }) =>
		Stream.callback<HoverEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const onOver = (event: Event) => {
						const target =
							event.target instanceof Element ? event.target.closest("[data-id]") : null
						const messageId = decodeMessageId(target?.getAttribute("data-id"))
						if (Option.isSome(messageId))
							Queue.offerUnsafe(
								queue,
								HoverEvent.PointerEnteredMessage({ messageId: messageId.value }),
							)
					}
					// React's onPointerLeave follows the React tree: moving into a portal the list rendered is no leave.
					const onLeave = (event: Event) => {
						const entered = event instanceof PointerEvent ? event.relatedTarget : null
						if (entered instanceof Element && entered.closest(`[data-${LIST_PORTAL_ATTRIBUTE}]`))
							return
						Queue.offerUnsafe(queue, HoverEvent.PointerLeftList())
					}
					// ContextMenuTrigger's `onContextMenu`, delegated; the open row handles its own.
					const onContextMenu = (event: Event) => {
						if (!(event instanceof MouseEvent) || event.defaultPrevented) return
						const trigger =
							event.target instanceof Element
								? event.target.closest('[aria-haspopup="menu"]')
								: null
						const messageId = decodeMessageId(
							trigger?.querySelector("[data-id]")?.getAttribute("data-id"),
						)
						if (!trigger || Option.isNone(messageId)) return
						event.preventDefault()
						const rect = trigger.getBoundingClientRect()
						Queue.offerUnsafe(
							queue,
							HoverEvent.RightClickedMessage({
								messageId: messageId.value,
								offset: event.clientY - rect.bottom,
								crossOffset: event.clientX - rect.left,
							}),
						)
					}
					element.addEventListener("pointerover", onOver)
					element.addEventListener("pointerleave", onLeave)
					element.addEventListener("contextmenu", onContextMenu)
					return () => {
						element.removeEventListener("contextmenu", onContextMenu)
						element.removeEventListener("pointerover", onOver)
						element.removeEventListener("pointerleave", onLeave)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

export interface ToolbarInputs<M> {
	readonly messageId: string
	readonly isOwnMessage: boolean
	readonly tooltip: TooltipHost.Model
	readonly hoveredKey: string | null
	readonly toTooltipMessage: (message: TooltipHost.Message) => M
	readonly onReact: (emoji: string) => M
	readonly onCopy: M
	readonly onEdit: M
	readonly onReply: M
	readonly onDelete: M
	/** The "Add reaction" button wrapped by its emoji picker (DialogTrigger). */
	readonly addReaction: (render: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html) => Html
	/** The "More actions" menu trigger with its menu. */
	readonly moreActions: Html
}

const ACTION_CLASS = "p-1.5! hover:bg-secondary"

/** A plain `sq-sm` toolbar button wrapped in its tooltip (React Aria's 1.5s delay). */
const action = <M>(
	h: HtmlBuilder<M>,
	inputs: ToolbarInputs<M>,
	options: {
		readonly key: string
		readonly label: string
		readonly className: string
		readonly content: Html | string
		readonly onPress?: M
		readonly extra?: ReadonlyArray<ChildAttribute>
		readonly overlay?: Html
	},
): Html =>
	TooltipHost.tooltipTrigger(h, {
		key: `${inputs.messageId}:toolbar:${options.key}`,
		active: inputs.tooltip,
		hoveredKey: inputs.hoveredKey,
		toMessage: inputs.toTooltipMessage,
		content: [options.label],
		toTrigger: (attributes, overlay) =>
			button(
				h,
				{
					size: "sq-sm",
					intent: "plain",
					className: options.className,
					...(options.onPress === undefined ? {} : { onPress: options.onPress }),
					attributes: [
						...attributes,
						...(options.extra ?? []),
						h.Attribute("aria-label", options.label),
						h.Attribute("data-rac", ""),
						h.Attribute("data-react-aria-pressable", "true"),
					],
				},
				[options.content, overlay, options.overlay ?? h.empty],
			),
	})

const icon = <M>(h: HtmlBuilder<M>, render: typeof IconCopy) =>
	render(h, { className: "size-3.5", attributes: { "data-slot": "icon" } })

/** `Toolbar` children of `MessageToolbar`. */
export const toolbarContent = <M>(h: HtmlBuilder<M>, inputs: ToolbarInputs<M>): ReadonlyArray<Html> => [
	...TOP_EMOJIS.slice(0, 3).map((emoji) =>
		action(h, inputs, {
			key: `react-${emoji}`,
			label: `React with ${emoji}`,
			className: "p-1.5! text-base hover:bg-secondary",
			content: emoji,
			onPress: inputs.onReact(emoji),
		}),
	),
	separator(h, { orientation: "vertical", className: "mx-0.5 h-4" }),
	inputs.addReaction((attributes, overlay) =>
		action(h, inputs, {
			key: "add-reaction",
			label: "Add reaction",
			className: ACTION_CLASS,
			content: icon(h, IconEmojiAdd),
			extra: attributes,
			overlay,
		}),
	),
	action(h, inputs, {
		key: "copy",
		label: "Copy message",
		className: ACTION_CLASS,
		content: icon(h, IconCopy),
		onPress: inputs.onCopy,
	}),
	...(inputs.isOwnMessage
		? [
				action(h, inputs, {
					key: "edit",
					label: "Edit message",
					className: ACTION_CLASS,
					content: icon(h, IconEdit),
					onPress: inputs.onEdit,
				}),
			]
		: []),
	action(h, inputs, {
		key: "reply",
		label: "Reply",
		className: ACTION_CLASS,
		content: icon(h, IconReply),
		onPress: inputs.onReply,
	}),
	...(inputs.isOwnMessage
		? [
				action(h, inputs, {
					key: "delete",
					label: "Delete message",
					className: "p-1.5! text-danger hover:bg-danger/10",
					content: icon(h, IconTrash),
					onPress: inputs.onDelete,
				}),
			]
		: []),
	separator(h, { orientation: "vertical", className: "mx-0.5 h-4" }),
	inputs.moreActions,
]
