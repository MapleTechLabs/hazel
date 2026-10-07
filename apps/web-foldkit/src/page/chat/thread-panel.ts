import type { Html, HtmlBuilder } from "foldkit/html"
import { handleStyles, indicatorStyles, panelStyles } from "~/components/ui/split-panel/split-panel.styles"
import { format } from "~/lib/date-fns-shared"
import { messageRowView, type RowContext } from "../../chat/message/row"
import { markdownView } from "../../chat/markdown/markdown-view"
import { IconClose, IconEdit, IconPenSparkle } from "../../icons"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { composerBoxView } from "./composer-placeholder"
import { type DeriveContext, authorIdentity, messageRowData } from "./derive"
import type { ChatMessage, GroupPosition, MessageRow } from "./rows"

/** Port of `SplitPanel` + `ThreadPanel` (header, original message, `ThreadMessageList`, composer). */

const GROUP_THRESHOLD_MS = 3 * 60 * 1000
const PANEL_WIDTH = 480

/** `ThreadMessageListContent`'s grouping (oldest first). */
const groupPositionAt = (messages: ReadonlyArray<ChatMessage>, index: number): GroupPosition => {
	const message = messages[index]!
	const previous = index > 0 ? messages[index - 1]! : null
	const next = index < messages.length - 1 ? messages[index + 1]! : null
	const isStart =
		previous === null ||
		message.authorId !== previous.authorId ||
		message.createdAtMs - previous.createdAtMs > GROUP_THRESHOLD_MS ||
		previous.replyToMessageId !== null
	const isEnd =
		next === null ||
		message.authorId !== next.authorId ||
		next.createdAtMs - message.createdAtMs > GROUP_THRESHOLD_MS
	return isStart && isEnd ? "standalone" : isStart ? "start" : isEnd ? "end" : "middle"
}

export interface ThreadPanelInputs<M> {
	readonly threadName: string
	readonly original: ChatMessage | null
	readonly messages: ReadonlyArray<ChatMessage>
	readonly context: DeriveContext
	readonly rowContext: RowContext<M>
	readonly onClose: M
}

const headerButton = <M>(h: HtmlBuilder<M>, label: string, icon: Html, onPress?: M): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			className: "rounded p-1 hover:bg-secondary",
			...(onPress === undefined ? {} : { onPress }),
			attributes: [h.Attribute("aria-label", label)],
		},
		[icon],
	)

const originalView = <M>(h: HtmlBuilder<M>, original: ChatMessage, context: DeriveContext): Html => {
	const author = authorIdentity(original.author, context.botNames.get(original.authorId))
	return h.div(
		[h.Class("border-border border-b bg-secondary px-4 py-3")],
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
						],
					),
				],
			),
		],
	)
}

const listView = <M>(h: HtmlBuilder<M>, inputs: ThreadPanelInputs<M>): Html =>
	inputs.messages.length === 0
		? h.div(
				[h.Class("flex h-full items-center justify-center p-4")],
				[h.p([h.Class("text-muted-fg")], ["No replies yet. Start the conversation!"])],
			)
		: h.div(
				[h.Class("flex h-full flex-col overflow-y-auto px-2 py-2")],
				inputs.messages.map((message, index) => {
					const row: MessageRow = {
						_tag: "MessageRow",
						...messageRowData(
							message,
							groupPositionAt(inputs.messages, index),
							[],
							inputs.context,
						),
						thread: null,
					}
					return messageRowView(h, row, inputs.rowContext)
				}),
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
				[h.div([h.Class(indicatorStyles({ position: "right", isDragging: false }))], [])],
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
												IconPenSparkle(h, {
													className: "size-4",
													attributes: { "data-slot": "icon" },
												}),
											),
											headerButton(
												h,
												"Rename thread",
												IconEdit(h, {
													className: "size-4",
													attributes: { "data-slot": "icon" },
												}),
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
								: originalView(h, inputs.original, inputs.context),
							h.div([h.Class("flex-1 overflow-hidden bg-bg")], [listView(h, inputs)]),
							h.div(
								[h.Class("border-border border-t bg-bg px-4 py-3")],
								[
									composerBoxView(h, {
										placeholder: "Reply in thread...",
										replyIndicator: null,
									}),
								],
							),
						],
					),
				],
			),
		],
	)
