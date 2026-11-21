import type { Assistant } from "@hazel/domain/models"
import { Match, Option } from "effect"
import { Submodel } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { markdownView } from "../chat/markdown/markdown-view"
import {
	IconArrowUp,
	IconBrainSparkle,
	IconCheck,
	IconChevronRight,
	IconClock,
	IconClose,
	IconCode,
	IconExternalLink,
	IconLock,
	IconPlus,
	IconSparkles,
	IconUsers,
	IconWarning,
} from "../icons"
import type { Shared } from "../page/contract"
import { integrationRoute, hrefOf } from "../route"
import { ariaButton, button, buttonClassName } from "../ui/button"
import { emptyState } from "../ui/empty-state"
import { heading } from "../ui/heading"
import { loader } from "../ui/loader"
import * as Menu from "../ui/menu"
import { menuDescription, menuLabel, view as menuView } from "../ui/menu-view"
import * as Sheet from "../ui/sheet"
import { resizeEdge, splitPanelClassName } from "../ui/split-panel"
import { textarea } from "../ui/textarea"
import { toggleChip } from "../ui/toggle-chip"
import { suggestionsFor } from "./context"
import { Message } from "./message"
import {
	COMPOSER_ID,
	type ItemRow,
	type Model,
	NEW_CHAT_KEY,
	PANEL_ID,
	type QuestionData,
	type ThreadRow,
} from "./model"
import { historyOf, timelineOf, workSummaryOf } from "./timeline"
import {
	answersOf,
	isReadOnly,
	MIN_PAGE_WIDTH,
	MIN_WIDTH,
	pendingOf,
	sheetModelOf,
	threadOf,
	widthOf,
} from "./update"

/**
 * The panel, in the style of T3 Code's chat: a header with the thread's actions, the timeline (the
 * member's messages as bubbles, replies full width, the agent's steps folded into work logs) and
 * the composer with the page's context chip.
 */

export interface ViewInputs {
	readonly shared: Shared
	readonly context: Assistant.Context | null
}

type H = HtmlBuilder<Message>

const ICON = "size-4"

const iconButton = (
	h: H,
	label: string,
	icon: Html,
	onPress: Message,
	extra: ReadonlyArray<ChildAttribute> = [],
) =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			onPress,
			attributes: [h.AriaLabel(label), h.Attribute("title", label), ...extra],
		},
		[icon],
	)

/** An external link drawn as a quiet button (opens T3 Code in a new tab). */
const externalLink = (
	h: H,
	href: string,
	label: string,
	children: ReadonlyArray<Html | string>,
	className?: string,
) =>
	h.a(
		[
			h.Href(href),
			h.Attribute("target", "_blank"),
			h.Attribute("rel", "noopener noreferrer"),
			h.AriaLabel(label),
			h.Attribute("title", label),
			h.Class(buttonClassName({ intent: "plain", size: "sq-sm" }, className)),
		],
		[...children],
	)

// HEADER

const historyEntries = (model: Model, shared: Shared): ReadonlyArray<Menu.Entry> => {
	const { own, shared: sharedThreads } = historyOf(model.threads, shared.currentUser?.id ?? null)
	const toItem = (thread: ThreadRow, hasDescription: boolean) =>
		Menu.item(thread.id, { textValue: thread.title || "Untitled chat", hasDescription })
	return [
		Menu.section(undefined, [Menu.item(NEW_CHAT_KEY, { textValue: "New chat" })]),
		...(own.length === 0
			? []
			: [
					Menu.section(
						"Your chats",
						own.map((thread) => toItem(thread, false)),
					),
				]),
		...(sharedThreads.length === 0
			? []
			: [
					Menu.section(
						"Shared with you",
						sharedThreads.map((thread) => toItem(thread, true)),
					),
				]),
	]
}

const historyMenu = (h: H, model: Model, shared: Shared): Html => {
	const id = model.historyMenu.id
	return h.submodel({
		slotId: id,
		model: model.historyMenu,
		view: menuView,
		viewInputs: {
			entries: historyEntries(model, shared),
			toTrigger: (attributes, overlay) =>
				button(
					h,
					{
						intent: "plain",
						size: "sq-sm",
						attributes: [
							...attributes,
							h.AriaLabel("Chat history"),
							h.Attribute("title", "Chat history"),
						],
					},
					[IconClock(h, { className: ICON }), overlay],
				),
			content: (key) => {
				if (key === NEW_CHAT_KEY) return [menuLabel(h, id, key, "New chat")]
				const thread = model.threads.find((candidate) => candidate.id === key)
				if (thread === undefined) return []
				return [
					menuLabel(h, id, key, thread.title || "Untitled chat", "truncate"),
					...(thread.ownerId === shared.currentUser?.id
						? []
						: [
								menuDescription(
									h,
									id,
									key,
									`Shared by ${thread.ownerName ?? "a teammate"}`,
									"text-xs",
								),
							]),
				]
			},
			className: "w-72 max-w-[calc(100vw-2rem)]",
		},
		toParentMessage: (message) => Message.GotHistoryMenuMessage({ message }),
	})
}

const shareButton = (h: H, model: Model, thread: ThreadRow): Html => {
	const isShared = thread.visibility === "organization"
	const label = isShared
		? "Shared with your organization. Make private"
		: "Private. Share with your organization"
	return button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			onPress: Message.ClickedShare(),
			isPending: model.isUpdatingVisibility,
			attributes: [
				h.AriaLabel(label),
				h.Attribute("title", label),
				h.AriaPressed(isShared ? "true" : "false"),
			],
		},
		[isShared ? IconUsers(h, { className: ICON }) : IconLock(h, { className: ICON })],
	)
}

const header = (h: H, model: Model, inputs: ViewInputs): Html => {
	const thread = threadOf(model)
	const isOwner = thread !== null && thread.ownerId === inputs.shared.currentUser?.id
	return h.div(
		[h.Class("flex h-14 shrink-0 items-center justify-between gap-2 border-border border-b px-3")],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-2")],
				[
					IconSparkles(h, { className: "size-4 shrink-0 text-muted-fg" }),
					heading(h, { variant: "subsection", level: 2, className: "truncate" }, [
						thread === null || thread.title === "" ? "New chat" : thread.title,
					]),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-0.5")],
				[
					historyMenu(h, model, inputs.shared),
					iconButton(h, "New chat", IconPlus(h, { className: ICON }), Message.ClickedNewChat()),
					isOwner ? shareButton(h, model, thread) : h.empty,
					thread?.externalLink
						? externalLink(h, thread.externalLink, "Open in T3 Code", [
								IconExternalLink(h, { className: ICON }),
							])
						: h.empty,
					iconButton(
						h,
						"Close assistant",
						IconClose(h, { className: ICON }),
						Message.ClickedClose(),
					),
				],
			),
		],
	)
}

// TIMELINE

const userBubble = (h: H, text: string, isSending = false): Html =>
	h.div(
		[h.Class("flex justify-end")],
		[
			h.div(
				[
					h.Class(
						twMerge(
							"max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-fg text-sm",
							isSending && "opacity-70",
						),
					),
				],
				[text],
			),
		],
	)

const assistantReply = (h: H, item: ItemRow): Html =>
	item.title === "Plan"
		? h.div(
				[h.Class("flex flex-col gap-2 rounded-lg border border-border bg-bg p-3 shadow-xs")],
				[heading(h, { variant: "label", level: 3 }, ["Plan"]), markdownView(h, item.text)],
			)
		: h.div([h.Class("text-fg")], [markdownView(h, item.text)])

const stepIcon = (h: H, item: ItemRow): Html =>
	item.status === "running"
		? loader(h, { className: "size-3.5", ariaLabel: "Running" })
		: item.status === "failed"
			? IconWarning(h, { className: "size-3.5 text-danger" })
			: item.kind === "reasoning"
				? IconBrainSparkle(h, { className: "size-3.5" })
				: IconCode(h, { className: "size-3.5" })

const stepRow = (h: H, item: ItemRow): Html => {
	const isReasoning = item.kind === "reasoning"
	const isFailed = item.status === "failed"
	return h.li(
		[h.Class(twMerge("flex flex-col gap-1 text-muted-fg text-xs", isFailed && "text-danger"))],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-2")],
				[
					stepIcon(h, item),
					h.span(
						[h.Class("shrink-0 font-medium")],
						[item.title ?? (isReasoning ? "Thinking" : "Tool")],
					),
					item.input === null
						? h.empty
						: h.code([h.Class("min-w-0 truncate font-mono text-2xs")], [item.input]),
				],
			),
			item.text === ""
				? h.empty
				: isReasoning
					? h.p([h.Class("whitespace-pre-wrap pl-5.5 text-muted-fg/80")], [item.text])
					: h.pre(
							[
								h.Class(
									"ml-5.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/60 p-2 font-mono text-2xs",
								),
							],
							[item.text],
						),
		],
	)
}

const workLog = (h: H, model: Model, key: string, items: ReadonlyArray<ItemRow>): Html => {
	const { isRunning, hasFailed, steps } = workSummaryOf(items)
	const isExpanded = model.expandedWork.includes(key)
	const listId = `${PANEL_ID}-work-${key}`
	return h.div(
		[h.Class("flex flex-col gap-2")],
		[
			ariaButton(
				h,
				{
					onPress: Message.ToggledWork({ key }),
					className:
						"flex w-fit cursor-pointer items-center gap-1.5 rounded-md text-muted-fg text-xs outline-hidden transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
					attributes: [h.AriaExpanded(isExpanded), h.Attribute("aria-controls", listId)],
				},
				[
					IconChevronRight(h, {
						className: twMerge(
							"size-3 transition-transform duration-150",
							isExpanded && "rotate-90",
						),
					}),
					isRunning
						? loader(h, { className: "size-3", ariaLabel: "Working" })
						: hasFailed
							? IconWarning(h, { className: "size-3 text-danger" })
							: IconCheck(h, { className: "size-3" }),
					`${isRunning ? "Working" : "Worked"} · ${steps} ${steps === 1 ? "step" : "steps"}`,
				],
			),
			isExpanded
				? h.ul(
						[h.Id(listId), h.Class("flex flex-col gap-2 border-border border-l pl-3")],
						items.map((item) => stepRow(h, item)),
					)
				: h.empty,
		],
	)
}

const questionField = (
	h: H,
	model: Model,
	item: ItemRow,
	question: QuestionData["questions"][number],
	isLocked: boolean,
) => {
	const picked = model.answerDrafts[item.id]?.[question.id] ?? []
	const options = question.options ?? []
	return h.div(
		[h.Class("flex flex-col gap-2")],
		[
			question.header === undefined
				? h.empty
				: heading(h, { variant: "label", level: 3 }, [question.header]),
			h.p([h.Class("text-fg text-sm")], [question.question]),
			options.length === 0
				? textarea(h, {
						isDisabled: isLocked,
						placeholder: "Your answer",
						className: "min-h-10",
						attributes: [
							h.AriaLabel(question.question),
							h.Value(picked[0] ?? ""),
							h.Attribute("rows", "2"),
							h.OnInput((value) =>
								Message.ChangedAnswer({ itemId: item.id, questionId: question.id, value }),
							),
						],
					})
				: h.div(
						[h.Class("flex flex-col gap-1.5"), h.Role("group"), h.AriaLabel(question.question)],
						options.map((option) =>
							h.div(
								[h.Class("flex flex-wrap items-baseline gap-x-2 gap-y-1")],
								[
									toggleChip(h, {
										label: option.label,
										isPressed: picked.includes(option.label),
										isDisabled: isLocked,
										onPress: Message.PickedAnswer({
											itemId: item.id,
											questionId: question.id,
											label: option.label,
											isMultiSelect: question.multiSelect ?? false,
										}),
									}),
									option.description === undefined
										? h.empty
										: h.span([h.Class("text-muted-fg text-xs")], [option.description]),
								],
							),
						),
					),
		],
	)
}

const answeredView = (h: H, data: QuestionData): Html =>
	h.dl(
		[h.Class("flex flex-col gap-1.5 text-sm")],
		data.questions.flatMap((question) => [
			h.dt([h.Class("text-muted-fg text-xs")], [question.header ?? question.question]),
			h.dd([h.Class("text-fg")], [data.answers?.[question.id] ?? "Answered"]),
		]),
	)

const questionCard = (h: H, model: Model, item: ItemRow, isReadOnlyThread: boolean): Html => {
	const data = item.question
	if (data === null) return h.empty
	const isAnswered = data.answered === true || item.status !== "running"
	const isSubmitting = model.answeringItemId === item.id
	const isLocked = isReadOnlyThread || isSubmitting
	return h.form(
		[
			h.Class("flex flex-col gap-3 rounded-lg border border-border bg-bg p-3 shadow-xs"),
			h.AriaLabel("The assistant asks"),
			h.OnSubmit(Message.SubmittedAnswers({ itemId: item.id })),
		],
		isAnswered
			? [answeredView(h, data)]
			: [
					...data.questions.map((question) => questionField(h, model, item, question, isLocked)),
					isReadOnlyThread
						? h.empty
						: h.div(
								[h.Class("flex justify-end")],
								[
									button(
										h,
										{
											size: "sm",
											isDisabled: answersOf(model, item) === null,
											isPending: isSubmitting,
											attributes: [h.Type("submit")],
										},
										["Send answer"],
									),
								],
							),
				],
	)
}

const approvalNotice = (h: H, item: ItemRow, thread: ThreadRow | null): Html =>
	h.div(
		[
			h.Role("status"),
			h.Class(
				"flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-subtle p-3 text-warning-subtle-fg text-sm",
			),
		],
		[
			IconWarning(h, { className: "mt-0.5 size-4 shrink-0" }),
			h.div(
				[h.Class("flex min-w-0 flex-col gap-1")],
				[
					h.p([h.Class("font-medium")], ["Waiting for approval in T3 Code"]),
					item.title === null && item.text === ""
						? h.empty
						: h.p([h.Class("opacity-90")], [item.title ?? item.text]),
					thread?.externalLink
						? h.a(
								[
									h.Href(thread.externalLink),
									h.Attribute("target", "_blank"),
									h.Attribute("rel", "noopener noreferrer"),
									h.Class("w-fit font-medium underline underline-offset-2"),
								],
								["Open in T3 Code"],
							)
						: h.empty,
				],
			),
		],
	)

const noticeView = (h: H, item: ItemRow): Html =>
	h.p([h.Class("text-center text-muted-fg text-xs")], [item.text || item.title || ""])

const itemView = (h: H, model: Model, item: ItemRow, inputs: ViewInputs): Html =>
	Match.value(item.kind).pipe(
		Match.when("user", () => userBubble(h, item.text)),
		Match.when("assistant", () => assistantReply(h, item)),
		Match.when("question", () => questionCard(h, model, item, isReadOnly(model, inputs.shared))),
		Match.when("approval", () => approvalNotice(h, item, threadOf(model))),
		// Reasoning and tool items are folded into work logs before they get here.
		Match.whenOr("notice", "reasoning", "tool", () => noticeView(h, item)),
		Match.exhaustive,
	)

const workingIndicator = (h: H): Html =>
	h.div(
		[h.Role("status"), h.Class("flex items-center gap-2 text-muted-fg text-xs")],
		[loader(h, { className: "size-3", ariaLabel: "Working" }), "Working…"],
	)

const threadError = (h: H, message: string): Html =>
	h.div(
		[
			h.Role("alert"),
			h.Class(
				"flex items-start gap-2 rounded-lg border border-danger/15 bg-danger/5 p-3 text-danger text-sm",
			),
		],
		[IconWarning(h, { className: "mt-0.5 size-4 shrink-0" }), h.p([], [message])],
	)

const newChat = (h: H, model: Model, inputs: ViewInputs): Html =>
	h.div(
		[h.Class("flex flex-col gap-4 py-6")],
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					heading(h, { variant: "section", level: 3 }, ["Ask about what you're looking at"]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							"The assistant reads this page and recommends what to do; it never changes anything itself.",
						],
					),
				],
			),
			h.div(
				[h.Class("flex flex-col items-start gap-2"), h.Role("group"), h.AriaLabel("Suggestions")],
				suggestionsFor(inputs.context).map((text) =>
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							isDisabled: model.pending?.isSending === true,
							onPress: Message.ClickedSuggestion({ text }),
						},
						[text],
					),
				),
			),
		],
	)

const timeline = (h: H, model: Model, inputs: ViewInputs): Html => {
	const thread = threadOf(model)
	const pending = pendingOf(model)
	const isEmpty = model.threadId === null && pending === null
	return h.div(
		// Reversed, the scroll stays at the newest content as it grows, unless the member scrolled up.
		[h.Class("flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain")],
		[
			h.div(
				[h.Class("flex flex-col gap-4 px-4 py-4"), h.Attribute("aria-live", "polite")],
				isEmpty
					? [newChat(h, model, inputs)]
					: [
							...timelineOf(model.items).map((entry) =>
								entry._tag === "Work"
									? h.keyed("div")(
											entry.key,
											[],
											[workLog(h, model, entry.key, entry.items)],
										)
									: h.keyed("div")(
											entry.item.id,
											[],
											[itemView(h, model, entry.item, inputs)],
										),
							),
							pending === null ? h.empty : userBubble(h, pending.text, pending.isSending),
							thread?.status === "running" || pending?.isSending === true
								? workingIndicator(h)
								: h.empty,
							thread?.status === "error"
								? threadError(
										h,
										thread.errorMessage ?? "The assistant stopped with an error.",
									)
								: h.empty,
						],
			),
		],
	)
}

// COMPOSER

const composerKey = (key: string, modifiers: { readonly shiftKey: boolean }) =>
	key === "Enter" && !modifiers.shiftKey ? Option.some(Message.SubmittedComposer()) : Option.none()

const composer = (h: H, model: Model, inputs: ViewInputs): Html => {
	const thread = threadOf(model)
	const isRunning = thread?.status === "running"
	const isSending = model.pending?.isSending === true
	const context = inputs.context
	const engineLabel = thread?.engineLabel ?? model.environmentLabel
	return h.div(
		[h.Class("flex shrink-0 flex-col gap-2 px-3 pt-1 pb-3")],
		[
			model.error === null
				? h.empty
				: h.p([h.Role("alert"), h.Class("px-1 text-danger text-sm")], [model.error]),
			context === null
				? h.empty
				: h.div(
						[h.Class("flex min-w-0")],
						[
							toggleChip(h, {
								label: context.label,
								isPressed: model.isContextIncluded,
								onPress: Message.ToggledContext(),
								ariaLabel: `Send "${context.label}" as context`,
								className: "h-7 max-w-full text-xs sm:h-6",
							}),
						],
					),
			h.form(
				[
					h.Class(
						"flex flex-col rounded-xl border border-border bg-bg shadow-sm transition-colors focus-within:border-ring/70",
					),
					h.OnSubmit(Message.SubmittedComposer()),
				],
				[
					textarea(h, {
						placeholder: context === null ? "Ask anything" : `Ask about ${context.label}`,
						className:
							"max-h-48 min-h-11 resize-none border-0 bg-transparent focus:border-transparent focus:ring-0 enabled:hover:bg-transparent",
						attributes: [
							h.Id(COMPOSER_ID),
							h.AriaLabel("Message the assistant"),
							h.Attribute("rows", "1"),
							h.Value(model.draft),
							h.OnInput((value) => Message.ChangedDraft({ value })),
							h.OnKeyDownPreventDefault(composerKey),
						],
					}),
					h.div(
						[h.Class("flex items-center justify-between gap-2 px-2 pb-2")],
						[
							h.span(
								[h.Class("min-w-0 truncate pl-1 text-muted-fg text-xs")],
								[engineLabel === null ? "T3 Code" : `T3 Code · ${engineLabel}`],
							),
							isRunning
								? button(
										h,
										{
											intent: "secondary",
											size: "sq-sm",
											onPress: Message.ClickedStop(),
											attributes: [h.AriaLabel("Stop"), h.Attribute("title", "Stop")],
										},
										[h.span([h.Class("size-2.5 rounded-xs bg-current")], [])],
									)
								: button(
										h,
										{
											size: "sq-sm",
											isDisabled: model.draft.trim() === "",
											isPending: isSending,
											attributes: [
												h.Type("submit"),
												h.AriaLabel("Send"),
												h.Attribute("title", "Send"),
											],
										},
										[IconArrowUp(h, { className: ICON })],
									),
						],
					),
				],
			),
		],
	)
}

const sharedFooter = (h: H, thread: ThreadRow): Html =>
	h.p(
		[h.Class("flex shrink-0 items-center gap-2 border-border border-t px-4 py-3 text-muted-fg text-sm")],
		[IconUsers(h, { className: "size-4" }), `Shared by ${thread.ownerName ?? "a teammate"}`],
	)

// NOT CONNECTED

const connectState = (h: H, model: Model, shared: Shared): Html => {
	const isExpired = model.connection === "Expired"
	return h.div(
		[h.Class("flex flex-1 items-center justify-center p-6")],
		[
			emptyState(h, {
				icon: (className) => IconSparkles(h, { className }),
				title: isExpired ? "Your T3 Code sign-in expired" : "Connect T3 Code",
				description:
					"The assistant runs on your own T3 Code environment, so it sees what you can see. Link it in Settings to start a chat.",
				action:
					shared.orgSlug === null
						? undefined
						: h.a(
								[
									h.Href(hrefOf(integrationRoute(shared.orgSlug, "t3code"))),
									h.Class(buttonClassName({ size: "sm" })),
								],
								[isExpired ? "Link T3 Code again" : "Open T3 Code settings"],
							),
			}),
		],
	)
}

// PANEL

const content = (h: H, model: Model, inputs: ViewInputs): ReadonlyArray<Html> => {
	const thread = threadOf(model)
	const isConnected = model.connection !== "NotConnected" && model.connection !== "Expired"
	return [
		header(h, model, inputs),
		h.div(
			[
				h.Class("flex min-h-0 flex-1 flex-col"),
				// Escape anywhere below the header (whose history menu handles its own) closes the panel.
				h.OnKeyDownPreventDefault((key) =>
					key === "Escape" ? Option.some(Message.ClickedClose()) : Option.none(),
				),
			],
			!isConnected && model.threadId === null
				? [connectState(h, model, inputs.shared)]
				: [
						timeline(h, model, inputs),
						thread !== null && isReadOnly(model, inputs.shared)
							? sharedFooter(h, thread)
							: composer(h, model, inputs),
					],
		),
	]
}

/** The panel and the page beside it, read off the grabbed edge. */
const measureEdge = (target: EventTarget | null, fallbackWidth: number) => {
	const panel = target instanceof Element ? target.closest(`#${PANEL_ID}`) : null
	const root = panel?.parentElement ?? null
	return {
		startWidth: panel?.getBoundingClientRect().width ?? fallbackWidth,
		maxWidth: root === null ? fallbackWidth : root.getBoundingClientRect().width - MIN_PAGE_WIDTH,
	}
}

const desktopPanel = (h: H, model: Model, inputs: ViewInputs): Html => {
	const width = widthOf(model)
	return h.aside(
		[
			h.Id(PANEL_ID),
			h.AriaLabel("AI assistant"),
			h.Class(splitPanelClassName("right", "sticky top-0 h-dvh")),
			h.Attribute("style", `width: ${width}px; max-width: calc(100% - ${MIN_PAGE_WIDTH}px);`),
		],
		[
			resizeEdge(h, {
				label: "Resize assistant panel",
				position: "right",
				width,
				minWidth: MIN_WIDTH,
				isDragging: model.drag !== null,
				onPress: (clientX, target) => {
					const { startWidth, maxWidth } = measureEdge(target, width)
					return Message.PressedEdge({ clientX, startWidth, maxWidth })
				},
				onNudge: (delta) => Message.NudgedEdge({ delta }),
			}),
			h.div(
				[h.Class("flex h-full min-h-0 flex-1 flex-col overflow-hidden")],
				[...content(h, model, inputs)],
			),
		],
	)
}

/** On a phone the panel is a full-height sheet from the right. */
const phoneSheet = (h: H, model: Model, inputs: ViewInputs): Html =>
	h.submodel({
		slotId: `${PANEL_ID}-sheet`,
		model: sheetModelOf(model),
		view: Sheet.view,
		viewInputs: {
			toContent: () => [
				h.div([h.Class("flex h-full min-h-0 flex-col")], [...content(h, model, inputs)]),
			],
			side: "right",
			isFloat: false,
			closeButton: false,
			ariaLabel: "AI assistant",
			className: "w-full max-w-md p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
		},
		toParentMessage: (message) => Message.GotSheetMessage({ message }),
	})

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h) =>
	inputs.shared.isMobile
		? phoneSheet(h, model, inputs)
		: model.isOpen
			? desktopPanel(h, model, inputs)
			: h.empty,
)

/** The always-visible toggle (the nav rail's footer). */
export const toggleButton = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ isOpen: boolean; onPress: M; shortcut: string | null }>,
): Html => {
	const label = options.shortcut === null ? "AI assistant" : `AI assistant (${options.shortcut})`
	return button(
		h,
		{
			intent: "plain",
			size: "sq-md",
			className: options.isOpen ? "bg-sidebar-accent text-sidebar-accent-fg" : undefined,
			onPress: options.onPress,
			attributes: [
				h.AriaLabel("AI assistant"),
				h.Attribute("title", label),
				h.AriaPressed(options.isOpen ? "true" : "false"),
			],
		},
		[IconSparkles(h, { className: "size-5" })],
	)
}
