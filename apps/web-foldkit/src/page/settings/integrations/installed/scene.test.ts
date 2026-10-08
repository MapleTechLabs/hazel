// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { failureToastFixture, makeShared, pageScene } from "../../../../test/pages-fixtures"
import { bot, botId } from "../../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../../out-message"
import { successToast } from "../shared/exit-toast"
import { Message } from "./message"
import { init, UninstallBot, update } from "./update"
import { view } from "./view"

/** Installed apps through the view: loading, the empty on-ramp and uninstalling. */

const config = pageScene(update, view, makeShared())
const initial = init({ _tag: "SettingsIntegrationsInstalled", orgSlug: "hazel" }).model

describe("installed apps", () => {
	test("the list waits for the live query, then shows the empty state", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(Scene.text("No installed applications")).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedBots({ bots: [] })),
			Scene.expect(Scene.text("No installed applications")).toExist(),
			Scene.click(Scene.role("button", { name: "Browse Marketplace" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: "/hazel/settings/integrations/marketplace", replace: false }),
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
			Scene.Command.expectExact(UninstallBot({ botId })),
			Scene.Command.resolve(UninstallBot, Message.SucceededUninstallBot()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Application uninstalled successfully") }),
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
			Scene.Command.resolve(UninstallBot, Message.FailedUninstallBot({ toast: failureToastFixture })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(Scene.text("Deploy Bot")).toExist(),
		)
	})

	// Bug: Uninstall has no pending state or guard, so a second click while the first runs uninstalls again.
	test.fails("Uninstall disables while the uninstall runs", () => {
		Scene.scene(
			config,
			Scene.given({ ...initial, bots: [bot] }),
			Scene.click(Scene.role("button", { name: "Uninstall" })),
			Scene.expect(Scene.role("button", { name: /Uninstall/ })).toBeDisabled(),
			Scene.Command.resolve(UninstallBot, Message.SucceededUninstallBot()),
		)
	})
})
