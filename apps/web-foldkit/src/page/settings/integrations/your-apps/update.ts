import type { BotId } from "@hazel/schema"
import { Array, Option } from "effect"
import { Command } from "foldkit"
import * as Menu from "../../../../ui/menu"
import type { ModalRequest } from "../../../../overlay/modal/requests"
import type { PageReturn } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
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

/** `BotCard`'s menu actions: each opens its root modal with the bot it was chosen for. */
const modalFor = (bot: Bot, key: string): ModalRequest | null =>
	key === "edit"
		? {
				_tag: "EditBot",
				id: bot.id,
				name: bot.name,
				description: bot.description,
				isPublic: bot.isPublic,
				scopes: bot.scopes,
				allowedIntegrations: bot.allowedIntegrations,
				avatarUrl: bot.avatarUrl,
			}
		: key === "regenerate"
			? { _tag: "RegenerateBotToken", botId: bot.id, botName: bot.name }
			: key === "delete"
				? { _tag: "DeleteBot", botId: bot.id, botName: bot.name }
				: null

/** Folds one bot's menu by id; a selection opens that action's modal. */
const foldMenu = (model: Model, botId: BotId, message: Menu.Message): Return =>
	Option.match(
		Array.findFirst(model.menus, (menu) => menu.id === botMenuId(botId)),
		{
			onNone: () => ({ model }),
			onSome: (menu) => {
				const result = Menu.update(menu, message)
				const bot = model.bots?.find((candidate) => candidate.id === botId)
				const selected = result.outMessage?._tag === "SelectedItem" && bot ? modalFor(bot, result.outMessage.key) : null
				return {
					...(selected === null ? {} : { outMessage: PageOutMessage.RequestedModal({ modal: selected }) }),
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
		ClickedCreateApplication: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "CreateBot" } }),
		}),
	})
