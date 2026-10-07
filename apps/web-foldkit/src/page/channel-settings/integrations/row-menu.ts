import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconCirclePause, IconDotsVertical, IconEdit, IconPlay, IconTrash } from "../../../icons"
import { button } from "../../../ui/button"
import type * as Menu from "../../../ui/menu"
import { menuLabel, view as menuView } from "../../../ui/menu-view"
import { Message } from "./message"
import type { RowKind } from "./model"

/** The rows' `<Menu><Button intent="plain" size="sq-xs" />` and its items. */
export const rowMenu = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		kind: RowKind
		id: string
		menu: Menu.Model | undefined
		isEnabled: boolean
		triggerClassName: string
		labels: Readonly<{ enable: string; disable: string; remove: string }>
	}>,
): Html => {
	const { menu } = options
	if (menu === undefined) return null
	const label = (key: string, text: string) => menuLabel(h, menu.id, key, text)
	const content = (key: string): ReadonlyArray<Html> => {
		if (key === "edit") return [IconEdit(h, { className: "size-4" }), label(key, "Edit")]
		if (key === "toggle")
			return options.kind === "webhook"
				? [label(key, options.isEnabled ? options.labels.disable : options.labels.enable)]
				: [
						options.isEnabled
							? IconCirclePause(h, { className: "size-4" })
							: IconPlay(h, { className: "size-4" }),
						label(key, options.isEnabled ? options.labels.disable : options.labels.enable),
					]
		return [IconTrash(h, { className: "size-4" }), label(key, options.labels.remove)]
	}
	return h.submodel({
		slotId: menu.id,
		model: menu,
		view: menuView,
		viewInputs: {
			toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
				button(
					h,
					{ intent: "plain", size: "sq-xs", className: options.triggerClassName, attributes },
					[IconDotsVertical(h, { className: "size-4" }), overlay],
				),
			content,
		},
		toParentMessage: (message: Menu.Message) =>
			Message.GotRowMenuMessage({ kind: options.kind, id: options.id, message }),
	})
}
