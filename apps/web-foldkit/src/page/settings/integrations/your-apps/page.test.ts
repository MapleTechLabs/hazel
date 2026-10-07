// @vitest-environment jsdom
import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Menu from "../../../../ui/menu"
import type { Bot } from "../shared/bots"
import { Message } from "./message"
import { init, update } from "./update"

const bot = (n: number, name: string): Bot => ({
	id: Schema.decodeSync(BotId)(`00000000-0000-4000-8000-00000000000${n}`),
	name,
	description: null,
	isPublic: false,
	scopes: [],
	allowedIntegrations: [],
	avatarUrl: null,
	installCount: 0,
})
const deploy = bot(1, "Deploy Bot")
const triage = bot(2, "Triage Assistant")

/** Deploy Bot loaded with its menu opened by a pointer press. */
const loaded = update(init().model, Message.UpdatedBots({ bots: [deploy] })).model
const withOpenMenu = {
	...loaded,
	menus: loaded.menus.map(
		(menu) => Menu.update(menu, Menu.Message.PressedTrigger({ pointerType: "mouse" })).model,
	),
}

describe("your apps page", () => {
	test("each bot's menu keeps its state across live query updates", () => {
		story(
			update,
			given(withOpenMenu),
			message(Message.UpdatedBots({ bots: [triage, deploy] })),
			model((current) => {
				expect(current.menus.map((menu) => menu.id)).toEqual([
					`bot-actions-${triage.id}`,
					`bot-actions-${deploy.id}`,
				])
				expect(current.menus.map((menu) => menu.popup._tag)).toEqual(["Closed", "Open"])
			}),
		)
	})
})
