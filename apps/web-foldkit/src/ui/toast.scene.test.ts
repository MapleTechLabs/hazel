// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import * as Toaster from "../overlay/toaster"
import { leaveToast } from "../test/toast-fixtures"

/** The root toaster through its view: the live region, a toast's card, its action and dismissal. */

type Model = Toaster.Model
type Message = Toaster.Message

const config = {
	// The root carries out a clicked action; here it surfaces as the OutMessage.
	update: (model: Model, message: Message) => {
		const result = Toaster.update(model, message)
		return { model: result.model, commands: result.commands ?? [], outMessage: result.action }
	},
	view: (model: Model, h: HtmlBuilder<Message>) => Toaster.view(h, model, (message) => message),
}

const region = Scene.role("region", { name: "Notifications" })
const withToast = (request: Toaster.ToastRequest): Model => Toaster.push(Toaster.init(), request).model

describe("toaster scene", () => {
	test("an empty toaster is a polite live region", () => {
		Scene.scene(
			config,
			Scene.given(Toaster.init()),
			Scene.expect(region).toHaveAttr("aria-live", "polite"),
			Scene.expect(region).toBeEmpty(),
		)
	})

	test("a toast shows its title, description and kind, entering from closed", () => {
		Scene.scene(
			config,
			Scene.given(
				withToast({
					intent: "success",
					title: "Invitation sent",
					description: "ada@hazel.sh will get an email.",
				}),
			),
			Scene.expect(Scene.role("status")).toHaveAttr("data-closed", ""),
			Scene.expect(Scene.text("Invitation sent")).toExist(),
			Scene.expect(Scene.text("ada@hazel.sh will get an email.")).toExist(),
			Scene.expect(Scene.selector("[data-kind]")).toHaveAttr("data-kind", "success"),
		)
	})

	test("an error toast is an alert", () => {
		Scene.scene(
			config,
			Scene.given(withToast({ intent: "error", title: "Failed", description: null })),
			Scene.expect(Scene.role("alert")).toHaveText(/Failed/),
		)
	})

	test("the action button reports its action and dismisses the toast", () => {
		Scene.scene(
			config,
			Scene.given(
				withToast({
					intent: "info",
					title: "Update available",
					description: null,
					isSticky: true,
					action: { label: "Install & Restart", key: "InstallUpdate" },
				}),
			),
			Scene.click(Scene.role("button", { name: "Install & Restart" })),
			Scene.expectOutMessage("InstallUpdate"),
			leaveToast(),
			Scene.expect(Scene.text("Update available")).toBeAbsent(),
		)
	})

	test("the close button dismisses a sticky toast", () => {
		Scene.scene(
			config,
			Scene.given(withToast({ intent: "loading", title: "Installing update...", description: null })),
			Scene.click(Scene.role("button", { name: "Dismiss notification" })),
			leaveToast(),
			Scene.expect(Scene.text("Installing update...")).toBeAbsent(),
		)
	})
})
