// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../../../app/requests"
import { button, byProp, orgId, publicBot, session } from "../../../integrations/test-support"
import { InstallBot, MarketplaceMessage, MarketplacePageNoDeps } from "./MarketplacePage"

/** `/:org/settings/integrations/marketplace`: the public bots, searched and installed. */

const PUBLIC = "publicBots:"
const INSTALLED = `installed:"${orgId}"`
const standup = publicBot(1, { name: "Standup", description: "Async standups.", installCount: 1284 })
const polls = publicBot(2, { name: "Polls", description: null })

const loaded = () =>
	Scene.start(MarketplacePageNoDeps, { session })
		.subscription(PUBLIC, MarketplaceMessage.UpdatedBots({ bots: [standup, polls] }))
		.subscription(INSTALLED, MarketplaceMessage.UpdatedInstalled({ botIds: [standup.id] }))

const search = (text: string, rev: number) => ({ value: text, rev, edit: 0 })

describe("marketplace page", () => {
	test("lists the public bots; an installed one says so", () => {
		const s = loaded()
			.expect(Locator.text("by Grace Hopper"))
			.toExist()
			.expect(Locator.text("No description provided"))
			.toExist()
			.expect(Locator.text("1,284"))
			.toExist()
		expect(s.get(button("Installed")).props).toMatchObject({ disabled: true })
	})

	test("searches by name or description", () => {
		loaded()
			.fire(Locator.tag("hz:searchField"), "change", search("standups", 1))
			.expect(Locator.text("Polls", { exact: true }))
			.toBeAbsent()
			.fire(Locator.tag("hz:searchField"), "change", search("nothing", 2))
			.expect(byProp("emptyState", "description", "Try a different search term"))
			.toExist()
	})

	test("installs a bot and says so; a failure names the reason", () => {
		const s = loaded()
			.fire(button("Install"), "press")
			.expectExact(InstallBot.make({ botId: polls.id, organizationId: orgId }))
		expect(s.get(button("Installing...")).props).toMatchObject({ disabled: true })
		s.resolve(InstallBot, MarketplaceMessage.SucceededInstall({ botId: polls.id }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Application installed successfully",
						description: null,
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
			.fire(button("Install"), "press")
			.resolve(InstallBot, MarketplaceMessage.FailedInstall({ botId: polls.id, reason: "Offline" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})
