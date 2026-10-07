import type { Html, HtmlBuilder } from "foldkit/html"
import { format } from "~/lib/date-fns-shared"
import { IconClose, IconPin } from "../../icons"
import { avatar } from "../../ui/avatar"
import * as Popover from "../../ui/popover"
import { pinnedButton } from "./header"
import type { PinnedInfo } from "./lookups"

/** Port of `PinnedMessagesModal` (a Popover from the header's pin button). */

const fullName = (pin: PinnedInfo) =>
	pin.author ? `${pin.author.firstName} ${pin.author.lastName}` : undefined

/** `UserProfilePopover`'s closed trigger (the avatar). */
const authorAvatar = <M>(h: HtmlBuilder<M>, pin: PinnedInfo): Html =>
	h.button(
		[
			h.Attribute("aria-expanded", "false"),
			h.Class("size-fit outline-hidden"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("tabindex", "0"),
			h.Attribute("type", "button"),
		],
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
	const time = format(new Date(pin.createdAtMs), "HH:mm")
	return h.button(
		[
			h.Class(
				"group relative w-full cursor-pointer border-border border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary",
			),
			h.Attribute("type", "button"),
		],
		[
			h.button(
				[
					h.Class(
						"absolute top-2 right-2 rounded p-1 opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100",
					),
					h.Attribute("aria-label", "Unpin message"),
					h.Attribute("type", "button"),
				],
				[IconClose(h, { className: "size-3.5 text-muted-fg" })],
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
			h.div(
				[h.Class("mt-2 text-muted-fg text-xs")],
				["Pinned", " ", format(new Date(pin.pinnedAtMs), "MMM d 'at' h:mm a")],
			),
		],
	)
}

const content = <M>(h: HtmlBuilder<M>, pins: ReadonlyArray<PinnedInfo>): ReadonlyArray<Html> => [
	h.div(
		[h.Class("rounded-xl border border-border bg-bg shadow-lg")],
		[
			h.div(
				[h.Class("flex items-center gap-2 border-border border-b px-4 py-3")],
				[
					IconPin(h, { className: "size-4 text-muted-fg" }),
					h.h3([h.Class("font-semibold text-fg text-sm")], ["Pinned Messages"]),
					h.span(
						[
							h.Class(
								"ml-auto rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-fg text-xs",
							),
						],
						[String(pins.length), " ", pins.length === 1 ? "pin" : "pins"],
					),
				],
			),
			h.div(
				[h.Class("max-h-[400px] overflow-y-auto")],
				pins.length === 0
					? [
							h.div(
								[h.Class("px-4 py-8 text-center")],
								[
									h.p([h.Class("text-muted-fg text-sm")], ["No pinned messages yet"]),
									h.p(
										[h.Class("mt-1 text-muted-fg/60 text-xs")],
										["Pin important messages to keep them easily accessible"],
									),
								],
							),
						]
					: [
							h.div(
								[h.Class("flex flex-col")],
								pins.map((pin) => pinRow(h, pin)),
							),
						],
			),
		],
	),
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
			toTrigger: (attributes, overlay) => pinnedButton(h, attributes, overlay),
			toContent: () => (popover.isOpen ? content(h, pins) : []),
			placement: "bottom end",
			className: "w-96 p-0",
		},
		toParentMessage: toMessage,
	})
