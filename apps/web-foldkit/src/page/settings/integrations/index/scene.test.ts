// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, pageScene } from "../../../../test/pages-fixtures"
import { PageOutMessage } from "../../../out-message"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** The integrations catalog through its view: connection status, categories and opening an integration. */

const route = { _tag: "SettingsIntegrations", orgSlug: "hazel" } as const
const config = pageScene(update, view, makeShared())
// `given` starts from init's Model only; its webhook query is covered in story.test.ts.
const initial = init(route, makeShared()).model
const card = (name: string) => Scene.role("button", { name: new RegExp(`^${name}`) })
const linear = { provider: "linear", isActive: true, externalAccountName: "Hazel", hasInstallationId: false }

describe("integrations catalog", () => {
	test("an active connection and a webhook mark their integrations connected", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(card("Linear")).toContainText("Not connected"),
			Scene.Subscription.emit(Message.UpdatedConnections({ connections: [linear] })),
			Scene.expect(card("Linear")).not.toContainText("Not connected"),
			Scene.expect(card("Railway")).toContainText("Not connected"),
			Scene.Subscription.emit(Message.SucceededListWebhooks({ names: ["Railway"] })),
			Scene.expect(card("Railway")).not.toContainText("Not connected"),
		)
	})

	test("an inactive connection is not connected", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.Subscription.emit(Message.UpdatedConnections({ connections: [{ ...linear, isActive: false }] })),
			Scene.expect(card("Linear")).toContainText("Not connected"),
		)
	})

	test("a category narrows the catalog", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(card("Linear")).toExist(),
			Scene.click(Scene.role("button", { name: "Communication" })),
			Scene.expect(card("Discord")).toExist(),
			Scene.expect(card("Linear")).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "View all" })),
			Scene.expect(card("Linear")).toExist(),
		)
	})

	test("clicking an integration opens its page; coming soon ones are not buttons", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(card("Figma")).toBeAbsent(),
			Scene.expect(Scene.text("Figma")).toExist(),
			Scene.click(card("Linear")),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: "/hazel/settings/integrations/linear", replace: false }),
			),
		)
	})

	test("Request integration opens the request modal", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.click(Scene.role("button", { name: /Request integration$/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "RequestIntegration" } })),
		)
	})
})
