import type { Html, HtmlBuilder } from "foldkit/html"
import { Message } from "../message"

/** `time-ribbon.tsx` */

const UTC_OFFSETS: ReadonlyArray<{ offset: number; label: string }> = [
	...[-12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1].map((offset) => ({
		offset,
		label: String(offset),
	})),
	{ offset: 0, label: "UTC" },
	...[1, 2, 3, 4, 5].map((offset) => ({ offset, label: `+${offset}` })),
	{ offset: 5.5, label: "+5:30" },
	...[6, 7, 8, 9, 10, 11, 12].map((offset) => ({ offset, label: `+${offset}` })),
]

const BASE = "relative px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors shrink-0"

export const timeRibbon = (h: HtmlBuilder<Message>, selectedOffset: number | null): Html =>
	h.div(
		[h.Class("relative")],
		[
			h.div(
				[
					h.Class("flex gap-1 overflow-x-auto scrollbar-hide py-2 px-4"),
					h.Attribute("style", "scrollbar-width: none;"),
				],
				UTC_OFFSETS.map((item) => {
					const isSelected = selectedOffset === item.offset
					return h.button(
						[
							h.Class(
								`${BASE} ${isSelected ? "bg-primary text-primary-fg" : "hover:bg-secondary text-muted-fg hover:text-fg"}`,
							),
							h.Tabindex(0),
							h.OnClick(Message.ClickedOffset({ offset: item.offset })),
							h.OnMouseEnter(Message.HoveredOffset({ offset: item.offset })),
							h.OnMouseLeave(Message.HoveredOffset({ offset: null })),
						],
						[
							item.label,
							...(isSelected
								? [
										h.div([
											h.Class(
												"absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary",
											),
											h.Attribute("style", "opacity: 1;"),
										]),
									]
								: []),
						],
					)
				}),
			),
		],
	)
