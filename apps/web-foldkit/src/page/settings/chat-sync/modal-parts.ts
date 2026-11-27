import type { Html, HtmlBuilder } from "foldkit/html"
import * as Interaction from "../../../ui/aria/interaction"
import { input, inputGroup, type InteractionTarget } from "../../../ui/input"

/** Markup the chat sync modals repeat: the search input and the searchable list. */

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
		/** The Input's useHover (focus stays on `isFocused`). */
		hover?: InteractionTarget<Message>
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
				...(options.hover === undefined
					? []
					: [
							...Interaction.handlers(h, options.hover.wiring, options.hover.target, {
								isPressDisabled: true,
								isFocusDisabled: true,
							}),
							...(Interaction.stateOf(options.hover.wiring.model, options.hover.target)
								.isHovered
								? [h.DataAttribute("hovered", "true")]
								: []),
						]),
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

/** Case-insensitive name filter; a blank search keeps every item. */
export const filterByName = <A extends { readonly name: string }>(
	items: ReadonlyArray<A>,
	search: string,
): ReadonlyArray<A> =>
	search.trim().length === 0
		? items
		: items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
