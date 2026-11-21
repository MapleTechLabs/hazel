import type { Assistant } from "@hazel/domain/models"
import { Match, Option } from "effect"
import { Submodel } from "foldkit"
import { type ChildAttribute, createKeyedLazy, createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { markdownView } from "../chat/markdown/markdown-view"
import {
	IconArrowUp,
	IconBrainSparkle,
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconClock,
	IconClose,
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
import { getBrandfetchIcon } from "~/lib/integrations/__data"
import { emptyState } from "../ui/empty-state"
import { heading } from "../ui/heading"
import { loader } from "../ui/loader"
import * as Menu from "../ui/menu"
import { menuDescription, menuLabel, view as menuView } from "../ui/menu-view"
import * as Sheet from "../ui/sheet"
import { shimmerText } from "../ui/shimmer-text"
import { resizeEdge, splitPanelClassName } from "../ui/split-panel"
import { textField } from "../ui/text-field"
import { textarea } from "../ui/textarea"
import { toggleChip } from "../ui/toggle-chip"
import { suggestionsFor } from "./context"
import { Message } from "./message"
import {
	ADD_KEY_KEY,
	COMPOSER_ID,
	type Engines,
	KEY_FIELD_ID,
	type KeyForm,
	TOGGLE_ID,
	type ItemRow,
	type Model,
	NEW_CHAT_KEY,
	PANEL_ID,
	SETUP_ID,
	type QuestionData,
	type ThreadRow,
} from "./model"
import { firstSentenceOf, historyOf, isTurnLive, type Turn, timelineOf, workSummaryOf } from "./timeline"
import {
	answersOf,
	isAnswered,
	isReadOnly,
	isStoppable,
	MAX_KEYBOARD_WIDTH,
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
	/** The left sidebar is docked to its nav rail: the page beside the panel has more room. */
	readonly isSidebarCollapsed: boolean
}

/** Every element of the panel carries this, so page hotkeys can leave its keys alone (`keyboard.ts`). */
const PANEL_MARK = "data-ai-panel"

type H = HtmlBuilder<Message>

const ICON = "size-4"

/** Escape on a header control closes the panel, as it does below the header. */
const closesOnEscape = (h: H) =>
	h.OnKeyDownSelfPreventDefault((key) =>
		key === "Escape" ? Option.some(Message.ClickedClose()) : Option.none(),
	)

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
			attributes: [h.AriaLabel(label), h.Attribute("title", label), closesOnEscape(h), ...extra],
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
			closesOnEscape(h),
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
				closesOnEscape(h),
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

/**
 * The timeline is a lazy view over Model fields and primitives, so the panel's other Messages (and
 * the app's) never rebuild it; inside, replies and steps are memoized per item by what they show, so
 * a growing reply re-parses only its own markdown and a running step redraws only its own line.
 *
 * It reads like a conversation: the member's messages as soft bubbles on the right, and each agent
 * run as one turn under the agent's mark: one line per step, then what it said.
 */

const userBubble = (h: H, text: string, isSending = false): Html =>
	h.div(
		[h.Class("flex justify-end pl-8")],
		[
			h.div(
				[
					h.Class(
						twMerge(
							"wrap-break-word max-w-full whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-secondary-fg text-sm leading-relaxed transition-opacity duration-150",
							isSending && "opacity-70",
						),
					),
				],
				[text],
			),
		],
	)

/**
 * Markdown at the panel's size: text-sm with relaxed leading, headings scaled down to the body's
 * size, lists and paragraphs close together, inline code small.
 */
const PROSE =
	"text-fg text-sm leading-relaxed [&_[data-slate-editor]]:text-sm [&_[data-slate-editor]]:leading-relaxed [&_h1]:mt-4 [&_h1]:mb-1 [&_h1]:text-base [&_h2]:mt-3.5 [&_h2]:mb-1 [&_h2]:text-sm [&_h3]:mt-3 [&_h3]:mb-0.5 [&_h3]:text-sm [&_ol]:ml-4 [&_ul]:ml-4 [&_li]:my-1 [&_li]:pl-0.5 [&_.font-mono]:rounded-sm [&_.font-mono]:px-1 [&_.font-mono]:py-px [&_.font-mono]:text-xs"

const assistantReply = (h: H, text: string, title: string | null, isStreaming: boolean): Html =>
	h.div(
		[h.Class("flex flex-col gap-1.5"), ...(isStreaming ? [h.Attribute("data-streaming", "")] : [])],
		[
			title === "Plan" ? heading(h, { variant: "label", level: 3 }, ["Plan"]) : h.empty,
			h.div([h.Class(PROSE)], [markdownView(h, text)]),
		],
	)

const noticeView = (h: H, text: string, title: string | null): Html =>
	h.p([h.Class("text-muted-fg text-xs leading-relaxed")], [text || title || ""])

/** A reply or notice: what it shows is its kind, text and title, and whether it is still arriving. */
const messageView = (
	kind: ItemRow["kind"],
	text: string,
	title: string | null,
	isStreaming: boolean,
	h: H,
): Html => (kind === "assistant" ? assistantReply(h, text, title, isStreaming) : noticeView(h, text, title))

// The agent's mark

const MARK_SOURCES = {
	t3code: "/images/integrations/t3code.svg",
	anthropic: getBrandfetchIcon("claude.ai", { theme: "light", size: 64, type: "icon" }),
	openai: getBrandfetchIcon("openai.com", { theme: "light", size: 64, type: "icon" }),
} satisfies Record<Assistant.Engine, string>

/** The engine's small round mark: T3 Code's glyph on a quiet disc, a provider's own icon. */
const engineMark = (h: H, engine: Assistant.Engine, className = "size-5"): Html =>
	h.span(
		[
			h.AriaHidden(true),
			h.Class(
				twMerge(
					"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-border",
					engine === "t3code" && "bg-bg",
					className,
				),
			),
		],
		[
			h.img([
				h.Src(MARK_SOURCES[engine]),
				h.Alt(""),
				h.Attribute("draggable", "false"),
				h.Class(engine === "t3code" ? "size-3/5 dark:invert" : "size-full object-cover"),
			]),
		],
	)

// Steps

const STEP_ICON = "size-3.5 shrink-0"

const stepIcon = (h: H, kind: ItemRow["kind"], status: string | null): Html =>
	status === "running"
		? loader(h, { className: twMerge(STEP_ICON, "text-muted-fg"), ariaLabel: "Running" })
		: status === "failed"
			? IconWarning(h, { className: twMerge(STEP_ICON, "text-danger") })
			: kind === "reasoning"
				? IconBrainSparkle(h, { className: twMerge(STEP_ICON, "text-muted-fg/70") })
				: IconCheck(h, { className: twMerge(STEP_ICON, "text-muted-fg/70") })

/** What a step's line says: its label, and the detail after "·". */
const stepWords = (kind: ItemRow["kind"], title: string | null, input: string | null, text: string) =>
	kind === "reasoning"
		? { label: null, detail: text.trim() === "" ? null : firstSentenceOf(text) }
		: { label: title ?? "Tool", detail: input }

/** A step has more to show than its line: a tool's output, a thought longer than its first sentence. */
const hasMore = (kind: ItemRow["kind"], text: string, detail: string | null) =>
	kind === "reasoning"
		? text.trim() !== "" && text.replace(/\s+/g, " ").trim().length > (detail?.length ?? 0) + 4
		: text.trim() !== ""

const stepOutput = (h: H, id: string, kind: ItemRow["kind"], text: string): Html =>
	h.div(
		[h.Id(id), h.Class("animate-step-enter pt-1 pb-1.5 pl-5.5")],
		[
			kind === "reasoning"
				? h.div(
						[h.Class(twMerge(PROSE, "text-muted-fg [&_*]:text-muted-fg"))],
						[markdownView(h, text)],
					)
				: h.pre(
						[
							h.Class(
								"max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs text-muted-fg leading-4",
							),
							h.Attribute("tabindex", "0"),
							h.AriaLabel("Output"),
						],
						[text],
					),
		],
	)

const stepRow = (
	id: ItemRow["id"],
	kind: ItemRow["kind"],
	title: string | null,
	input: string | null,
	text: string,
	status: string | null,
	isExpanded: boolean,
	h: H,
): Html => {
	const isRunning = status === "running"
	const { label, detail } = stepWords(kind, title, input, text)
	const canExpand = hasMore(kind, text, detail)
	const outputId = `${PANEL_ID}-step-${id}`
	const words = [
		kind === "reasoning"
			? shimmerText(
					h,
					{ isActive: isRunning, className: "shrink-0" },
					isRunning ? "Thinking" : "Thought",
				)
			: shimmerText(
					h,
					{
						isActive: isRunning,
						className: twMerge(
							"min-w-0 truncate",
							detail !== null && detail !== "" && "max-w-[60%] shrink-0",
							!isRunning && "text-fg",
						),
					},
					label ?? "Tool",
				),
		detail === null || detail === ""
			? h.empty
			: h.span([h.Class("min-w-0 truncate text-muted-fg")], [`· ${detail}`]),
	]
	const line = [
		stepIcon(h, kind, status),
		h.span([h.Class("flex min-w-0 flex-1 items-baseline gap-1.5")], words),
		canExpand
			? IconChevronRight(h, {
					className: twMerge(
						"size-3 shrink-0 text-muted-fg opacity-0 transition-[opacity,rotate] duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100",
						isExpanded && "rotate-90 opacity-100",
					),
				})
			: h.empty,
	]
	const lineClass =
		"group flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-muted-fg text-sm leading-6"
	// Keyed itself: the list holds its rows directly.
	return h.keyed("li")(
		id,
		[h.Class("animate-step-enter")],
		[
			canExpand
				? ariaButton(
						h,
						{
							onPress: Message.ToggledStep({ itemId: id }),
							className: twMerge(
								lineClass,
								"cursor-pointer rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-ring/70",
							),
							attributes: [h.AriaExpanded(isExpanded), h.Attribute("aria-controls", outputId)],
						},
						line,
					)
				: h.div([h.Class(lineClass)], line),
			canExpand && isExpanded ? stepOutput(h, outputId, kind, text) : h.empty,
		],
	)
}

// Keyed by item id: one slot per message or step, re-run only when what it shows changed.
const lazyMessages = createKeyedLazy()
const lazySteps = createKeyedLazy()

const memoMessage = (h: H, item: ItemRow, isStreaming: boolean): Html =>
	lazyMessages(item.id, messageView, [item.kind, item.text, item.title, isStreaming, h]) ?? h.empty

const memoStep = (h: H, item: ItemRow, isExpanded: boolean): Html =>
	lazySteps(item.id, stepRow, [
		item.id,
		item.kind,
		item.title,
		item.input,
		item.text,
		item.status,
		isExpanded,
		h,
	]) ?? h.empty

/** While a live turn waits between steps: the next one is on its way. */
const thinkingLine = (h: H): Html =>
	h.keyed("li")(
		"thinking",
		[h.Class("animate-step-enter flex items-center gap-2 py-0.5 text-sm leading-6")],
		[
			loader(h, { className: twMerge(STEP_ICON, "text-muted-fg"), ariaLabel: "Thinking" }),
			shimmerText(h, {}, "Thinking"),
		],
	)

/** The live line's words for one step, or for the wait before the next one (`null`). */
const liveWords = (h: H, step: ItemRow | null): Array<Html> => {
	if (step === null || step.status !== "running") {
		return [
			loader(h, { className: twMerge(STEP_ICON, "text-muted-fg"), ariaLabel: "Working" }),
			shimmerText(h, { className: "min-w-0 truncate" }, "Thinking"),
		]
	}
	const { label, detail } = stepWords(step.kind, step.title, step.input, step.text)
	return [
		stepIcon(h, step.kind, step.status),
		shimmerText(
			h,
			{
				className: twMerge(
					"min-w-0 truncate",
					detail !== null && detail !== "" && "max-w-[60%] shrink-0",
				),
			},
			step.kind === "reasoning" ? "Thinking" : (label ?? "Tool"),
		),
		detail === null || detail === ""
			? h.empty
			: h.span([h.Class("min-w-0 truncate text-muted-fg")], [`· ${detail}`]),
	]
}

const LIVE_ROW =
	"col-start-1 row-start-1 flex min-w-0 items-center gap-2 py-0.5 text-muted-fg text-sm leading-6"

/**
 * A live turn's one line: what the agent is doing now, swapping in place as it moves on. The new
 * step sharpens in while the one before blurs out in the same spot (both stacked in one grid cell);
 * pressing it opens every step so far.
 */
const liveLine = (h: H, turn: Turn, listId: string): Html => {
	const last = turn.steps.at(-1) ?? null
	const current = last !== null && last.status === "running" ? last : null
	// Between steps the line reads "Thinking"; the step that just finished blurs out under it.
	const previous = current === null ? last : (turn.steps.at(-2) ?? null)
	const currentKey = current?.id ?? `wait-${last?.id ?? turn.key}`
	return ariaButton(
		h,
		{
			onPress: Message.ToggledWork({ key: turn.key }),
			className:
				"grid w-full min-w-0 cursor-pointer rounded-md text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring/70",
			attributes: [h.AriaExpanded(false), h.Attribute("aria-controls", listId)],
		},
		[
			...(previous === null || previous.id === current?.id
				? []
				: [
						h.keyed("span")(
							`out-${previous.id}`,
							[
								h.Class(twMerge(LIVE_ROW, "pointer-events-none animate-step-swap-out")),
								h.AriaHidden(true),
							],
							liveWords(h, { ...previous, status: "running" }),
						),
					]),
			h.keyed("span")(
				`in-${currentKey}`,
				[h.Class(twMerge(LIVE_ROW, "animate-step-swap-in"))],
				liveWords(h, current),
			),
		],
	)
}

/**
 * A turn's activity. Live, one line that swaps in place as the agent moves from step to step (open,
 * every step so far); once the reply begins (or the turn is done) the steps fold under one summary
 * that opens them again.
 */
const activityList = (
	h: H,
	turn: Turn,
	isLive: boolean,
	isExpanded: boolean,
	expandedSteps: ReadonlyArray<string>,
): Html => {
	const listId = `${PANEL_ID}-work-${turn.key}`
	const isOpen = isLive || isExpanded
	const steps = turn.steps.map((step) => memoStep(h, step, expandedSteps.includes(step.id)))
	const isWaiting = isLive && !turn.steps.some((step) => step.status === "running")
	if (turn.steps.length === 0 && !isLive) return h.empty
	const summary = workSummaryOf(turn.steps)
	if (isLive && !isExpanded) return liveLine(h, turn, listId)
	return h.div(
		[h.Class("flex flex-col")],
		[
			ariaButton(
				h,
				{
					onPress: Message.ToggledWork({ key: turn.key }),
					className:
						"group animate-step-enter flex w-fit cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-muted-fg text-sm leading-6 outline-hidden transition-colors duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
					attributes: [h.AriaExpanded(isExpanded), h.Attribute("aria-controls", listId)],
				},
				[
					h.span([], [isLive ? "Working" : summary.label]),
					IconChevronRight(h, {
						className: twMerge(
							"size-3 shrink-0 transition-[rotate] duration-200 ease-out",
							isExpanded && "rotate-90",
						),
					}),
				],
			),
			// Collapsing animates its height (0fr ⇄ 1fr); folded, its lines leave the tab order.
			h.div(
				[
					h.Id(listId),
					h.Class(
						twMerge(
							"grid transition-[grid-template-rows,opacity] duration-200 ease-out",
							isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
						),
					),
					...(isOpen ? [] : [h.Attribute("inert", ""), h.AriaHidden(true)]),
				],
				[
					h.div(
						[h.Class("min-h-0 overflow-hidden")],
						[
							h.ul(
								[h.Class(twMerge("flex flex-col", !isLive && "pt-1"))],
								isWaiting ? [...steps, thinkingLine(h)] : steps,
							),
						],
					),
				],
			),
		],
	)
}

/** What a question card reads besides its item. */
interface QuestionState {
	readonly answerDrafts: Model["answerDrafts"]
	readonly answeringItemId: Model["answeringItemId"]
	readonly answerError: Model["answerError"]
	readonly isReadOnly: boolean
}

const questionField = (
	h: H,
	picked: ReadonlyArray<string>,
	item: ItemRow,
	question: QuestionData["questions"][number],
	isLocked: boolean,
) => {
	const options = question.options ?? []
	const hasDescriptions = options.some((option) => option.description !== undefined)
	const pill = (option: (typeof options)[number]) =>
		toggleChip(h, {
			label: option.label,
			isPressed: picked.includes(option.label),
			isDisabled: isLocked,
			isPill: true,
			onPress: Message.PickedAnswer({
				itemId: item.id,
				questionId: question.id,
				label: option.label,
				isMultiSelect: question.multiSelect ?? false,
			}),
		})
	return h.div(
		[h.Class("flex flex-col gap-2.5")],
		[
			question.header === undefined
				? h.empty
				: heading(h, { variant: "label", level: 3 }, [question.header]),
			h.p([h.Class("text-fg text-sm leading-relaxed")], [question.question]),
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
						[
							h.Class(
								hasDescriptions ? "flex flex-col items-start gap-2" : "flex flex-wrap gap-2",
							),
							h.Role("group"),
							h.AriaLabel(question.question),
						],
						options.map((option) =>
							hasDescriptions
								? h.div(
										[h.Class("flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1")],
										[
											pill(option),
											option.description === undefined
												? h.empty
												: h.span(
														[h.Class("text-muted-fg text-xs leading-relaxed")],
														[option.description],
													),
										],
									)
								: pill(option),
						),
					),
		],
	)
}

const answeredView = (h: H, data: QuestionData): Html =>
	h.dl(
		[h.Class("flex flex-col gap-2 text-sm leading-relaxed")],
		data.questions.flatMap((question) => [
			h.dt([h.Class("text-muted-fg")], [question.header ?? question.question]),
			h.dd(
				[h.Class("flex items-center gap-1.5 text-fg")],
				[
					IconCheck(h, { className: "size-3.5 shrink-0 text-muted-fg" }),
					data.answers?.[question.id] ?? "Answered",
				],
			),
		]),
	)

const questionCard = (h: H, item: ItemRow, state: QuestionState): Html => {
	const data = item.question
	if (data === null) return h.empty
	const isSubmitting = state.answeringItemId === item.id
	const isLocked = state.isReadOnly || isSubmitting
	const drafts = state.answerDrafts[item.id] ?? {}
	const error = state.answerError?.itemId === item.id ? state.answerError.message : null
	return h.form(
		[
			h.Class("flex flex-col gap-4"),
			h.AriaLabel("The assistant asks"),
			h.OnSubmit(Message.SubmittedAnswers({ itemId: item.id })),
		],
		isAnswered(item)
			? [answeredView(h, data)]
			: [
					...data.questions.map((question) =>
						questionField(h, drafts[question.id] ?? [], item, question, isLocked),
					),
					error === null
						? h.empty
						: h.p([h.Role("alert"), h.Class("text-danger text-sm")], [error]),
					state.isReadOnly
						? h.empty
						: h.div(
								[h.Class("flex")],
								[
									button(
										h,
										{
											size: "sm",
											isCircle: true,
											isDisabled: answersOf(state.answerDrafts, item) === null,
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

const approvalNotice = (h: H, item: ItemRow, externalLink: string | null): Html =>
	h.div(
		[h.Class("flex flex-col items-start gap-2.5 text-sm leading-relaxed")],
		[
			h.p(
				[h.Class("flex items-center gap-2 text-fg")],
				[
					IconWarning(h, { className: "size-3.5 shrink-0 text-warning" }),
					"Waiting for approval in T3 Code",
				],
			),
			item.title === null && item.text === ""
				? h.empty
				: h.p([h.Class("text-muted-fg")], [item.title ?? item.text]),
			externalLink === null
				? h.empty
				: h.a(
						[
							h.Href(externalLink),
							h.Attribute("target", "_blank"),
							h.Attribute("rel", "noopener noreferrer"),
							h.Class(buttonClassName({ intent: "outline", size: "sm", isCircle: true })),
						],
						["Open in T3 Code", IconExternalLink(h, { attributes: { "data-slot": "icon" } })],
					),
		],
	)

const threadError = (h: H, message: string): Html =>
	h.div(
		[h.Role("alert"), h.Class("flex items-start gap-2 text-danger text-sm leading-relaxed")],
		[IconWarning(h, { className: "mt-1 size-3.5 shrink-0" }), h.p([], [message])],
	)

/** One agent run: its mark, its activity, then what it said. */
interface TurnState {
	readonly engine: Assistant.Engine
	readonly isRunning: boolean
	readonly isExpanded: boolean
	readonly expandedSteps: ReadonlyArray<string>
	readonly questions: QuestionState
	readonly externalLink: string | null
	readonly status: ThreadRow["status"] | null
	readonly errorMessage: string | null
}

const turnLayout = (h: H, key: string, engine: Assistant.Engine, children: ReadonlyArray<Html>): Html =>
	h.keyed("div")(
		key,
		[h.Class("flex gap-3")],
		[
			h.div([h.Class("flex h-6 shrink-0 items-center")], [engineMark(h, engine)]),
			h.div([h.Class("flex min-w-0 flex-1 flex-col gap-3")], [...children]),
		],
	)

const turnView = (h: H, turn: Turn, state: TurnState): Html => {
	const isLive = isTurnLive(turn, state.isRunning)
	const lastSaid = turn.said.at(-1)
	return turnLayout(h, turn.key, state.engine, [
		activityList(h, turn, isLive, state.isExpanded, state.expandedSteps),
		...turn.said.map((item) =>
			h.keyed("div")(
				item.id,
				[],
				[
					Match.value(item.kind).pipe(
						Match.when("question", () => questionCard(h, item, state.questions)),
						Match.when("approval", () => approvalNotice(h, item, state.externalLink)),
						Match.whenOr("assistant", "notice", () =>
							memoMessage(
								h,
								item,
								state.isRunning && item === lastSaid && item.kind === "assistant",
							),
						),
						// Steps and the member's messages never land among what a turn said.
						Match.whenOr("user", "reasoning", "tool", () => h.empty),
						Match.exhaustive,
					),
				],
			),
		),
		state.status === "error"
			? threadError(h, state.errorMessage ?? "The assistant stopped with an error.")
			: h.empty,
	])
}

/** The member's message is out and nothing of the run has synced yet. */
const pendingTurn = (h: H, engine: Assistant.Engine): Html =>
	turnLayout(h, "pending-turn", engine, [h.ul([h.Class("flex flex-col")], [thinkingLine(h)])])

const newChat = (
	h: H,
	suggestions: ReadonlyArray<string>,
	isSending: boolean,
	engine: Assistant.Engine | null,
): Html =>
	h.div(
		[h.Class("flex flex-col gap-5 py-6")],
		[
			engine === null ? h.empty : engineMark(h, engine, "size-7"),
			h.div(
				[h.Class("flex flex-col gap-1.5")],
				[
					heading(h, { variant: "section", level: 3 }, ["Ask about what you're looking at"]),
					h.p(
						[h.Class("text-muted-fg text-sm leading-relaxed")],
						[
							"The assistant reads this page and recommends what to do; it never changes anything itself.",
						],
					),
				],
			),
			h.div(
				[h.Class("flex flex-wrap gap-2"), h.Role("group"), h.AriaLabel("Suggestions")],
				suggestions.map((text) =>
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							isCircle: true,
							isDisabled: isSending,
							onPress: Message.ClickedSuggestion({ text }),
							className: "h-auto max-w-full whitespace-normal text-left font-normal",
						},
						[text],
					),
				),
			),
		],
	)

const threadEntries = (
	h: H,
	items: ReadonlyArray<ItemRow>,
	expandedWork: ReadonlyArray<string>,
	expandedSteps: ReadonlyArray<string>,
	questions: QuestionState,
	engine: Assistant.Engine,
	isRunning: boolean,
	status: ThreadRow["status"] | null,
	errorMessage: string | null,
	externalLink: string | null,
): Array<Html> => {
	const entries = timelineOf(items)
	const lastEntry = entries.at(-1)
	// Only the newest turn can still be running, or carry the thread's error.
	const lastTurnKey = lastEntry?._tag === "Turn" ? lastEntry.turn.key : null
	return entries.map((entry) =>
		Match.value(entry).pipe(
			Match.tag("User", ({ item }) => h.keyed("div")(item.id, [], [userBubble(h, item.text)])),
			Match.tag("Turn", ({ turn }) => {
				const isLast = turn.key === lastTurnKey
				return turnView(h, turn, {
					engine,
					isRunning: isLast && isRunning,
					isExpanded: expandedWork.includes(turn.key),
					expandedSteps,
					questions,
					externalLink,
					status: isLast ? status : null,
					errorMessage,
				})
			}),
			Match.exhaustive,
		),
	)
}

const timelineView = (
	items: ReadonlyArray<ItemRow>,
	pending: Model["pending"],
	expandedWork: ReadonlyArray<string>,
	expandedSteps: ReadonlyArray<string>,
	answerDrafts: Model["answerDrafts"],
	answeringItemId: Model["answeringItemId"],
	answerError: Model["answerError"],
	isReadOnlyThread: boolean,
	// The open thread's row fields as primitives: its row is rebuilt on every sync.
	status: ThreadRow["status"] | null,
	errorMessage: string | null,
	externalLink: string | null,
	engine: Assistant.Engine | null,
	isEmpty: boolean,
	suggestions: ReadonlyArray<string>,
	h: H,
): Html => {
	const markEngine = engine ?? "t3code"
	const isRunning = status === "running"
	const isLastEntryTurn = items.length > 0 && items.at(-1)?.kind !== "user"
	// A run that has started but shows nothing yet: the turn's mark and "Thinking".
	const isAwaitingTurn = pending !== null ? pending.isSending || isRunning : isRunning && !isLastEntryTurn
	const isErrorOutsideTurn = status === "error" && !isLastEntryTurn
	return h.div(
		// Reversed, the scroll stays at the newest content as it grows, unless the member scrolled up.
		[h.Class("flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain")],
		[
			h.div(
				[h.Class("flex flex-col gap-6 px-4 py-5")],
				isEmpty
					? [newChat(h, suggestions, pending?.isSending === true, engine)]
					: [
							...threadEntries(
								h,
								items,
								expandedWork,
								expandedSteps,
								{ answerDrafts, answeringItemId, answerError, isReadOnly: isReadOnlyThread },
								markEngine,
								isRunning && pending === null,
								status,
								errorMessage,
								externalLink,
							),
							pending === null
								? h.empty
								: h.keyed("div")(
										"pending",
										[],
										[userBubble(h, pending.text, pending.isSending)],
									),
							isAwaitingTurn ? pendingTurn(h, markEngine) : h.empty,
							isErrorOutsideTurn
								? threadError(h, errorMessage ?? "The assistant stopped with an error.")
								: h.empty,
						],
			),
		],
	)
}

const lazyTimeline = createLazy()

const timeline = (h: H, model: Model, inputs: ViewInputs): Html => {
	const pending = pendingOf(model)
	const thread = threadOf(model)
	return (
		lazyTimeline(timelineView, [
			model.items,
			pending,
			model.expandedWork,
			model.expandedSteps,
			model.answerDrafts,
			model.answeringItemId,
			model.answerError,
			isReadOnly(model, inputs.shared),
			thread?.status ?? null,
			thread?.errorMessage ?? null,
			thread?.externalLink ?? null,
			thread?.engine ?? model.engines.preferred,
			model.threadId === null && pending === null,
			suggestionsFor(inputs.context),
			h,
		]) ?? h.empty
	)
}

/** What a screen reader hears as the thread moves: "Working", then "Assistant replied". */
const announcementOf = (model: Model): string => {
	const thread = threadOf(model)
	if (thread?.status === "running" || model.pending?.isSending === true) return "Working"
	return model.items.at(-1)?.kind === "assistant" ? "Assistant replied" : ""
}

const liveRegion = (h: H, model: Model): Html =>
	h.div([h.Role("status"), h.Class("sr-only")], [announcementOf(model)])

// COMPOSER

const composerKey = (key: string, modifiers: { readonly shiftKey: boolean }) =>
	key === "Enter" && !modifiers.shiftKey ? Option.some(Message.SubmittedComposer()) : Option.none()

const composer = (h: H, model: Model, inputs: ViewInputs): Html => {
	const thread = threadOf(model)
	const canStop = isStoppable(thread)
	const isSending = model.pending?.isSending === true
	const context = inputs.context
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
								isPill: true,
								onPress: Message.ToggledContext(),
								ariaLabel: `Send "${context.label}" as context`,
								className: "h-7 max-w-full px-2.5 font-normal text-xs sm:h-6",
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
							// A thread stays on its engine; a new chat starts on the chosen one.
							thread === null
								? engineMenu(h, model)
								: h.span(
										[
											h.Class(
												"flex min-w-0 items-center gap-1.5 pl-1 text-muted-fg text-xs",
											),
										],
										[
											engineMark(h, thread.engine, "size-4"),
											h.span(
												[h.Class("truncate")],
												[engineText(thread.engine, thread.engineLabel)],
											),
										],
									),
							canStop
								? button(
										h,
										{
											intent: "secondary",
											size: "sq-sm",
											onPress: Message.ClickedStop(),
											isPending: model.isStopping,
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

// ENGINES

const PROVIDER_NAMES = { anthropic: "Anthropic", openai: "OpenAI" } satisfies Record<
	Assistant.HostedProvider,
	string
>

/** "T3 Code · MacBook", "Anthropic · claude-sonnet-5-5". */
export const engineText = (engine: Assistant.Engine, detail: string | null): string => {
	const name = engine === "t3code" ? "T3 Code" : PROVIDER_NAMES[engine]
	return detail === null || detail === "" ? name : `${name} · ${detail}`
}

/** What the engine runs on: T3 Code's environment, or the hosted engine's model. */
const engineDetail = (model: Model, engine: Assistant.Engine): string | null =>
	Match.value(engine).pipe(
		Match.when("t3code", () => model.environmentLabel),
		Match.when("anthropic", () => model.engines.anthropicModel),
		Match.when("openai", () => model.engines.openaiModel),
		Match.exhaustive,
	)

const connectedEngines = (engines: Engines): ReadonlyArray<Assistant.Engine> =>
	(["t3code", "anthropic", "openai"] as const).filter((engine) => engines[engine])

/** A new chat's engine, and the menu to choose another or add a key. */
const engineMenu = (h: H, model: Model): Html => {
	const id = model.engineMenu.id
	const preferred = model.engines.preferred
	const engines = connectedEngines(model.engines)
	const label =
		preferred === null ? "Choose an engine" : engineText(preferred, engineDetail(model, preferred))
	return h.submodel({
		slotId: id,
		model: model.engineMenu,
		view: menuView,
		viewInputs: {
			entries: [
				Menu.section(
					"Run new chats on",
					engines.map((engine) =>
						Menu.item(engine, { textValue: engineText(engine, null), hasDescription: true }),
					),
				),
				Menu.section(undefined, [Menu.item(ADD_KEY_KEY, { textValue: "Add an API key" })]),
			],
			toTrigger: (attributes, overlay) =>
				button(
					h,
					{
						intent: "plain",
						size: "xs",
						isPending: model.isSettingEngine,
						attributes: [
							...attributes,
							h.AriaLabel(`Engine: ${label}. Change`),
							h.Attribute("title", label),
						],
						className: "min-w-0 text-muted-fg",
					},
					[
						preferred === null ? h.empty : engineMark(h, preferred, "size-4"),
						h.span([h.Class("truncate")], [label]),
						IconChevronDown(h, { className: "size-3 shrink-0" }),
						overlay,
					],
				),
			content: (key) => {
				if (key === ADD_KEY_KEY) return [menuLabel(h, id, key, "Add an API key")]
				const engine = engines.find((candidate) => candidate === key)
				if (engine === undefined) return []
				const detail = engineDetail(model, engine)
				return [
					menuLabel(
						h,
						id,
						key,
						engine === preferred
							? `${engineText(engine, null)} (current)`
							: engineText(engine, null),
					),
					...(detail === null ? [] : [menuDescription(h, id, key, detail, "text-xs")]),
				]
			},
			className: "w-64 max-w-[calc(100vw-2rem)]",
		},
		toParentMessage: (message) => Message.GotEngineMenuMessage({ message }),
	})
}

// NOT CONNECTED

/** No engine yet: T3 Code (linked in Settings) or the member's own API key. */
const connectState = (h: H, model: Model, shared: Shared): Html => {
	const isExpired = model.connection === "Expired"
	return h.div(
		[h.Class("flex flex-1 items-center justify-center p-6")],
		[
			emptyState(h, {
				icon: (className) => IconSparkles(h, { className }),
				title: isExpired ? "Your T3 Code sign-in expired" : "Choose how the assistant runs",
				description:
					"Run it on your own T3 Code environment, or in Hazel with your own Anthropic or OpenAI key. Either way it sees only what you can see, and only reads.",
				action: h.div(
					[h.Class("flex flex-wrap items-center justify-center gap-2")],
					[
						shared.orgSlug === null
							? h.empty
							: h.a(
									[
										h.Id(SETUP_ID),
										h.Href(hrefOf(integrationRoute(shared.orgSlug, "t3code"))),
										h.Class(buttonClassName({ size: "sm" })),
										// On a phone the sheet covers the page it opens: close it on the way.
										...(shared.isMobile ? [h.OnClick(Message.ClickedClose())] : []),
									],
									[isExpired ? "Link T3 Code again" : "Use T3 Code"],
								),
						button(
							h,
							{
								intent: "outline",
								size: "sm",
								onPress: Message.ClickedAddKey({ provider: "anthropic" }),
							},
							["Use your own API key"],
						),
					],
				),
			}),
		],
	)
}

/** The member's own key: which provider, the key, saved once the provider accepts it. */
const keyFormView = (h: H, form: KeyForm): Html =>
	h.form(
		[
			h.Class("flex flex-1 flex-col gap-4 p-6"),
			h.OnSubmit(Message.SubmittedKey()),
			h.OnKeyDownPreventDefault((key) =>
				key === "Escape" ? Option.some(Message.CancelledKey()) : Option.none(),
			),
		],
		[
			heading(h, { variant: "subsection", level: 3 }, ["Use your own API key"]),
			h.p(
				[h.Class("text-muted-fg text-sm")],
				[
					"Hazel runs the assistant with your key, with read-only access to what you can see. The key is checked, stored encrypted, and never shown again.",
				],
			),
			h.div(
				[h.Class("flex gap-2"), h.Role("group"), h.AriaLabel("Provider")],
				(["anthropic", "openai"] as const).map((provider) =>
					toggleChip(h, {
						label: PROVIDER_NAMES[provider],
						isPressed: form.provider === provider,
						isDisabled: form.isSaving,
						onPress: Message.PickedKeyProvider({ provider }),
					}),
				),
			),
			textField(
				h,
				{
					id: KEY_FIELD_ID,
					value: form.value,
					onInput: (value) => Message.ChangedKey({ value }),
					isInvalid: form.error !== null,
					isDisabled: form.isSaving,
				},
				(parts) => [
					parts.label([`${PROVIDER_NAMES[form.provider]} API key`]),
					parts.input({
						placeholder: form.provider === "anthropic" ? "sk-ant-…" : "sk-…",
						className: "font-mono text-sm",
						attributes: [
							h.Type("password"),
							h.Attribute("autocomplete", "off"),
							h.Attribute("spellcheck", "false"),
						],
					}),
					parts.fieldError([form.error ?? ""]),
				],
			),
			h.div(
				[h.Class("flex justify-end gap-2")],
				[
					button(
						h,
						{
							intent: "plain",
							size: "sm",
							onPress: Message.CancelledKey(),
							isDisabled: form.isSaving,
						},
						["Cancel"],
					),
					button(
						h,
						{
							size: "sm",
							isPending: form.isSaving,
							isDisabled: form.value.trim() === "",
							attributes: [h.Type("submit")],
						},
						["Save key"],
					),
				],
			),
		],
	)

// PANEL

const checkingState = (h: H): Html =>
	h.div(
		[h.Class("flex flex-1 items-center justify-center")],
		[loader(h, { className: "size-4", ariaLabel: "Checking the assistant" })],
	)

const content = (h: H, model: Model, inputs: ViewInputs): ReadonlyArray<Html> => {
	const thread = threadOf(model)
	const isConnected = model.connection !== "NotConnected" && model.connection !== "Expired"
	return [
		header(h, model, inputs),
		liveRegion(h, model),
		h.div(
			[
				h.Class("flex min-h-0 flex-1 flex-col"),
				// Escape anywhere below the header (whose history menu handles its own) closes the panel.
				h.OnKeyDownPreventDefault((key) =>
					key === "Escape" ? Option.some(Message.ClickedClose()) : Option.none(),
				),
			],
			// Until it is known which engines are connected, a new chat offers nothing to send.
			model.keyForm !== null && model.threadId === null
				? [keyFormView(h, model.keyForm)]
				: model.connection === "Checking" && model.threadId === null
					? [checkingState(h)]
					: !isConnected && model.threadId === null
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

/**
 * The panel and the page beside it (the sidebar inset), read off the grabbed edge: the panel may
 * take what the page has beyond its own minimum.
 */
const measureEdge = (target: EventTarget | null, fallbackWidth: number) => {
	const panel = target instanceof Element ? target.closest(`#${PANEL_ID}`) : null
	const page = panel?.parentElement?.querySelector('[data-slot="sidebar-inset"]') ?? null
	const startWidth = panel?.getBoundingClientRect().width ?? fallbackWidth
	return {
		startWidth,
		maxWidth:
			page === null ? fallbackWidth : page.getBoundingClientRect().width + startWidth - MIN_PAGE_WIDTH,
	}
}

/**
 * The widest the panel may be: the window less the page's minimum and the sidebar (its nav rail
 * when docked). On a narrow window it stays at its own minimum rather than getting squeezed.
 */
const maxWidthStyle = (isSidebarCollapsed: boolean) =>
	`max(${MIN_WIDTH}px, calc(100% - ${MIN_PAGE_WIDTH}px - var(${isSidebarCollapsed ? "--sidebar-width-dock" : "--sidebar-width"})))`

const desktopPanel = (h: H, model: Model, inputs: ViewInputs): Html => {
	const width = widthOf(model)
	return h.aside(
		[
			h.Id(PANEL_ID),
			h.Attribute(PANEL_MARK, ""),
			h.AriaLabel("AI assistant"),
			h.Class(splitPanelClassName("right", "sticky top-0 h-dvh")),
			h.Attribute(
				"style",
				`width: ${width}px; min-width: ${MIN_WIDTH}px; max-width: ${maxWidthStyle(inputs.isSidebarCollapsed)};`,
			),
		],
		[
			resizeEdge(h, {
				label: "Resize assistant panel",
				position: "right",
				width,
				minWidth: MIN_WIDTH,
				maxWidth: model.edgeMaxWidth ?? MAX_KEYBOARD_WIDTH,
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
				h.div(
					[h.Attribute(PANEL_MARK, ""), h.Class("flex h-full min-h-0 flex-col")],
					[...content(h, model, inputs)],
				),
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
				h.Id(TOGGLE_ID),
				h.AriaLabel("AI assistant"),
				h.Attribute("title", label),
				h.AriaPressed(options.isOpen ? "true" : "false"),
			],
		},
		[IconSparkles(h, { className: "size-5" })],
	)
}
