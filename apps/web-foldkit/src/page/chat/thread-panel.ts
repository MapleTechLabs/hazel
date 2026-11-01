import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { handleStyles, indicatorStyles, panelStyles } from "~/components/ui/split-panel/split-panel.styles"
import { cn } from "~/lib/utils"
import { attachmentsView } from "../../chat/attachments"
import { htmlRenderView } from "../../chat/embeds/html-render"
import type * as HtmlRender from "../../chat/html-render"
import { formatTime } from "../../chat/message/parts"
import { messageRowView, type RowContext } from "../../chat/message/row"
import { markdownView } from "../../chat/markdown/markdown-view"
import { IconClose, IconEdit, IconMaximize, IconPenSparkle, IconThread } from "../../icons"
import { avatar } from "../../ui/avatar"
import { button, buttonClassName } from "../../ui/button"
import { loader } from "../../ui/loader"
import { MIN_CHANNEL_WIDTH, MIN_THREAD_PANEL_WIDTH } from "./channel/thread-width"
import { type DeriveContext, authorIdentity, htmlRendersOf } from "./derive"
import type { ChatMessage, MessageRow } from "./rows"

/**
 * Discord's thread sidebar: a resizable panel beside the channel with the thread's header, its
 * starter message and replies in one scroll, and its composer.
 */

/** The px an arrow key moves the focused edge. */
const KEYBOARD_STEP = 24

export interface ThreadPanelInputs<M> {
	readonly threadName: string
	readonly original: ChatMessage | null
	/** The original's row in the channel list (its mentions and attachments); null outside the window. */
	readonly originalRow: MessageRow | null
	/** The replies' rows, derived in `update` (`toThreadRows`). */
	readonly rows: ReadonlyArray<MessageRow>
	readonly context: DeriveContext
	readonly rowContext: RowContext<M>
	/** The original message's HTML render frames, on the thread surface. */
	readonly toHtmlRenderMessage: (message: HtmlRender.Message) => M
	readonly width: number
	readonly isResizing: boolean
	/** The edge was grabbed: the panel's rendered width and the widest the channel leaves room for. */
	readonly toPressEdge: (clientX: number, startWidth: number, maxWidth: number) => M
	/** An arrow key on the focused edge, by the px it moves (left widens). */
	readonly toNudgeEdge: (delta: number) => M
	/** The thread's own page ("Open in full view"); null while the thread is being created. */
	readonly fullViewHref: string | null
	readonly onClose: M
	readonly onGenerateName: M
	readonly onRename: M
	readonly isGeneratingName: boolean
	/** `isThreadCreating`: the composer waits for `channel.createThread`. */
	readonly isCreating: boolean
	/** The thread's own composer (`SlateMessageComposer placeholder="Reply in thread..."`). */
	readonly composer: Html
}

const iconAttributes = { "data-slot": "icon" }

const headerButton = <M>(
	h: HtmlBuilder<M>,
	label: string,
	icon: Html,
	onPress: M,
	isDisabled = false,
): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			className: "rounded p-1 hover:bg-secondary",
			onPress,
			isDisabled,
			attributes: [h.Attribute("aria-label", label), h.Attribute("title", label)],
		},
		[icon],
	)

/** "Open in full view": a link to the thread's own channel page. */
const fullViewLink = <M>(h: HtmlBuilder<M>, href: string | null): Html =>
	href === null
		? h.empty
		: h.a(
				[
					h.Href(href),
					h.Attribute("aria-label", "Open in full view"),
					h.Attribute("title", "Open in full view"),
					h.Class(
						buttonClassName({ intent: "plain", size: "sq-sm" }, "rounded p-1 hover:bg-secondary"),
					),
				],
				[IconMaximize(h, { className: "size-4", attributes: iconAttributes })],
			)

/** The panel and the root it sits in, read off the grabbed edge. */
const measureEdge = (target: EventTarget | null, fallbackWidth: number) => {
	const panel = target instanceof Element ? target.closest("[data-thread-panel]") : null
	const root = panel?.parentElement ?? null
	return {
		startWidth: panel?.getBoundingClientRect().width ?? fallbackWidth,
		maxWidth: root === null ? fallbackWidth : root.getBoundingClientRect().width - MIN_CHANNEL_WIDTH,
	}
}

const edgeView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html =>
	h.div(
		[
			h.Role("separator"),
			h.Attribute("aria-label", "Resize thread panel"),
			h.Attribute("aria-orientation", "vertical"),
			h.Attribute("aria-valuemin", String(MIN_THREAD_PANEL_WIDTH)),
			h.Attribute("aria-valuenow", String(inputs.width)),
			h.Attribute("tabindex", "0"),
			h.Attribute("data-dragging", String(inputs.isResizing)),
			h.Class(
				cn(
					handleStyles({ position: "right", isDragging: inputs.isResizing }),
					"group w-1.5 touch-none max-md:hidden",
				),
			),
			h.OnPointerDown(
				(_pointerType, button, _screenX, _screenY, _timeStamp, clientX, _y, _id, target) => {
					if (button !== 0) return Option.none()
					const { startWidth, maxWidth } = measureEdge(target, inputs.width)
					return Option.some(inputs.toPressEdge(clientX, startWidth, maxWidth))
				},
			),
			h.OnKeyDownPreventDefault((key) =>
				key === "ArrowLeft"
					? Option.some(inputs.toNudgeEdge(KEYBOARD_STEP))
					: key === "ArrowRight"
						? Option.some(inputs.toNudgeEdge(-KEYBOARD_STEP))
						: Option.none(),
			),
		],
		[h.div([h.Class(indicatorStyles({ position: "right", isDragging: inputs.isResizing }))])],
	)

const headerView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html =>
	h.div(
		[h.Class("flex h-14 shrink-0 items-center justify-between gap-2 border-border border-b bg-bg px-4")],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-2")],
				[
					IconThread(h, { className: "size-4 shrink-0 text-muted-fg" }),
					h.h2([h.Class("truncate font-semibold text-fg text-sm")], [inputs.threadName]),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-1")],
				[
					headerButton(
						h,
						"Generate thread name",
						inputs.isGeneratingName
							? loader(h, { className: "size-4" })
							: IconPenSparkle(h, { className: "size-4", attributes: iconAttributes }),
						inputs.onGenerateName,
						inputs.isGeneratingName,
					),
					headerButton(
						h,
						"Rename thread",
						IconEdit(h, { className: "size-4", attributes: iconAttributes }),
						inputs.onRename,
					),
					fullViewLink(h, inputs.fullViewHref),
					headerButton(
						h,
						"Close thread",
						IconClose(h, { className: "size-4", attributes: iconAttributes }),
						inputs.onClose,
					),
				],
			),
		],
	)

/** The original message's HTML renders, in their own frames: the list's copy is sized for its width. */
const originalRendersView = <M>(
	h: HtmlBuilder<M>,
	original: ChatMessage,
	context: DeriveContext,
	toMessage: (message: HtmlRender.Message) => M,
): Html => {
	const renders = (original.embeds ?? []).flatMap((embed) => (embed.html === undefined ? [] : [embed.html]))
	if (renders.length === 0) return h.empty
	const renderContext = {
		channelId: original.channelId,
		messageId: original.id,
		surface: "thread" as const,
		rows: htmlRendersOf(context, original, "thread"),
		toMessage,
	}
	return h.div(
		[h.Class("mt-2 flex flex-col gap-2")],
		renders.map((html) => htmlRenderView(h, html, renderContext)),
	)
}

/** The thread's opening: its icon, name and who started it. */
const introView = <M>(h: HtmlBuilder<M>, threadName: string, starterName: string | null): Html =>
	h.div(
		[h.Class("px-2.5 pt-6 pb-2")],
		[
			h.div(
				[h.Class("mb-3 flex size-12 items-center justify-center rounded-full bg-secondary")],
				[IconThread(h, { className: "size-6 text-fg" })],
			),
			h.h3([h.Class("break-words font-semibold text-fg text-xl")], [threadName]),
			starterName === null
				? h.empty
				: h.p(
						[h.Class("mt-1 text-muted-fg text-sm")],
						["Started by ", h.span([h.Class("font-medium text-fg")], [starterName])],
					),
		],
	)

/** The starter message, laid out like a list row. */
const originalView = <M>(h: HtmlBuilder<M>, original: ChatMessage, inputs: ThreadPanelInputs<M>): Html => {
	const { context, originalRow, rowContext } = inputs
	const author = authorIdentity(original.author, context.botNames.get(original.authorId))
	return h.div(
		[h.Class("flex gap-4 px-2.5 py-2")],
		[
			avatar(h, {
				size: "md",
				src: author.avatarUrl,
				seed: author.displayName || undefined,
				alt: author.displayName,
			}),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-baseline gap-2")],
						[
							h.span([h.Class("font-semibold text-fg")], [author.displayName]),
							h.span([h.Class("text-muted-fg text-xs")], [formatTime(original.createdAtMs)]),
						],
					),
					markdownView(h, original.content, originalRow?.refs),
					originalRow === null
						? h.empty
						: attachmentsView(h, originalRow.attachments, {
								toOpenImage: (index) => rowContext.toOpenImage(original.id, index),
							}),
					originalRendersView(h, original, context, inputs.toHtmlRenderMessage),
				],
			),
		],
	)
}

/** The line between the starter message and the replies. */
const dividerView = <M>(h: HtmlBuilder<M>, count: number): Html =>
	h.div(
		[h.Class("mx-2.5 my-2 flex items-center gap-2 text-muted-fg text-xs")],
		[
			h.span([], [count === 0 ? "No replies yet" : `${count} ${count === 1 ? "reply" : "replies"}`]),
			h.div([h.Class("h-px flex-1 bg-border")]),
		],
	)

/**
 * One scroll for the opening, the starter and the replies. `flex-col-reverse` starts it at the newest
 * reply and keeps it there as replies arrive, like Discord's.
 */
const scrollView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html => {
	const starterName =
		inputs.original === null
			? null
			: authorIdentity(inputs.original.author, inputs.context.botNames.get(inputs.original.authorId))
					.displayName
	return h.div(
		[h.Class("flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-bg")],
		[
			h.div(
				[h.Class("flex flex-col px-2 pb-2")],
				[
					introView(h, inputs.threadName, starterName),
					inputs.original === null ? h.empty : originalView(h, inputs.original, inputs),
					dividerView(h, inputs.rows.length),
					// Keyed by message, so a reply arriving or deleted never re-renders the rows after it.
					...inputs.rows.map((row) =>
						h.keyed("div")(
							row.key,
							[h.Style({ display: "contents" })],
							[messageRowView(h, row, inputs.rowContext)],
						),
					),
				],
			),
		],
	)
}

export const threadPanelView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html =>
	h.div(
		[
			// Below `md` there is no room beside the channel: the panel covers it, full width.
			h.Class(
				cn(
					panelStyles({ position: "right" }),
					"max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full! max-md:max-w-none! max-md:border-l-0",
				),
			),
			h.Attribute("data-position", "right"),
			h.Attribute("data-thread-panel", ""),
			h.Attribute("style", `width: ${inputs.width}px; max-width: calc(100% - ${MIN_CHANNEL_WIDTH}px);`),
		],
		[
			edgeView(h, inputs),
			h.div(
				[h.Class("flex h-full min-h-0 flex-1 flex-col overflow-hidden")],
				[
					headerView(h, inputs),
					scrollView(h, inputs),
					h.div(
						[h.Class("relative shrink-0 bg-bg px-4 pt-2.5 pb-4")],
						[
							inputs.isCreating
								? h.div(
										[
											h.Class(
												"flex items-center justify-center gap-2 py-3 text-muted-fg text-sm",
											),
										],
										[loader(h, { className: "size-4" }), "Creating thread..."],
									)
								: inputs.composer,
						],
					),
				],
			),
		],
	)
