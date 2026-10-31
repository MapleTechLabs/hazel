import type { Html, HtmlBuilder } from "foldkit/html"
import { handleStyles, indicatorStyles, panelStyles } from "~/components/ui/split-panel/split-panel.styles"
import { format } from "date-fns"
import { htmlRenderView } from "../../chat/embeds/html-render"
import type * as HtmlRender from "../../chat/html-render"
import { messageRowView, type RowContext } from "../../chat/message/row"
import { markdownView } from "../../chat/markdown/markdown-view"
import { IconClose, IconEdit, IconPenSparkle } from "../../icons"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import { type DeriveContext, authorIdentity, htmlRendersOf } from "./derive"
import type { ChatMessage, MessageRow } from "./rows"

/** Port of `SplitPanel` + `ThreadPanel` (header, original message, `ThreadMessageList`, composer). */

const PANEL_WIDTH = 480

export interface ThreadPanelInputs<M> {
	readonly threadName: string
	readonly original: ChatMessage | null
	/** The replies' rows, derived in `update` (`toThreadRows`). */
	readonly rows: ReadonlyArray<MessageRow>
	readonly context: DeriveContext
	readonly rowContext: RowContext<M>
	/** The original message's HTML render frames, on the thread surface. */
	readonly toHtmlRenderMessage: (message: HtmlRender.Message) => M
	readonly onClose: M
	readonly onGenerateName: M
	readonly onRename: M
	readonly isGeneratingName: boolean
	/** `isThreadCreating`: the composer waits for `channel.createThread`. */
	readonly isCreating: boolean
	/** The thread's own composer (`SlateMessageComposer placeholder="Reply in thread..."`). */
	readonly composer: Html
}

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
			attributes: [h.Attribute("aria-label", label)],
		},
		[icon],
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

const originalView = <M>(
	h: HtmlBuilder<M>,
	original: ChatMessage,
	context: DeriveContext,
	toHtmlRenderMessage: (message: HtmlRender.Message) => M,
): Html => {
	const author = authorIdentity(original.author, context.botNames.get(original.authorId))
	// Capped: a tall HTML render scrolls here instead of squeezing the replies.
	return h.div(
		[h.Class("max-h-[45vh] shrink-0 overflow-y-auto border-border border-b bg-secondary px-4 py-3")],
		[
			h.div(
				[h.Class("flex gap-3")],
				[
					avatar(h, {
						src: author.avatarUrl,
						seed: author.displayName || undefined,
						alt: author.displayName,
						className: "size-9",
					}),
					h.div(
						[h.Class("min-w-0 flex-1")],
						[
							h.div(
								[h.Class("flex items-baseline gap-2")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], [author.displayName]),
									h.span(
										[h.Class("text-muted-fg text-xs")],
										[format(new Date(original.createdAtMs), "MMM d, HH:mm")],
									),
								],
							),
							h.div([h.Class("mt-1")], [markdownView(h, original.content)]),
							originalRendersView(h, original, context, toHtmlRenderMessage),
						],
					),
				],
			),
		],
	)
}

const listView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html =>
	inputs.rows.length === 0
		? h.div(
				[h.Class("flex h-full items-center justify-center p-4")],
				[h.p([h.Class("text-muted-fg")], ["No replies yet. Start the conversation!"])],
			)
		: h.div(
				[h.Class("flex h-full flex-col overflow-y-auto px-2 py-2")],
				// Keyed by message, so a reply arriving or deleted never re-renders the rows after it.
				inputs.rows.map((row) =>
					h.keyed("div")(
						row.key,
						[h.Style({ display: "contents" })],
						[messageRowView(h, row, inputs.rowContext)],
					),
				),
			)

export const threadPanelView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html =>
	h.div(
		[
			h.Class(panelStyles({ position: "right" })),
			h.Attribute("data-position", "right"),
			h.Attribute("style", `width: ${PANEL_WIDTH}px; opacity: 1;`),
		],
		[
			h.div(
				[
					h.Attribute("aria-label", "Resize thread panel"),
					h.Attribute("aria-orientation", "vertical"),
					h.Attribute("aria-valuemax", "600"),
					h.Attribute("aria-valuemin", "320"),
					h.Attribute("aria-valuenow", String(PANEL_WIDTH)),
					h.Class(handleStyles({ position: "right", isDragging: false })),
					h.Attribute("data-dragging", "false"),
					h.Role("separator"),
					h.Attribute("tabindex", "0"),
				],
				[h.div([h.Class(indicatorStyles({ position: "right", isDragging: false }))])],
			),
			h.div(
				[h.Class("flex h-full min-h-0 flex-1 flex-col overflow-hidden")],
				[
					h.div(
						[h.Class("flex h-full flex-col border-border border-l bg-bg")],
						[
							h.div(
								[
									h.Class(
										"flex items-center justify-between border-border border-b bg-bg px-4 py-3",
									),
								],
								[
									h.div(
										[h.Class("flex items-center gap-2")],
										[h.h2([h.Class("font-semibold text-fg")], [inputs.threadName])],
									),
									h.div(
										[h.Class("flex items-center gap-1")],
										[
											headerButton(
												h,
												"Generate thread name",
												inputs.isGeneratingName
													? loader(h, { className: "size-4" })
													: IconPenSparkle(h, {
															className: "size-4",
															attributes: { "data-slot": "icon" },
														}),
												inputs.onGenerateName,
												inputs.isGeneratingName,
											),
											headerButton(
												h,
												"Rename thread",
												IconEdit(h, {
													className: "size-4",
													attributes: { "data-slot": "icon" },
												}),
												inputs.onRename,
											),
											headerButton(
												h,
												"Close thread",
												IconClose(h, {
													className: "size-4",
													attributes: { "data-slot": "icon" },
												}),
												inputs.onClose,
											),
										],
									),
								],
							),
							inputs.original === null
								? h.empty
								: originalView(
										h,
										inputs.original,
										inputs.context,
										inputs.toHtmlRenderMessage,
									),
							h.div([h.Class("flex-1 overflow-hidden bg-bg")], [listView(h, inputs)]),
							h.div(
								[h.Class("border-border border-t bg-bg px-4 py-3")],
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
			),
		],
	)
