import type { BotId } from "@hazel/schema"
import { Array, Option } from "effect"
import { Command } from "foldkit"
import * as Menu from "../../../../ui/menu"
import type { PageReturn } from "../../../contract"
import { BOT_MENU_ENTRIES, botMenuId } from "../shared/bot-card"
import type { Bot } from "../shared/bots"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

export const init = (): Return => ({ model: { bots: null, menus: [] } })

/** Keeps each bot's menu state across live query updates; new bots get a closed menu. */
const menusFor = (bots: ReadonlyArray<Bot>, previous: ReadonlyArray<Menu.Model>): ReadonlyArray<Menu.Model> =>
	bots.map((bot) =>
		Option.getOrElse(
			Array.findFirst(previous, (menu) => menu.id === botMenuId(bot.id)),
			() => Menu.init({ id: botMenuId(bot.id), entries: BOT_MENU_ENTRIES, placement: "bottom end" }),
		),
	)

/**
 * Folds one bot's menu by id. Edit, Regenerate Token and Delete open root-owned modals that have
 * no ModalRequest variant yet, so a selection only closes the menu.
 */
const foldMenu = (model: Model, botId: BotId, message: Menu.Message): Return =>
	Option.match(
		Array.findFirst(model.menus, (menu) => menu.id === botMenuId(botId)),
		{
			onNone: () => ({ model }),
			onSome: (menu) => {
				const result = Menu.update(menu, message)
				return {
					model: {
						...model,
						menus: model.menus.map((other) => (other.id === menu.id ? result.model : other)),
					},
					commands: Command.mapMessages(result.commands ?? [], (menuMessage) =>
						Message.GotMenuMessage({ botId, message: menuMessage }),
					),
				}
			},
		},
	)

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedBots: ({ bots }) => ({ model: { ...model, bots, menus: menusFor(bots, model.menus) } }),
		GotMenuMessage: ({ botId, message: menuMessage }) => foldMenu(model, botId, menuMessage),
	})
