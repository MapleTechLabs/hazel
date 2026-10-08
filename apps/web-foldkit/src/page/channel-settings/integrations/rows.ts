import { Array, Option } from "effect"
import { modifyFields } from "foldkit/struct"
import * as Menu from "../../../ui/menu"
import { type Model, type RowKind, rowMenuId } from "./model"

/** Each row's `<Menu>` entries; the toggle item is disabled while its request runs (`isToggling`). */
export const rowEntries = (kind: RowKind, isToggling: boolean): ReadonlyArray<Menu.Entry> => [
	...(kind === "github" ? [Menu.item("edit")] : []),
	Menu.item("toggle", { isDisabled: isToggling }),
	Menu.separator,
	Menu.item("remove", { intent: "Danger" }),
]

const rowKeys = (model: Model): ReadonlyArray<readonly [RowKind, string]> => [
	...model.webhooks.items
		.filter((webhook) => webhook.name !== "OpenStatus" && webhook.name !== "Railway")
		.map((webhook) => ["webhook", webhook.id] as const),
	...model.rss.items.map((feed) => ["rss", feed.id] as const),
	...model.github.items.map((repo) => ["github", repo.id] as const),
]

/** One menu per listed row; a menu whose row is still listed keeps its state. */
export const reflectRowMenus = (model: Model): Model =>
	modifyFields(model, {
		rowMenus: (menus) =>
			rowKeys(model).map(([kind, id]) => {
				const menuId = rowMenuId(kind, id)
				const entries = rowEntries(kind, model.togglingRowIds.includes(id))
				return Option.match(
					Array.findFirst(menus, (menu) => menu.id === menuId),
					{
						onNone: () => Menu.init({ id: menuId, entries, placement: "bottom end" }),
						onSome: (menu) => Menu.reflectEntries(menu, entries),
					},
				)
			}),
	})
