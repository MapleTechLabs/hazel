// @vitest-environment jsdom
import { routeOfPath } from "../../../../route"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, organizationId, pageScene } from "../../../../test/pages-fixtures"
import { bot, botId } from "../../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../../out-message"
import { reasonToast, successToast } from "../../../../data/actions"
import { Message } from "./message"
import { init, UninstallBot, update } from "./update"
import { view } from "./view"

/** Installed apps through the view: loading, the empty on-ramp and uninstalling. */

const config = pageScene(update, view, makeShared())
const confirm = Scene.role("button", { name: "Confirm uninstall Deploy Bot" })
const initial = init({ _tag: "SettingsIntegrationsInstalled", orgSlug: "hazel" }).model

describe("installed apps", () => {
	test("the list waits for the live query, then shows the empty state", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(Scene.text("No installed applications")).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedBots({ bots: [] })),
			Scene.expect(Scene.text("No installed applications")).toExist(),
			Scene.click(Scene.role("button", { name: "Browse marketplace" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/integrations/marketplace"),
					replace: false,
				}),
			),
		)
	})

	test("Install by ID opens the install modal", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.click(Scene.role("button", { name: /Install by ID$/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "InstallBotById" } })),
		)
	})

	test("Uninstall uninstalls the bot and toasts success", () => {
		Scene.scene(
			config,
			Scene.given({ ...initial, bots: [bot] }),
			Scene.expect(Scene.text("Deploy Bot")).toExist(),
			Scene.click(Scene.role("button", { name: "Uninstall" })),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Uninstall Deploy Bot?")).toExist(),
			Scene.click(confirm),
			Scene.Command.expectExact(UninstallBot({ botId, organizationId })),
			Scene.Command.resolve(UninstallBot, Message.SucceededUninstallBot({ botId: bot.id })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: successToast("Application uninstalled successfully"),
				}),
			),
			Scene.Subscription.emit(Message.UpdatedBots({ bots: [] })),
			Scene.expect(Scene.text("Deploy Bot")).toBeAbsent(),
		)
	})

	test("a failed uninstall toasts and keeps the card", () => {
		Scene.scene(
			config,
			Scene.given({ ...initial, bots: [bot] }),
			Scene.click(Scene.role("button", { name: "Uninstall" })),
			Scene.click(confirm),
			Scene.Command.resolve(
				UninstallBot,
				Message.FailedUninstallBot({ botId: bot.id, reason: "Unavailable" }),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Unavailable") })),
			Scene.expect(Scene.text("Deploy Bot")).toExist(),
		)
	})

	test("Cancel backs out without uninstalling", () => {
		Scene.scene(
			config,
			Scene.given({ ...initial, bots: [bot] }),
			Scene.click(Scene.role("button", { name: "Uninstall" })),
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Uninstall Deploy Bot?")).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Uninstall" })).toBeEnabled(),
		)
	})

	test("the button is pending and disabled while the uninstall runs", () => {
		Scene.scene(
			config,
			Scene.given({ ...initial, bots: [bot] }),
			Scene.click(Scene.role("button", { name: "Uninstall" })),
			Scene.click(confirm),
			Scene.Command.expectExact(UninstallBot({ botId: bot.id, organizationId })),
			Scene.expect(Scene.role("button", { name: "Uninstalling..." })).toBeDisabled(),
			Scene.Command.resolve(UninstallBot, Message.SucceededUninstallBot({ botId: bot.id })),
		)
	})
})
