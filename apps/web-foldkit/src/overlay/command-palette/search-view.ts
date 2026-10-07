import type { Html, HtmlBuilder } from "foldkit/html"
import { IconMagnifier3 } from "../../icons"
import type { Message } from "./message"
import type { Model, PageState } from "./model"

/** `SearchView` (`components/command-palette/search-view.tsx`). */

type SearchPage = Extract<PageState, { _tag: "Search" }>

const KBD = "inline-grid h-4 min-w-4 place-content-center rounded-xs bg-secondary px-1"

const emptyState = (h: HtmlBuilder<Message>, message: string): Html =>
	h.div(
		[h.Class("flex flex-col items-center justify-center py-8 text-center")],
		[IconMagnifier3(h, { className: "mb-3 size-8 text-muted-fg/50" }), h.p([h.Class("text-muted-fg text-sm")], [message])],
	)

const footer = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex-none border-t px-2 py-1.5 text-muted-fg text-xs")],
		[
			h.span([], [h.kbd([h.Class(`mx-1 ${KBD}`)], ["↑"]), h.kbd([h.Class(`mr-2 ${KBD}`)], ["↓"]), "to navigate"]),
			h.span([h.Class("ml-3")], [h.kbd([h.Class(`mx-1 ${KBD}`)], ["↵"]), "to select"]),
			h.span([h.Class("ml-3")], [h.kbd([h.Class(`mx-1 ${KBD}`)], ["esc"]), "to go back"]),
		],
	)

export const searchPage = (h: HtmlBuilder<Message>, _model: Model, page: SearchPage): Html =>
	h.div(
		[h.Class("flex max-h-[inherit] flex-col overflow-hidden")],
		[
			h.div(
				[h.Class("flex items-center gap-2 border-b px-2.5 py-1")],
				[IconMagnifier3(h, { className: "size-5 shrink-0 text-muted-fg" }), h.div([h.Class("relative min-w-0 flex-1")], [])],
			),
			h.div(
				[h.Class("flex-1 overflow-y-auto p-2")],
				[page.rawInput === "" ? emptyState(h, "Start typing to search messages across all channels") : h.empty],
			),
			footer(h),
		],
	)
