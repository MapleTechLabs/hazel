// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { Navigate, OpenModal, ShowToast } from "../../../../app/requests"
import { bot, button, byProp, orgId, session } from "../../../integrations/test-support"
import { InstalledAppsMessage, InstalledAppsPageNoDeps, UninstallBot } from "./InstalledAppsPage"

/** `/:org/settings/integrations/installed`: the workspace's bots, each uninstalled after a confirm. */

const BOTS = `installedBots:"${orgId}"`
const standup = bot(1, { name: "Standup", isPublic: true })
const start = () => Scene.start(InstalledAppsPageNoDeps, { orgSlug: "hazel", session })

describe("installed apps page", () => {
	test("waits for its bots, then lists them", () => {
		const s = start()
		s.expect(byProp("progress", "label", "Loading...")).toExist()
		s.subscription(BOTS, InstalledAppsMessage.UpdatedBots({ bots: [standup] }))
			.expect(Locator.text("Standup", { exact: true }))
			.toExist()
			.expect(byProp("badge", "label", "Messages · Read, Write"))
			.toExist()
	})

	test("uninstalls after a confirm, and says so", () => {
		const s = start()
			.subscription(BOTS, InstalledAppsMessage.UpdatedBots({ bots: [standup] }))
			.fire(button("Uninstall"), "press")
			.expect(Locator.text("Uninstall Standup?"))
			.toExist()
			.fire(button("Cancel"), "press")
			.expect(Locator.text("Uninstall Standup?"))
			.toBeAbsent()
			.fire(button("Uninstall"), "press")
			.fire(byProp("button", "variant", "danger"), "press")
			.expectExact(UninstallBot.make({ botId: standup.id, organizationId: orgId }))
		expect(s.get(button("Uninstalling...")).props).toMatchObject({ loading: true, disabled: true })
		s.resolve(UninstallBot, InstalledAppsMessage.SucceededUninstall({ botId: standup.id }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Application uninstalled successfully",
						description: null,
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
			.expect(button("Uninstall"))
			.toExist()
	})

	test("a failed uninstall names the reason", () => {
		start()
			.subscription(BOTS, InstalledAppsMessage.UpdatedBots({ bots: [standup] }))
			.fire(button("Uninstall"), "press")
			.fire(byProp("button", "variant", "danger"), "press")
			.resolve(
				UninstallBot,
				InstalledAppsMessage.FailedUninstall({ botId: standup.id, reason: "NotFound" }),
			)
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Application not found",
						description: "This application may have already been uninstalled.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("with none, it points to the Marketplace; Install by ID opens its modal", () => {
		start()
			.subscription(BOTS, InstalledAppsMessage.UpdatedBots({ bots: [] }))
			.expect(byProp("emptyState", "title", "No installed applications"))
			.toExist()
			.fire(button("Browse marketplace"), "press")
			.expectExact(Navigate.make({ href: "/hazel/settings/integrations/marketplace", replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(button("Install by ID"), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "InstallBotById" } }))
			.resolve(OpenModal, Component.noop)
	})
})
