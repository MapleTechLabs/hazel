// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, test } from "vitest"
import { OpenModal } from "../../../../app/requests"
import { adaId, bot, button, byProp, session } from "../../../integrations/test-support"
import { YourAppsMessage, YourAppsPage } from "./YourAppsPage"

/** `/:org/settings/integrations/your-apps`: the user's bots and their actions, each a modal. */

const BOTS = `myBots:"${adaId}"`
const triage = bot(4, { name: "Triage", isPublic: true })
const menu = byProp("menu", "label", "Bot actions")

const loaded = () =>
	Scene.start(YourAppsPage, { session }).subscription(BOTS, YourAppsMessage.UpdatedBots({ bots: [triage] }))

describe("your apps page", () => {
	test("lists the user's bots, a public one marked", () => {
		loaded()
			.expect(Locator.text("Triage", { exact: true }))
			.toExist()
			.expect(byProp("badge", "label", "Public"))
			.toExist()
	})

	test("each menu entry opens its modal for the bot", () => {
		loaded()
			.fire(menu, "select", { id: "regenerate" })
			.expectExact(
				OpenModal.make({
					modal: { _tag: "RegenerateBotToken", botId: triage.id, botName: "Triage" },
				}),
			)
			.resolve(OpenModal, Component.noop)
			.fire(menu, "select", { id: "delete" })
			.expectExact(
				OpenModal.make({ modal: { _tag: "DeleteBot", botId: triage.id, botName: "Triage" } }),
			)
			.resolve(OpenModal, Component.noop)
			.fire(menu, "select", { id: "edit" })
			.expectExact(
				OpenModal.make({
					modal: {
						_tag: "EditBot",
						id: triage.id,
						name: "Triage",
						description: triage.description,
						isPublic: true,
						scopes: triage.scopes,
						allowedIntegrations: [],
						installRedirectUris: [],
						avatarUrl: null,
					},
				}),
			)
			.resolve(OpenModal, Component.noop)
	})

	test("with none, it offers to create one", () => {
		Scene.start(YourAppsPage, { session })
			.subscription(BOTS, YourAppsMessage.UpdatedBots({ bots: [] }))
			.expect(byProp("emptyState", "title", "No applications yet"))
			.toExist()
			.fire(Locator.inside(Locator.tag("hz:emptyState"), button("Create application")), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "CreateBot" } }))
			.resolve(OpenModal, Component.noop)
	})
})
