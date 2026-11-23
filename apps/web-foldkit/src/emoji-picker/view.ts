import { Option } from "effect"
import { AsyncData, Mount } from "foldkit"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { failureMessage } from "~/lib/error-messages"
import { cn } from "~/lib/utils"
import { IconLoader, IconMagnifier3 } from "../icons"
import { button } from "../ui/button"
import { EMOJI_FONT_FAMILY, type PickerCategory, type PickerData, type PickerEmoji } from "./data"
import {
	activeEmoji,
	COLUMNS,
	isLoading,
	isNavigationKey,
	type LoadEmojiDataFailure,
	MeasurePicker,
	Message,
	type Model,
	pickerData,
	TrackPickerFocusOut,
	viewportRange,
} from "./picker"

/**
 * frimousse's DOM (attributes, inline styles, sizers, virtualized rows, sticky category
 * headers) styled by the legacy `components/emoji-picker/*` class names.
 */

const VISUALLY_HIDDEN =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; white-space: nowrap; width: 1px; overflow-wrap: normal;"

/** 9 columns of 40px overflow a 375px phone; 36px cells fit with the sheet's gutters. */
export const EMOJI_CELL_CLASS =
	"flex size-10 items-center justify-center rounded-lg text-2xl leading-none max-md:size-9"
const EMOJI_CLASS = `${EMOJI_CELL_CLASS} data-[active]:bg-wash-strong`
/** A custom emoji's image inside a cell. */
export const EMOJI_IMAGE_CLASS = "size-6 object-contain max-md:size-5.5"
const ROW_CLASS = "scroll-my-1.5 px-1.5"
/** Sticky over the list, so it carries the picker's surface colour. */
export const CATEGORY_HEADER_CLASS =
	"bg-overlay px-3 pt-3 pb-1.5 font-medium text-muted-fg text-xs leading-none"

const px = (value: number | null) => (value === null ? "" : `${value}px`)

/** `EmojiPickerEmoji` with frimousse's `listEmojiProps`. */
const emojiButton = <M>(
	h: HtmlBuilder<M>,
	emoji: PickerEmoji,
	columnIndex: number,
	isActive: boolean,
	events: ReadonlyArray<Attribute<M>>,
): Html =>
	h.button(
		[
			...events,
			h.Attribute("aria-colindex", String(columnIndex)),
			...(isActive ? [h.Attribute("aria-selected", "true"), h.Attribute("data-active", "")] : []),
			h.Attribute("aria-label", emoji.label),
			h.Class(EMOJI_CLASS),
			h.Attribute("data-slot", "emoji-picker-emoji"),
			h.Attribute("frimousse-emoji", ""),
			h.Role("gridcell"),
			h.Attribute("style", "font-family: var(--frimousse-emoji-font);"),
			h.Attribute("tabindex", "-1"),
		],
		[
			emoji.imageUrl
				? h.img([
						h.Attribute("src", emoji.imageUrl),
						h.Attribute("alt", ""),
						h.Attribute("draggable", "false"),
						h.Class(EMOJI_IMAGE_CLASS),
					])
				: emoji.emoji,
		],
	)

/** `EmojiPickerListSizers`: a hidden row and header that frimousse measures. */
const sizers = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Attribute("aria-hidden", "true"), h.Attribute("style", "height: 0px; visibility: hidden;")],
		[
			h.div(
				[h.Attribute("frimousse-row-sizer", "")],
				[
					h.div(
						[
							h.Class(ROW_CLASS),
							h.Attribute("data-slot", "emoji-picker-row"),
							h.Attribute("frimousse-row", ""),
							h.Attribute("style", "display: flex;"),
						],
						Array.from({ length: COLUMNS }, (_, index) =>
							emojiButton(h, { emoji: "🙂", label: "" }, index, false, []),
						),
					),
				],
			),
			h.div(
				[
					h.Attribute("frimousse-category", ""),
					h.Attribute(
						"style",
						"contain: content; width: 100%; pointer-events: none; position: absolute;",
					),
				],
				[
					h.div(
						[h.Attribute("frimousse-category-header-sizer", "")],
						[
							h.div(
								[
									h.Class(CATEGORY_HEADER_CLASS),
									h.Attribute("data-slot", "emoji-picker-category-header"),
									h.Attribute("frimousse-category-header", ""),
									h.Attribute("style", "pointer-events: auto; position: sticky; top: 0px;"),
								],
								["Category"],
							),
						],
					),
				],
			),
		],
	)

const categoryView = <M>(h: HtmlBuilder<M>, category: PickerCategory, index: number): Html =>
	h.keyed("div")(
		`category-${index}`,
		[
			h.Attribute("frimousse-category", ""),
			h.Attribute(
				"style",
				`contain: content; top: calc(${index} * var(--frimousse-category-header-height) + ${category.startRowIndex} * var(--frimousse-row-height)); height: calc(var(--frimousse-category-header-height) + ${category.rowsCount} * var(--frimousse-row-height)); width: 100%; pointer-events: none; position: absolute;`,
			),
		],
		[
			h.div(
				[
					h.Class(CATEGORY_HEADER_CLASS),
					h.Attribute("data-slot", "emoji-picker-category-header"),
					h.Attribute("frimousse-category-header", ""),
					h.Attribute(
						"style",
						"contain: layout paint; height: var(--frimousse-category-header-height); pointer-events: auto; position: sticky; top: 0px;",
					),
				],
				[category.label],
			),
		],
	)

/** `EmojiPicker.List` with the legacy Row, Emoji and CategoryHeader components. */
const listView = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	data: PickerData | null,
	toMessage: (message: Message) => M,
): Html => {
	const rowsCount = data?.rows.length ?? 0
	const categoriesCount = data?.categories.length ?? 0
	const range = data === null ? { startRowIndex: 0, endRowIndex: 0 } : viewportRange(model, data)
	const previousHeaders = (data?.categoriesStartRowIndices ?? []).filter(
		(index) => index < range.startRowIndex,
	).length
	const isActiveAt = (rowIndex: number, columnIndex: number) =>
		model.interaction !== "None" &&
		model.activeRowIndex === rowIndex &&
		model.activeColumnIndex === columnIndex
	const rows =
		data === null || rowsCount === 0
			? []
			: Array.from({ length: range.endRowIndex - range.startRowIndex + 1 }, (_, offset) => {
					const rowIndex = range.startRowIndex + offset
					const row = data.rows[rowIndex]
					if (row === undefined) return []
					return [
						...(data.categoriesStartRowIndices.includes(rowIndex)
							? [
									h.keyed("div")(`header-space-${rowIndex}`, [
										h.Attribute(
											"style",
											"height: var(--frimousse-category-header-height);",
										),
									]),
								]
							: []),
						h.keyed("div")(
							`row-${rowIndex}`,
							[
								h.Attribute("aria-rowindex", String(rowIndex)),
								h.Class(ROW_CLASS),
								h.Attribute("data-slot", "emoji-picker-row"),
								h.Attribute("frimousse-row", ""),
								h.Role("row"),
								h.Attribute(
									"style",
									"contain: content; height: var(--frimousse-row-height); display: flex;",
								),
							],
							row.emojis.map((emoji, columnIndex) =>
								emojiButton(h, emoji, columnIndex, isActiveAt(rowIndex, columnIndex), [
									h.OnClick(toMessage(Message.ClickedEmoji({ rowIndex, columnIndex }))),
									h.OnMouseEnter(
										toMessage(Message.HoveredEmoji({ rowIndex, columnIndex })),
									),
									h.OnMouseLeave(toMessage(Message.UnhoveredEmoji())),
								]),
							),
						),
					]
				}).flat()
	return h.div(
		[
			h.Attribute("aria-colcount", String(COLUMNS)),
			h.Attribute("aria-rowcount", String(rowsCount)),
			h.Class("select-none pb-1.5"),
			h.Attribute("data-slot", "emoji-picker-list"),
			h.Attribute("frimousse-list", ""),
			h.Role("grid"),
			h.Attribute("style", `--frimousse-list-columns: ${COLUMNS};`),
		],
		[
			h.div(
				[
					h.Attribute("frimousse-list-sizer", ""),
					h.Attribute(
						"style",
						`position: relative; box-sizing: border-box; height: calc(${rowsCount} * var(--frimousse-row-height) + ${categoriesCount} * var(--frimousse-category-header-height)); padding-top: calc(${range.startRowIndex} * var(--frimousse-row-height) + ${previousHeaders} * var(--frimousse-category-header-height));`,
					),
				],
				[
					sizers(h),
					...rows,
					...(data?.categories ?? []).map((category, index) => categoryView(h, category, index)),
				],
			),
		],
	)
}

/** The dataset could not load: what went wrong, and a way to try again. */
const failureView = <M>(
	h: HtmlBuilder<M>,
	reason: LoadEmojiDataFailure,
	toMessage: (message: Message) => M,
): Html => {
	const copy = failureMessage(reason, {})
	return h.div(
		[
			h.Class("absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"),
			h.Attribute("data-slot", "emoji-picker-error"),
			h.Role("alert"),
		],
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.span([h.Class("font-medium text-fg text-sm")], [copy.title]),
					copy.description === undefined
						? h.empty
						: h.span([h.Class("text-muted-fg text-xs")], [copy.description]),
				],
			),
			button(
				h,
				{ intent: "outline", size: "sm", onPress: toMessage(Message.ClickedRetryLoadEmojiData()) },
				["Try again"],
			),
		],
	)
}

/** `EmojiPickerContent`: the viewport with its loading, failure and empty states and the list. */
const viewportView = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html => {
	const data = pickerData(model)
	const active = activeEmoji(model)
	const intrinsic =
		data === null
			? ""
			: ` contain-intrinsic-size: var(--frimousse-viewport-width, auto) calc(${data.rows.length} * var(--frimousse-row-height) + ${data.categories.length} * var(--frimousse-category-header-height));`
	return h.div(
		[
			h.Class("relative flex-1 outline-hidden"),
			h.Attribute("data-slot", "emoji-picker-viewport"),
			h.Attribute("frimousse-viewport", ""),
			h.OnFocus(toMessage(Message.FocusedViewport())),
			h.OnMount(Mount.mapMessage(MeasurePicker(), toMessage)),
			h.Attribute(
				"style",
				`position: relative; box-sizing: border-box; contain: layout paint;${intrinsic} overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; will-change: scroll-position;`,
			),
		],
		[
			active === null
				? h.empty
				: h.div(
						[h.Attribute("aria-live", "polite"), h.Attribute("style", VISUALLY_HIDDEN)],
						[active.label],
					),
			Option.match(AsyncData.getError(model.data), {
				onNone: () => h.empty,
				onSome: (reason) => failureView(h, reason, toMessage),
			}),
			isLoading(model)
				? h.span(
						[
							h.Class("absolute inset-0 flex items-center justify-center text-muted-fg"),
							h.Attribute("data-slot", "emoji-picker-loading"),
							h.Attribute("frimousse-loading", ""),
						],
						[IconLoader(h, { className: "size-4 animate-spin" })],
					)
				: h.empty,
			data !== null && data.count === 0
				? h.span(
						[
							h.Class(
								"absolute inset-0 flex items-center justify-center text-muted-fg text-sm",
							),
							h.Attribute("data-slot", "emoji-picker-empty"),
							h.Attribute("frimousse-empty", ""),
						],
						["No emoji found"],
					)
				: h.empty,
			listView(h, model, data, toMessage),
		],
	)
}

/** `EmojiPickerFooter` with `EmojiPicker.ActiveEmoji`. */
const footerView = <M>(h: HtmlBuilder<M>, model: Model): Html => {
	const active = activeEmoji(model)
	return h.div(
		[
			h.Class(
				"flex h-12 w-full min-w-0 max-w-(--frimousse-viewport-width) flex-none items-center gap-2.5 border-border border-t px-3",
			),
			h.Attribute("data-slot", "emoji-picker-footer"),
		],
		active === null
			? [h.span([h.Class("truncate px-0.5 text-muted-fg text-sm")], ["Pick an emoji"])]
			: [
					h.div(
						[
							h.Class(
								"flex size-8 flex-none items-center justify-center text-2xl leading-none",
							),
							h.Attribute("style", "font-family: var(--frimousse-emoji-font);"),
						],
						[
							active.imageUrl
								? h.img([
										h.Attribute("src", active.imageUrl),
										h.Attribute("alt", ""),
										h.Class("size-6 object-contain"),
									])
								: active.emoji,
						],
					),
					h.span([h.Class("min-w-0 truncate font-medium text-fg text-sm")], [active.label]),
				],
	)
}

export interface PickerViewInputs<M> {
	readonly toMessage: (message: Message) => M
	readonly className?: string
	/** The dialog's `CustomEmojiSection`, between the list and the footer. */
	readonly customSection?: Html
}

/** `<EmojiPicker className=...><EmojiPickerSearch /><EmojiPickerContent />…<EmojiPickerFooter /></EmojiPicker>`. */
export const pickerView = <M>(h: HtmlBuilder<M>, model: Model, inputs: PickerViewInputs<M>): Html => {
	const { toMessage } = inputs
	const measured =
		model.rowHeight === null
			? ""
			: ` --frimousse-viewport-width: ${px(model.viewportWidth)}; --frimousse-viewport-height: ${px(model.viewportHeight)}; --frimousse-row-height: ${px(model.rowHeight)}; --frimousse-category-header-height: ${px(model.categoryHeaderHeight)};`
	return h.div(
		[
			h.Class(
				cn(
					"isolate flex h-full w-fit flex-col overflow-hidden bg-overlay text-overlay-fg",
					inputs.className,
				),
			),
			...(model.isFocusedWithin ? [h.Attribute("data-focused", "")] : []),
			h.Attribute("data-slot", "emoji-picker"),
			h.Attribute("frimousse-root", ""),
			h.Attribute("style", `--frimousse-emoji-font: ${EMOJI_FONT_FAMILY};${measured}`),
			// frimousse's keydown while focus is inside the picker: arrows move, Enter picks the active
			// emoji (with none active, Enter keeps activating the focused button, e.g. "Try again").
			h.OnKeyDownPreventDefault((key) =>
				isNavigationKey(key) && (key !== "Enter" || activeEmoji(model) !== null)
					? Option.some(toMessage(Message.PressedNavigationKey({ key })))
					: Option.none(),
			),
			h.OnMount(Mount.mapMessage(TrackPickerFocusOut(), toMessage)),
		],
		[
			h.div(
				[h.Class("flex-none p-2 pb-1"), h.Attribute("data-slot", "emoji-picker-search-wrapper")],
				[
					h.div(
						[
							h.Class(
								"flex h-9 items-center gap-2 rounded-lg bg-field px-2.5 text-muted-fg transition-colors hover:bg-field-hover focus-within:bg-field-hover focus-within:text-fg",
							),
						],
						[
							IconMagnifier3(h, { className: "size-4 shrink-0" }),
							h.input([
								h.AriaLabel("Search emoji"),
								h.Attribute("autocapitalize", "off"),
								h.Attribute("autocomplete", "off"),
								h.Attribute("autocorrect", "off"),
								h.Class(
									"h-full w-full min-w-0 bg-transparent text-base text-fg outline-hidden placeholder:text-muted-fg sm:text-sm [&::-webkit-search-cancel-button]:hidden",
								),
								h.Attribute("data-slot", "emoji-picker-search"),
								h.Attribute("enterkeyhint", "done"),
								h.Attribute("frimousse-search", ""),
								h.Attribute("placeholder", "Search emoji…"),
								h.Attribute("spellcheck", "false"),
								h.Attribute("type", "search"),
								h.OnInput((search) => toMessage(Message.UpdatedSearch({ search }))),
								h.OnFocus(toMessage(Message.FocusedSearch())),
							]),
						],
					),
				],
			),
			viewportView(h, model, toMessage),
			inputs.customSection ?? h.empty,
			footerView(h, model),
		],
	)
}
