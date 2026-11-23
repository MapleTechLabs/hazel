import type { Html, HtmlBuilder } from "foldkit/html"
import { IconClose, IconPin } from "../../icons"
import { formatTime } from "../../chat/message/parts"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import { ariaButton, iconButton } from "../../ui/button"
import { card } from "../../ui/card"
import { emptyState } from "../../ui/empty-state"
import * as Popover from "../../ui/popover"
import { pinnedButton } from "./header"
import type { PinnedInfo } from "./lookups"
import { heading } from "../../ui/heading"

/** Port of `PinnedMessagesModal` (a Popover from the header's pin button). */

const pad = (value: number) => String(value).padStart(2, "0")

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Mar 12 at 2:05 PM" in the local time zone. */
const formatPinnedAt = (ms: number) => {
	const date = new Date(ms)
	const hours = date.getHours()
	const period = hours < 12 ? "AM" : "PM"
	return `${MONTHS[date.getMonth()]} ${date.getDate()} at ${hours % 12 || 12}:${pad(date.getMinutes())} ${period}`
}

const fullName = (pin: PinnedInfo) =>
	pin.author ? `${pin.author.firstName} ${pin.author.lastName}` : undefined

/** `UserProfilePopover`'s closed trigger (the avatar). */
const authorAvatar = <M>(h: HtmlBuilder<M>, pin: PinnedInfo): Html =>
	ariaButton(
		h,
		{ className: "size-fit outline-hidden", attributes: [h.Attribute("aria-expanded", "false")] },
		[
			avatar(h, {
				size: "md",
				alt: fullName(pin) ?? "",
				src: pin.author?.avatarUrl,
				seed: fullName(pin) || undefined,
			}),
		],
	)

const pinRow = <M>(h: HtmlBuilder<M>, pin: PinnedInfo): Html => {
	const isEdited = pin.updatedAtMs !== null && pin.updatedAtMs > pin.createdAtMs
	const time = formatTime(pin.createdAtMs)
	return ariaButton(
		h,
		{
			className:
				"group relative w-full cursor-pointer border-border border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary",
		},
		[
			iconButton(
				h,
				{
					label: "Unpin message",
					size: "sq-xs",
					className: "absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100",
				},
				IconClose(h, { attributes: { "data-slot": "icon" } }),
			),
			h.div(
				[h.Class("flex gap-3 pr-8")],
				[
					authorAvatar(h, pin),
					h.div(
						[h.Class("min-w-0 flex-1")],
						[
							h.div(
								[h.Class("flex items-baseline gap-2")],
								[
									h.span(
										[h.Class("font-semibold text-fg text-sm")],
										[fullName(pin) ?? "Unknown"],
									),
									h.span(
										[h.Class("text-muted-fg text-xs")],
										isEdited ? [time, " (edited)"] : [time],
									),
								],
							),
							h.p([h.Class("mt-1 line-clamp-2 text-muted-fg text-sm")], [pin.content]),
						],
					),
				],
			),
			h.div([h.Class("mt-2 text-muted-fg text-xs")], ["Pinned", " ", formatPinnedAt(pin.pinnedAtMs)]),
		],
	)
}

const content = <M>(h: HtmlBuilder<M>, pins: ReadonlyArray<PinnedInfo>): ReadonlyArray<Html> => [
	card(h, { className: "shadow-lg" }, [
		h.div(
			[h.Class("flex items-center gap-2 border-border border-b px-4 py-3")],
			[
				IconPin(h, { className: "size-4 text-muted-fg" }),
				heading(h, { variant: "subsection" }, ["Pinned Messages"]),
				badge(h, { intent: "muted", isPill: true, className: "ml-auto" }, [
					String(pins.length),
					" ",
					pins.length === 1 ? "pin" : "pins",
				]),
			],
		),
		h.div(
			[h.Class("max-h-[400px] overflow-y-auto")],
			pins.length === 0
				? [
						emptyState(h, {
							title: "No pinned messages yet",
							description: "Pin important messages to keep them easily accessible",
							className: "px-4 py-8",
						}),
					]
				: [
						h.div(
							[h.Class("flex flex-col")],
							pins.map((pin) => pinRow(h, pin)),
						),
					],
		),
	]),
]

export const pinnedPopoverView = <M>(
	h: HtmlBuilder<M>,
	popover: Popover.Model,
	pins: ReadonlyArray<PinnedInfo>,
	toMessage: (message: Popover.Message) => M,
): Html =>
	h.submodel({
		slotId: "pinned-messages",
		model: popover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes) => pinnedButton(h, attributes),
			toContent: () => (popover.isOpen ? content(h, pins) : []),
			placement: "bottom end",
			className: "w-96 p-0",
		},
		toParentMessage: toMessage,
	})
