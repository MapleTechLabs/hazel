import type { Html, HtmlBuilder } from "foldkit/html"
import { input, inputGroup } from "../../../ui/input"

/** Markup the chat sync modals repeat: the picked row, the searchable list and the spinner. */

type Children = ReadonlyArray<Html | string>

/** The chosen item with its "Change" button. */
export const selectedRow = <Message>(
	h: HtmlBuilder<Message>,
	content: Children,
	onChange: Message,
): Html =>
	h.div(
		[
			h.Class(
				"flex items-center justify-between rounded-lg border border-border bg-bg-muted/30 px-3 py-2.5",
			),
		],
		[
			h.div([h.Class("flex items-center gap-2")], [...content]),
			h.button(
				[
					h.Type("button"),
					h.OnClick(onChange),
					h.Class("text-muted-fg text-xs transition-colors hover:text-fg"),
				],
				["Change"],
			),
		],
	)

export const selectedName = <Message>(h: HtmlBuilder<Message>, name: string): Html =>
	h.span([h.Class("font-medium text-fg text-sm")], [name])

/** `<InputGroup><Input placeholder value onChange autoFocus? /></InputGroup>` */
export const searchInput = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		id?: string
		placeholder: string
		value: string
		isFocused: boolean
		onInput: (value: string) => Message
		onFocus?: Message
		onBlur?: Message
	}>,
): Html =>
	inputGroup(h, { attributes: options.isFocused ? [h.Attribute("data-focus-within", "true")] : [] }, [
		input(h, {
			placeholder: options.placeholder,
			attributes: [
				...(options.id === undefined ? [] : [h.Id(options.id)]),
				...(options.isFocused ? [h.Attribute("data-focused", "true")] : []),
				h.Value(options.value),
				h.OnInput(options.onInput),
				...(options.onFocus === undefined ? [] : [h.OnFocus(options.onFocus)]),
				...(options.onBlur === undefined ? [] : [h.OnBlur(options.onBlur)]),
			],
		}),
	])

/** The bordered scroll list, or its empty line. */
export const scrollList = <Message>(
	h: HtmlBuilder<Message>,
	maxHeightClass: string,
	emptyText: string,
	rows: ReadonlyArray<Html>,
): Html =>
	h.div(
		[h.Class(`${maxHeightClass} overflow-y-auto rounded-lg border border-border`)],
		rows.length === 0
			? [h.div([h.Class("px-3 py-6 text-center text-muted-fg text-sm")], [emptyText])]
			: [...rows],
	)

/** `<div className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />` and its text. */
export const spinnerLine = <Message>(h: HtmlBuilder<Message>, text: string): Html =>
	h.div(
		[h.Class("flex items-center gap-3 text-muted-fg")],
		[
			h.div([h.Class("size-5 animate-spin rounded-full border-2 border-border border-t-primary")], []),
			h.span([h.Class("text-sm")], [text]),
		],
	)

/** Case-insensitive name filter; a blank search keeps every item. */
export const filterByName = <A extends { readonly name: string }>(
	items: ReadonlyArray<A>,
	search: string,
): ReadonlyArray<A> =>
	search.trim().length === 0
		? items
		: items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
