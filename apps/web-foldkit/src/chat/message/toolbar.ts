import { MessageId } from "@hazel/schema"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconCopy, IconEdit, IconEmojiAdd, IconReply, IconTrash } from "../../icons"
import { LIST_PORTAL_ATTRIBUTE } from "../image-viewer"
import { button } from "../../ui/button"
import { separator } from "../../ui/separator"
import * as TooltipHost from "../tooltip-host"
import { MOBILE_QUERY } from "../../ui/viewport"

/** Port of `MessageToolbar` and the hover overlay around it (`useMessageToolbarOverlay`). */

/** The toolbar's quick reactions. */
export const TOP_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🎉"] as const

/** How far the toolbar overlaps the top of its message (`offset: -6` in legacy). */
const TOOLBAR_OVERLAP = 6
/** The toolbar's inset from the message's right edge. */
const TOOLBAR_RIGHT_INSET = 8
/** The least room the toolbar keeps from the edges of the list's scroller and the viewport. */
const EDGE_PADDING = 4

export const ToolbarEvent = defineMessageUnion({ EnteredToolbar: {}, LeftToolbar: {} })
export type ToolbarEvent = typeof ToolbarEvent.Type

/** The attribute naming the message the toolbar sits on; the view patches it as the hover moves. */
export const TOOLBAR_TARGET_ATTRIBUTE = "data-toolbar-message-id"

/** The attribute every message row carries, so the hover never mistakes another `data-id`. */
export const MESSAGE_ROW_ATTRIBUTE = "data-message-row"

const isScrollable = (element: Element) => {
	const { overflowY } = getComputedStyle(element)
	return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay"
}

/** The nearest scrolling ancestor of a message: the area the toolbar must stay inside. */
const scrollerOf = (element: Element): Element | null => {
	for (let current = element.parentElement; current !== null; current = current.parentElement)
		if (isScrollable(current)) return current
	return null
}

interface Bounds {
	readonly top: number
	readonly bottom: number
	readonly left: number
	readonly right: number
}

/**
 * Where the toolbar goes for its message: on the top right corner, overlapping the message a little.
 * It never leaves the list's scroller, so it cannot ride over the header, the composer or the sidebar
 * while its message scrolls away: near the top it slides down onto the message, and it hides once the
 * message is out of view, has no room left for it, or the scroller is too narrow to hold it.
 */
const toolbarPosition = (
	target: DOMRect,
	bounds: Bounds,
	size: { readonly width: number; readonly height: number },
): { readonly top: number; readonly left: number } | null => {
	const minTop = bounds.top + EDGE_PADDING
	const maxTop = Math.min(bounds.bottom, target.bottom) - size.height
	const minLeft = bounds.left + EDGE_PADDING
	const maxLeft = bounds.right - size.width - EDGE_PADDING
	if (target.top >= bounds.bottom || maxTop < minTop || maxLeft < minLeft) return null
	const top = Math.min(Math.max(target.top - size.height + TOOLBAR_OVERLAP, minTop), maxTop)
	const left = Math.max(minLeft, Math.min(target.right - size.width - TOOLBAR_RIGHT_INSET, maxLeft))
	return { top, left }
}

/**
 * Portals the toolbar to `<body>`, keeps it on its message and reports pointer enter and leave.
 * One toolbar element serves every message: a hover change retargets it instead of remounting it.
 *
 * Enter and leave are pointer events, like the list's tracking: pointer events all fire before mouse
 * events, so with `mouseleave` the toolbar's leave arrived after the list's enter and undid it.
 */
export const PlaceMessageToolbar = Mount.defineStream("PlaceMessageToolbar", {
	messages: [ToolbarEvent.EnteredToolbar, ToolbarEvent.LeftToolbar],
	execute: ({ element }) =>
		Stream.callback<ToolbarEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					if (!(element instanceof HTMLElement)) return () => undefined
					element.style.position = "fixed"
					element.style.top = "0px"
					element.style.left = "0px"
					element.style.zIndex = "50"
					element.style.visibility = "hidden"
					document.body.appendChild(element)
					const placed: {
						target: Element | null
						scroller: Element | null
						frame: number | undefined
					} = { target: null, scroller: null, frame: undefined }
					const hide = () => {
						element.style.visibility = "hidden"
						element.style.pointerEvents = "none"
					}
					const place = () => {
						placed.frame = undefined
						const target = placed.target
						if (target === null || !target.isConnected) return hide()
						const viewport = {
							top: 0,
							bottom: window.innerHeight,
							left: 0,
							right: window.innerWidth,
						}
						const bounds = placed.scroller?.getBoundingClientRect() ?? viewport
						const position = toolbarPosition(
							target.getBoundingClientRect(),
							{
								top: Math.max(bounds.top, viewport.top),
								bottom: Math.min(bounds.bottom, viewport.bottom),
								left: Math.max(bounds.left, viewport.left),
								right: Math.min(bounds.right, viewport.right),
							},
							{ width: element.offsetWidth, height: element.offsetHeight },
						)
						if (position === null) return hide()
						element.style.top = `${position.top}px`
						element.style.left = `${position.left}px`
						element.style.visibility = ""
						element.style.pointerEvents = ""
					}
					const schedule = () => {
						if (placed.frame === undefined) placed.frame = window.requestAnimationFrame(place)
					}
					const resizeObserver = new ResizeObserver(schedule)
					resizeObserver.observe(element)
					const retarget = () => {
						if (placed.target !== null) resizeObserver.unobserve(placed.target)
						if (placed.scroller !== null) resizeObserver.unobserve(placed.scroller)
						const messageId = element.getAttribute(TOOLBAR_TARGET_ATTRIBUTE)
						placed.target =
							messageId === null ? null : document.getElementById(`message-${messageId}`)
						placed.scroller = placed.target === null ? null : scrollerOf(placed.target)
						if (placed.target !== null) resizeObserver.observe(placed.target)
						// The scroller shrinks without scrolling when the composer grows (a reply preview).
						if (placed.scroller !== null) resizeObserver.observe(placed.scroller)
						// Placed in this frame, so a hover change never shows the toolbar on the old message.
						if (placed.frame !== undefined) window.cancelAnimationFrame(placed.frame)
						place()
					}
					retarget()
					const attributeObserver = new MutationObserver(retarget)
					attributeObserver.observe(element, {
						attributes: true,
						attributeFilter: [TOOLBAR_TARGET_ATTRIBUTE],
					})
					// Scroll events do not bubble; capturing on the window sees the list's scroller.
					window.addEventListener("scroll", schedule, { capture: true, passive: true })
					window.addEventListener("resize", schedule, { passive: true })
					const onEnter = () => Queue.offerUnsafe(queue, ToolbarEvent.EnteredToolbar())
					const onLeave = () => Queue.offerUnsafe(queue, ToolbarEvent.LeftToolbar())
					element.addEventListener("pointerenter", onEnter)
					element.addEventListener("pointerleave", onLeave)
					return () => {
						if (placed.frame !== undefined) window.cancelAnimationFrame(placed.frame)
						attributeObserver.disconnect()
						resizeObserver.disconnect()
						window.removeEventListener("scroll", schedule, { capture: true })
						window.removeEventListener("resize", schedule)
						element.removeEventListener("pointerenter", onEnter)
						element.removeEventListener("pointerleave", onLeave)
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

/**
 * How long after the last scroll event a hover change waits. Chromium groups wheel ticks into one
 * scroll and moves hover to the content under a resting pointer once it pauses, not per frame.
 */
const HOVER_AFTER_SCROLL_MS = 100

/**
 * `MessageListContent`'s delegated `onPointerOver` / `onPointerLeave`. The pointer over a message
 * hovers it; over anything else in the list (the gaps between groups, a date header) it leaves, like
 * the row's own `:hover` highlight, so the toolbar never stays on a message the pointer is not on.
 *
 * While the list scrolls under a resting pointer the hover holds still. Once scrolling pauses, the
 * element under the pointer's last position decides, since the browser may fire no `pointerover`
 * when the content moves under a still pointer.
 *
 * A phone has no hover: a finger down would flash the toolbar (and mobile Safari leaves a tapped
 * row hovered, so it would stick). There a long-press opens the message's actions as a sheet
 * (the `contextmenu` below), and the pointer never hovers a message.
 */
export const TrackMessageHover = Mount.defineStream("TrackMessageHover", {
	messages: [HoverEvent.PointerEnteredMessage, HoverEvent.PointerLeftList, HoverEvent.RightClickedMessage],
	execute: ({ element }) =>
		Stream.callback<HoverEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const pointer: {
						isInside: boolean
						x: number
						y: number
						scrollTimer: number | undefined
					} = { isInside: false, x: 0, y: 0, scrollTimer: undefined }
					/** Hovers the message `target` is in, or leaves when it is in none. */
					const resolve = (target: Element | null) => {
						if (target === null || !element.contains(target)) return
						if (window.matchMedia(MOBILE_QUERY).matches) return
						// The image viewer renders inside the list; it holds the hover while open.
						if (target.closest(`[data-${LIST_PORTAL_ATTRIBUTE}]`)) return
						const messageId = decodeMessageId(
							target.closest(`[${MESSAGE_ROW_ATTRIBUTE}]`)?.getAttribute("data-id"),
						)
						Queue.offerUnsafe(
							queue,
							Option.match(messageId, {
								onNone: () => HoverEvent.PointerLeftList(),
								onSome: (id) => HoverEvent.PointerEnteredMessage({ messageId: id }),
							}),
						)
					}
					const onScrollPaused = () => {
						pointer.scrollTimer = undefined
						if (pointer.isInside) resolve(document.elementFromPoint(pointer.x, pointer.y))
					}
					const onScroll = () => {
						window.clearTimeout(pointer.scrollTimer)
						pointer.scrollTimer = window.setTimeout(onScrollPaused, HOVER_AFTER_SCROLL_MS)
					}
					const onMove = (event: Event) => {
						if (!(event instanceof PointerEvent)) return
						pointer.isInside = true
						pointer.x = event.clientX
						pointer.y = event.clientY
					}
					const onOver = (event: Event) => {
						onMove(event)
						if (pointer.scrollTimer !== undefined) return
						resolve(event.target instanceof Element ? event.target : null)
					}
					// React's onPointerLeave follows the React tree: moving into a portal the list rendered is no leave.
					const onLeave = (event: Event) => {
						const entered = event instanceof PointerEvent ? event.relatedTarget : null
						if (entered instanceof Element && entered.closest(`[data-${LIST_PORTAL_ATTRIBUTE}]`))
							return
						pointer.isInside = false
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
					element.addEventListener("pointermove", onMove, { passive: true })
					element.addEventListener("pointerover", onOver)
					element.addEventListener("pointerleave", onLeave)
					element.addEventListener("contextmenu", onContextMenu)
					// Scroll events do not bubble: the list's scroller is a descendant.
					element.addEventListener("scroll", onScroll, { capture: true, passive: true })
					return () => {
						window.clearTimeout(pointer.scrollTimer)
						element.removeEventListener("pointermove", onMove)
						element.removeEventListener("scroll", onScroll, { capture: true })
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
	readonly messageId: MessageId
	readonly isOwnMessage: boolean
	readonly tooltip: TooltipHost.Model
	readonly hoveredKey: string | null
	/** The tooltip key of the focused toolbar button. */
	readonly focusedKey: string | null
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
		messageId: inputs.messageId,
		active: inputs.tooltip,
		hoveredKey: inputs.hoveredKey,
		toMessage: inputs.toTooltipMessage,
		content: [options.label],
		// The tooltip and the emoji picker render beside the button, never inside it.
		toTrigger: (attributes, overlay) =>
			h.div(
				[h.Class("contents")],
				[
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
								h.Attribute("data-react-aria-pressable", "true"),
								...(inputs.focusedKey === `${inputs.messageId}:toolbar:${options.key}`
									? [h.Attribute("data-focused", "true")]
									: []),
							],
						},
						[options.content],
					),
					overlay,
					options.overlay ?? h.empty,
				],
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
