import { Array, Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import * as Menu from "../../../ui/menu"
import type { PageReturn } from "../../contract"
import { ListGitHub, ListRss, ListWebhooks } from "./command"
import type { Message } from "./message"
import { itemsOf, type Model, type RowKind, rowMenuId } from "./model"

/** Each row's `<Menu>` entries; the toggle item is disabled while its request runs (`isToggling`). */
export const rowEntries = (kind: RowKind, isToggling: boolean): ReadonlyArray<Menu.Entry> => [
	...(kind === "github" ? [Menu.item("edit")] : []),
	Menu.item("toggle", { isDisabled: isToggling }),
	Menu.separator,
	Menu.item("remove", { intent: "Danger" }),
]

const rowKeys = (model: Model): ReadonlyArray<readonly [RowKind, string]> => [
	...itemsOf(model.webhooks)
		.filter((webhook) => webhook.name !== "OpenStatus" && webhook.name !== "Railway")
		.map((webhook) => ["webhook", webhook.id] as const),
	...itemsOf(model.rss).map((feed) => ["rss", feed.id] as const),
	...itemsOf(model.github).map((repo) => ["github", repo.id] as const),
]

/** One menu per listed row; a menu whose row is still listed keeps its state. */
export const reflectRowMenus = (model: Model): Model =>
	modifyFields(model, {
		rowMenus: (menus) =>
			rowKeys(model).map(([kind, id]) => {
				const menuId = rowMenuId(kind, id)
				return Option.getOrElse(
					Array.findFirst(menus, (menu) => menu.id === menuId),
					() => Menu.init({ id: menuId, placement: "bottom end" }),
				)
			}),
	})

/** Loading, or refreshing the rows it has: a reload never blanks a loaded list. */
const reloading = <A, E>(data: AsyncData.AsyncData<A, E>): AsyncData.AsyncData<A, E> =>
	Option.getOrElse(AsyncData.revalidateOrLoad(data), () => data)

/** Each reload bumps the list's version, so only the latest response lands. */
export const reload = (model: Model, kind: RowKind): PageReturn<Model, Message> => {
	const { channelId } = model
	if (kind === "webhook") {
		const version = model.webhooks.version + 1
		return {
			model: modifyFields(model, { webhooks: (list) => ({ version, data: reloading(list.data) }) }),
			commands: [ListWebhooks({ channelId, version })],
		}
	}
	if (kind === "rss") {
		const version = model.rss.version + 1
		return {
			model: modifyFields(model, { rss: (list) => ({ version, data: reloading(list.data) }) }),
			commands: [ListRss({ channelId, version })],
		}
	}
	const version = model.github.version + 1
	return {
		model: modifyFields(model, { github: (list) => ({ version, data: reloading(list.data) }) }),
		commands: [ListGitHub({ channelId, version })],
	}
}
