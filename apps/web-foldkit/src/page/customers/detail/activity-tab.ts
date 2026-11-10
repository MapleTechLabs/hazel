import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { msOf } from "../../../customers/queries"
import { SOURCE_LABEL, sourceLogo, sourceMark } from "../../../customers/ui/identity"
import { IconChevronDown } from "../../../icons"
import { button } from "../../../ui/button"
import { menuLabel } from "../../../ui/menu-view"
import { Message } from "./message"
import { type EventType, eventTypeEntries, type Model } from "./model"
import { type Context, memberOf, menu, pageFooter, skeletonRows } from "./parts"

/** The activity tab: the account's timeline by day, filtered by source and type, paged. */

const TYPE_LABEL = {
	all: "All events",
	billing: "Billing",
	signals: "Signals",
	contacts: "Contacts",
	health: "Health",
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

/** The event's data worth showing: a note's body, or its plain values. */
const detailOf = (event: Customers.Event): string | null => {
	const body = event.data.body
	if (typeof body === "string") return `“${body}”`
	const parts = Object.entries(event.data)
		.filter(([, value]) => typeof value === "string" || typeof value === "number")
		.map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()} ${value}`)
	return parts.length === 0 ? null : parts.join(" · ")
}

const eventRow = (h: HtmlBuilder<Message>, event: Customers.Event, context: Context): Html => {
	const actor = memberOf(context, event.actorUserId)?.name ?? null
	const detail = detailOf(event)
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
									h.span(
										[h.Class("text-muted-fg text-xs")],
										[[actor ?? SOURCE_LABEL[event.provider], event.type].join(" · ")],
									),
								],
							),
							h.span(
								[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
								[timeFormat.format(msOf(event.occurredAt))],
							),
						],
					),
					...(detail === null
						? []
						: [
								h.p(
									[
										h.Class(
											"rounded-lg border border-border bg-wash px-3 py-2 text-fg-2 text-sm",
										),
									],
									[detail],
								),
							]),
				],
			),
		],
	)
}

const SOURCES: ReadonlyArray<Customers.CustomerSource | null> = [null, ...Customers.CustomerSource.literals]

const filters = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("flex flex-wrap items-center gap-2")],
		[
			h.div(
				[
					h.Role("radiogroup"),
					h.AriaLabel("Source"),
					h.Class(
						"inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border p-0.5",
					),
				],
				SOURCES.map((source) => {
					const isSelected = source === model.eventProvider
					return h.button(
						[
							h.Type("button"),
							h.Role("radio"),
							h.AriaChecked(isSelected),
							h.OnClick(Message.ClickedEventProvider({ provider: source })),
							h.Class(
								twMerge(
									"inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm outline-hidden hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
									isSelected ? "bg-secondary font-medium text-fg" : "text-fg-3",
								),
							),
						],
						source === null ? ["All"] : [sourceLogo(h, source, "size-3.5"), SOURCE_LABEL[source]],
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
					const [heading, date] = dayHeading(msOf(events[0]!.occurredAt), context.nowMs)
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
								events.map((event) => eventRow(h, event, context)),
							),
						],
					)
				}),
				...(footer === null ? [] : [footer]),
			],
		),
	]
}
