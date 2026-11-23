import { integrations } from "@hazel/customer-integrations"
import * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { calendarHeatmap, heatLegend } from "../../../customers/charts/calendar-heatmap"
import { formatDayLong } from "../../../customers/format"
import { msOf } from "../../../customers/queries"
import { segmentClass, segmentedTrackClass } from "../../../customers/ui/filter-bar"
import { sourceLabel } from "../../../customers/providers"
import { sourceLogo, sourceMark } from "../../../customers/ui/identity"
import { IconChevronDown } from "../../../icons"
import { button } from "../../../ui/button"
import { heading } from "../../../ui/heading"
import { menuLabel } from "../../../ui/menu-view"
import { RevealCalendarDay } from "./commands"
import { eventDetail } from "./event-detail"
import { Message } from "./message"
import { type EventType, eventTypeEntries, type Model } from "./model"
import { noteBody } from "./overview-tab"
import { type Context, memberOf, menu, pageFooter, skeletonRows } from "./parts"

/** The activity tab: the account's timeline by day, filtered by source and type, paged. */

const TYPE_LABEL = {
	all: "All events",
	billing: "Billing",
	signals: "Signals",
	contacts: "Contacts",
	notes: "Notes",
} as const satisfies Record<EventType, string>

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" })
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

const dayKey = (ms: number) => new Date(ms).toDateString()

/** `Today`, `Yesterday`, else the weekday; with the date beside it. */
const dayHeading = (ms: number, nowMs: number): readonly [string, string] => {
	const [weekday = "", ...rest] = dayFormat.format(ms).split(", ")
	const date = rest.join(", ")
	if (dayKey(ms) === dayKey(nowMs)) return ["Today", `${weekday.slice(0, 3)}, ${date}`]
	if (dayKey(ms) === dayKey(nowMs - 86_400_000)) return ["Yesterday", date]
	return [weekday, date]
}

const eventRow = (
	h: HtmlBuilder<Message>,
	event: Customers.Event,
	notes: Model["notes"],
	context: Context,
): Html => {
	const actor = memberOf(context, event.actorUserId)?.name ?? null
	const { summary, quote } = eventDetail(event, {
		notes,
		nameOf: (userId) => memberOf(context, userId)?.name ?? null,
		nowMs: context.nowMs,
		currency: context.account.currency,
	})
	const byline = [actor ?? sourceLabel(event.provider), ...(summary === null ? [] : [summary])]
	return h.li(
		[h.Key(event.id), h.Class("flex gap-3 py-3")],
		[
			sourceMark(h, event.provider, { className: "size-7" }),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-1.5")],
				[
					h.div(
						[h.Class("flex items-start justify-between gap-4")],
						[
							h.div(
								[h.Class("flex min-w-0 flex-col")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], [event.title]),
									h.span([h.Class("text-muted-fg text-xs")], [byline.join(" · ")]),
								],
							),
							h.span(
								[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
								[timeFormat.format(msOf(event.occurredAt))],
							),
						],
					),
					...(quote === null
						? []
						: [noteBody(h, quote, "rounded-lg border border-border bg-wash px-3 py-2")]),
				],
			),
		],
	)
}

const activeUsers = (count: number) =>
	`${count === 0 ? "No" : count} active ${count === 1 ? "user" : "users"}`

/** The year at a glance: a day's square shaded by how many of the account's people were active. */
const yearCalendar = (h: HtmlBuilder<Message>, model: Model): Html => {
	const points = Option.getOrUndefined(AsyncData.getData(model.yearActivity))?.[0]?.points
	const failed = AsyncData.getError(model.yearActivity)._tag === "Some"
	const activeDays = points?.filter((point) => point.value > 0).length ?? 0
	const busiest = points?.reduce<(typeof points)[number] | undefined>(
		(most, point) => (point.value > (most?.value ?? 0) ? point : most),
		undefined,
	)
	// The year's headline leads; the busiest day backs it; the key sits under the grid it explains.
	const title =
		points === undefined
			? "Activity in the last year"
			: activeDays === 0
				? "No activity in the last year"
				: `${activeDays} active ${activeDays === 1 ? "day" : "days"} in the last year`
	const detail =
		busiest === undefined
			? null
			: `Busiest on ${formatDayLong(busiest.day)}, ${activeUsers(busiest.value).toLowerCase()}`
	const description = [title, ...(detail === null ? [] : [detail])].join(". ")
	return h.section(
		[h.AriaLabel("Activity calendar"), h.Class("flex min-w-0 flex-col gap-4 pb-2")],
		[
			h.header(
				[h.Class("flex flex-col gap-0.5")],
				[
					heading(h, { variant: "subsection", level: 2 }, [title]),
					...(detail === null ? [] : [h.p([h.Class("text-muted-fg text-sm")], [detail])]),
				],
			),
			points === undefined
				? failed
					? h.div(
							[h.Class("flex flex-col items-center gap-3 py-8 text-muted-fg text-sm")],
							[
								h.p([], ["Couldn't load activity."]),
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										onPress: Message.PressedRetryYearActivity(),
									},
									["Try again"],
								),
							],
						)
					: h.div([h.Class("aspect-[7/1] w-full animate-pulse rounded-lg bg-secondary/40")])
				: calendarHeatmap(h, {
						points,
						ariaLabel: `Daily active users over the last year: ${description}`,
						describe: activeUsers,
						hoveredIndex: model.hoveredYearDay,
						onHover: (index) => Message.HoveredYearDay({ index }),
						idPrefix: "year-day",
						revealDay: (dayId) =>
							h.keyed("span")(`reveal-${dayId}`, [
								h.Class("hidden"),
								h.OnMount(RevealCalendarDay({ dayId })),
							]),
					}),
			h.footer(
				[
					h.Class(
						"flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-muted-fg text-xs",
					),
				],
				[h.span([], ["Each square is a day, shaded by its active users"]), heatLegend(h)],
			),
		],
	)
}

const SOURCES: ReadonlyArray<Customers.CustomerSource | null> = [
	null,
	...integrations.map((integration) => integration.id),
	"hazel",
]

const filters = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("flex flex-wrap items-center gap-2")],
		[
			h.div(
				[
					h.Role("radiogroup"),
					h.AriaLabel("Source"),
					h.Class(twMerge(segmentedTrackClass, "flex-wrap")),
				],
				SOURCES.map((source) => {
					const isSelected = source === model.eventProvider
					return h.button(
						[
							h.Type("button"),
							h.Role("radio"),
							h.AriaChecked(isSelected),
							h.OnClick(Message.ClickedEventProvider({ provider: source })),
							h.Class(segmentClass(isSelected)),
						],
						source === null ? ["All"] : [sourceLogo(h, source, "size-3.5"), sourceLabel(source)],
					)
				}),
			),
			menu(h, model.eventTypeMenu, {
				entries: eventTypeEntries,
				trigger: (attributes, overlay) =>
					button(h, { intent: "outline", size: "sm", attributes }, [
						h.span([h.Class("text-muted-fg")], ["Type"]),
						TYPE_LABEL[model.eventType],
						IconChevronDown(h, { className: "size-3" }),
						overlay,
					]),
				content: (key) => [
					menuLabel(h, model.eventTypeMenu.id, key, TYPE_LABEL[key as EventType] ?? key),
				],
				toMessage: (message) => Message.GotEventTypeMenuMessage({ message }),
			}),
		],
	)

export const activityTab = (h: HtmlBuilder<Message>, model: Model, context: Context): ReadonlyArray<Html> => {
	const { items, status } = model.events
	const groups = new Map<string, Array<Customers.Event>>()
	for (const event of items) {
		const key = dayKey(msOf(event.occurredAt))
		groups.set(key, [...(groups.get(key) ?? []), event])
	}
	const footer = pageFooter(h, {
		status,
		hasMore: model.events.nextCursor !== null,
		label: "Show older events",
		onMore: Message.PressedMoreEvents(),
	})
	return [
		yearCalendar(h, model),
		filters(h, model),
		h.div(
			[h.Class("flex flex-col")],
			[
				...(status === "Loading" && items.length === 0 ? skeletonRows(h, 6) : []),
				...(status === "Loaded" && items.length === 0
					? [
							h.p(
								[
									h.Class(
										"rounded-xl border border-border py-12 text-center text-muted-fg text-sm",
									),
								],
								["No events match."],
							),
						]
					: []),
				...[...groups.values()].map((events) => {
					const [heading, date] = dayHeading(msOf(events[0].occurredAt), context.nowMs)
					return h.section(
						[h.Class("flex flex-col")],
						[
							h.h3(
								[
									h.Class(
										"flex items-baseline gap-2 border-border border-b pt-4 pb-2 text-sm",
									),
								],
								[
									h.span([h.Class("font-semibold text-fg")], [heading]),
									h.span([h.Class("text-muted-fg")], [date]),
								],
							),
							h.ul(
								[h.Class("flex flex-col")],
								events.map((event) => eventRow(h, event, model.notes, context)),
							),
						],
					)
				}),
				...(footer === null ? [] : [footer]),
			],
		),
	]
}
