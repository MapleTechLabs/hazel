import type { Html, HtmlBuilder } from "foldkit/html"
import type { TimezoneCity } from "~/utils/timezone"
import { IconCheck, IconMapPin, IconSparkles } from "../../../icons"
import { Message } from "../message"
import { enterAnimation } from "../enter-animation"

/** `city-card.tsx`: local time at the city, refreshed with the shared clock. */

const timeIn = (timezone: string, nowMs: number) =>
	new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: true,
	}).format(nowMs)

export const cityCard = (
	h: HtmlBuilder<Message>,
	options: {
		readonly city: TimezoneCity
		readonly isSelected: boolean
		readonly isDetected: boolean
		readonly nowMs: number
	},
): Html => {
	const { city, isSelected } = options
	const muted = isSelected ? "text-primary-fg/70" : "text-muted-fg"
	return h.button(
		[
			h.Key(city.timezone),
			h.Type("button"),
			h.OnClick(Message.ClickedCity({ timezone: city.timezone })),
			h.OnMouseEnter(Message.HoveredOffset({ offset: city.offset })),
			h.OnMouseLeave(Message.HoveredOffset({ offset: null })),
			h.Class(
				`relative p-4 rounded-xl text-left transition-all active:scale-[0.98] ${
					isSelected
						? "bg-primary text-primary-fg ring-2 ring-inset ring-primary/30"
						: "bg-bg hover:bg-secondary border border-border hover:border-primary/50"
				}`,
			),
		],
		[
			...(options.isDetected && !isSelected
				? [
						h.div(
							[
								h.Class(
									"absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-primary text-primary-fg rounded-full flex items-center gap-0.5 text-[10px] font-medium",
								),
								...enterAnimation(h, "Pop"),
							],
							[IconSparkles(h, { className: "size-2.5" }), "Detected"],
						),
					]
				: []),
			...(isSelected
				? [
						h.div(
							[
								h.Class(
									"absolute -top-1.5 -right-1.5 size-6 bg-bg text-primary rounded-full flex items-center justify-center shadow-md",
								),
								...enterAnimation(h, "Pop"),
							],
							[IconCheck(h, { className: "size-3.5" })],
						),
					]
				: []),
			h.div(
				[h.Class("flex items-start justify-between gap-2 mb-2")],
				[
					h.div(
						[h.Class("flex items-center gap-1.5")],
						[
							IconMapPin(h, { className: `size-3.5 ${muted}` }),
							h.span([h.Class(`text-xs ${muted}`)], [city.country]),
						],
					),
				],
			),
			h.h3(
				[h.Class(`font-semibold mb-1 truncate ${isSelected ? "text-primary-fg" : "text-fg"}`)],
				[city.name],
			),
			h.div(
				[h.Class("flex items-baseline gap-2")],
				[
					h.span(
						[
							h.Class(
								`text-xl font-bold tabular-nums ${isSelected ? "text-primary-fg" : "text-fg"}`,
							),
						],
						[timeIn(city.timezone, options.nowMs)],
					),
					h.span(
						[h.Class(`text-xs ${isSelected ? "text-primary-fg/60" : "text-muted-fg"}`)],
						["UTC", city.offset >= 0 ? "+" : "", String(city.offset)],
					),
				],
			),
		],
	)
}
