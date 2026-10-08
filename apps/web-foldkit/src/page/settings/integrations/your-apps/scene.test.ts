// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Menu from "../../../../ui/menu"
import { FocusTriggerOnPress } from "../../../../ui/menu-view"
import { makeShared, pageScene } from "../../../../test/pages-fixtures"
import { bot, botId } from "../../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../../out-message"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** Your apps through the view: the empty on-ramp and each bot's actions menu. */

const config = pageScene(update, view, makeShared())
const loaded = update(init().model, Message.UpdatedBots({ bots: [bot] })).model
const menuTrigger = Scene.role("button", { name: "Bot actions" })
const triggerMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
/** The open menu's popover (not exported by ui/menu-view, so named here). */
const menuMounted = Scene.Mount.resolve({ name: "PortalMenu" }, Menu.Message.CompletedPortalMenu())

// A fresh step per scene: a shared `Mount.expectEnded` value only acknowledged in the first scene.
const menuClosed = () => Scene.Mount.expectEnded({ name: "PortalMenu" })
const openMenu = [triggerMounted, Scene.keydown(menuTrigger, "Enter"), Scene.expectHandled(), menuMounted]

describe("your apps", () => {
	test("the empty state offers Create Application", () => {
		Scene.scene(
			config,
			Scene.given(init().model),
			Scene.Subscription.emit(Message.UpdatedBots({ bots: [] })),
			Scene.expect(Scene.text("No applications yet")).toExist(),
			Scene.click(Scene.role("button", { name: /Create Application$/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "CreateBot" } })),
		)
	})

	test("Edit opens the edit modal with the bot's current settings", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			...openMenu,
			Scene.click(Scene.role("menuitem", { name: /Edit/ })),
			menuClosed(),
			Scene.expectOutMessage(
				PageOutMessage.RequestedModal({
					modal: {
						_tag: "EditBot",
						id: botId,
						name: bot.name,
						description: bot.description,
						isPublic: bot.isPublic,
						scopes: bot.scopes,
						allowedIntegrations: bot.allowedIntegrations,
						avatarUrl: bot.avatarUrl,
					},
				}),
			),
		)
	})

	test("Delete asks for confirmation in the delete modal", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			...openMenu,
			Scene.click(Scene.role("menuitem", { name: /Delete/ })),
			menuClosed(),
			Scene.expect(Scene.role("menu")).toBeAbsent(),
			Scene.expectOutMessage(
				PageOutMessage.RequestedModal({ modal: { _tag: "DeleteBot", botId, botName: bot.name } }),
			),
		)
	})
})
