import type { MessageId } from "@hazel/schema"
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

export interface PinnedActions<M> {
	/** A pin was pressed: the popover closes and the channel jumps to its message. */
	readonly toJump: (messageId: MessageId) => M
	readonly toUnpin: (messageId: MessageId) => M
}

/**
 * A pin: the row jumps to its message, and the unpin button sits beside it (never inside it, so the
 * two stay separate controls). Hover reveals the button; keyboard focus and touch screens show it too.
 */
const pinRow = <M>(h: HtmlBuilder<M>, pin: PinnedInfo, actions: PinnedActions<M>): Html => {
	const isEdited = pin.updatedAtMs !== null && pin.updatedAtMs > pin.createdAtMs
	const time = formatTime(pin.createdAtMs)
	return h.div(
		[h.Class("group relative border-border border-b last:border-b-0")],
		[
			ariaButton(
				h,
				{
					className:
						"w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary",
					onPress: actions.toJump(pin.messageId),
				},
				[
					h.div(
						[h.Class("flex gap-3 pr-8")],
						[
							avatar(h, {
								size: "md",
								alt: fullName(pin) ?? "",
								src: pin.author?.avatarUrl,
								seed: fullName(pin) || undefined,
							}),
							h.div(
								[h.Class("min-w-0 flex-1")],
								[
									h.div(
										[h.Class("flex min-w-0 items-baseline gap-2")],
										[
											h.span(
												[h.Class("truncate font-semibold text-fg text-sm")],
												[fullName(pin) ?? "Unknown user"],
											),
											h.span(
												[h.Class("shrink-0 text-muted-fg text-xs")],
												isEdited ? [time, " (edited)"] : [time],
											),
										],
									),
									h.p(
										[h.Class("mt-1 line-clamp-2 break-words text-muted-fg text-sm")],
										[pin.content],
									),
								],
							),
						],
					),
					h.div(
						[h.Class("mt-2 text-muted-fg text-xs")],
						["Pinned ", formatPinnedAt(pin.pinnedAtMs)],
					),
				],
			),
			iconButton(
				h,
				{
					label: "Unpin message",
					size: "sq-xs",
					className:
						"absolute top-2 right-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
					onPress: actions.toUnpin(pin.messageId),
				},
				IconClose(h, { attributes: { "data-slot": "icon" } }),
			),
		],
	)
}

const content = <M>(
	h: HtmlBuilder<M>,
	pins: ReadonlyArray<PinnedInfo>,
	actions: PinnedActions<M>,
): ReadonlyArray<Html> => [
	card(h, { className: "shadow-lg" }, [
		h.div(
			[h.Class("flex items-center gap-2 border-border border-b px-4 py-3")],
			[
				IconPin(h, { className: "size-4 text-muted-fg" }),
				heading(h, { variant: "subsection" }, ["Pinned messages"]),
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
							description:
								"Pin a message from its menu to keep it here for everyone in the channel.",
							className: "px-4 py-8",
						}),
					]
				: [
						h.div(
							[h.Class("flex flex-col")],
							pins.map((pin) => pinRow(h, pin, actions)),
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
	actions: PinnedActions<M>,
): Html =>
	h.submodel({
		slotId: "pinned-messages",
		model: popover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes) => pinnedButton(h, attributes),
			toContent: () => (popover.isOpen ? content(h, pins, actions) : []),
			placement: "bottom end",
			className: "w-96 p-0",
		},
		toParentMessage: toMessage,
	})
