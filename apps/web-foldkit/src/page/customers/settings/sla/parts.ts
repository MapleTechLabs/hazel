import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconClose } from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { iconButton } from "../../../../ui/button"
import { cardClassName, panelHeader } from "../../../../ui/card"
import * as Field from "../../../../ui/field"

import * as Select from "../../../../ui/select"
import { view as selectView } from "../../../../ui/select-view"
import { Message } from "./message"
import type { Model } from "./model"

/** View pieces the hours card, the list and the editor share. */

type H = HtmlBuilder<Message>

export const card = (
	h: H,
	options: Readonly<{
		title: string
		description?: string
		aside?: Html | null
		/** The body runs edge to edge (a list): only the header is padded. */
		isFlush?: boolean
	}>,
	children: ReadonlyArray<Html>,
): Html =>
	h.section(
		[
			h.AriaLabel(options.title),
			h.Class(
				cardClassName(
					options.isFlush ? "flex min-w-0 flex-col" : "flex min-w-0 flex-col gap-4 p-4 sm:p-5",
				),
			),
		],
		[
			panelHeader(h, {
				title: options.title,
				description: options.description,
				aside: options.aside ?? undefined,
				className: options.isFlush ? "p-4 sm:p-5" : undefined,
			}),
			...children,
		],
	)

export const fieldLabel = (h: H, text: string, forId?: string): Html =>
	forId === undefined
		? Field.label(h, { elementType: "span" }, [text])
		: Field.label(h, { htmlFor: forId }, [text])

export const field = (h: H, children: ReadonlyArray<Html>, className?: string): Html =>
	h.div([h.Class(twMerge("flex min-w-0 flex-col gap-1.5", className))], [...children])

export const help = (h: H, text: string): Html => h.p([h.Class("text-muted-fg text-xs")], [text])

export const errorText = (h: H, id: string, error: string | undefined): ReadonlyArray<Html> =>
	error === undefined
		? []
		: [h.p([h.Id(id), h.Role("alert"), h.Class("text-danger-subtle-fg text-xs")], [error])]

/** One of the page's Selects (`Model.selects`). */
export const selectField = (
	h: H,
	model: Model,
	options: Readonly<{
		id: string
		items: ReadonlyArray<Select.Item>
		ariaLabel: string
		triggerClassName?: string
		/** The Select root (layout only). */
		className?: string
	}>,
): Html => {
	const select = model.selects[options.id] ?? Select.init({ id: options.id })
	return h.submodel({
		slotId: options.id,
		model: select,
		view: selectView,
		viewInputs: {
			items: options.items,
			ariaLabel: options.ariaLabel,
			triggerClassName: options.triggerClassName,
			className: options.className,
		},
		toParentMessage: (message: Select.Message) =>
			Message.GotSelectMessage({ selectId: options.id, message }),
	})
}

/** A chosen value as a chip, with a remove button for admins. */
export const removableChip = (h: H, options: Readonly<{ label: string; onRemove: Message | null }>): Html =>
	badge(h, { intent: "secondary", className: "max-w-full gap-1 pe-1" }, [
		h.span([h.Class("truncate")], [options.label]),
		...(options.onRemove === null
			? []
			: [
					iconButton(
						h,
						{
							size: "sq-xs",
							className: "size-5 sm:size-5",
							label: `Remove ${options.label}`,
							onPress: options.onRemove,
						},
						IconClose(h, { attributes: { "data-slot": "icon" } }),
					),
				]),
	])
