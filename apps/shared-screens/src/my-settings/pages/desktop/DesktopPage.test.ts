// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { CheckForUpdate, InstallUpdate, ShowToast } from "../../../app/requests"
import { button, byProp } from "../../../modals/test-support"
import type { DesktopUpdate } from "../../platform"
import { CheckAutostart, DesktopMessage, DesktopPageNoDeps, ReadVersion, SetAutostart } from "./DesktopPage"

/** Desktop: launch at login through the app's plugin, updates through the app. */

const idle: DesktopUpdate = { _tag: "Idle" }
const desktop = (update: DesktopUpdate = idle) =>
	Scene.start(DesktopPageNoDeps, { hasAutostart: true, hasUpdates: true, update })
const toggle = byProp("toggle", "label", "Open at login")

describe("desktop settings page", () => {
	test("a browser shows only the header", () => {
		Scene.start(DesktopPageNoDeps, { hasAutostart: false, hasUpdates: false, update: idle })
			.expectNone()
			.expect(toggle)
			.toBeAbsent()
	})

	test("the switch waits for the state, then writes it", () => {
		const s = desktop().expectExact(CheckAutostart.make({}), ReadVersion.make({}))
		expect(s.get(toggle).props?.["disabled"]).toBe(true)
		s.resolve(CheckAutostart, DesktopMessage.CheckedAutostart({ isEnabled: false }))
			.resolve(ReadVersion, DesktopMessage.ReadAppVersion({ version: "1.4.0" }))
			.expect(byProp("badge", "label", "v1.4.0"))
			.toExist()
			.fire(toggle, "change", { checked: true })
			.expectExact(SetAutostart.make({ isEnabled: true }))
			.resolve(SetAutostart, DesktopMessage.FailedSetAutostart({ isEnabled: false }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Failed to update launch at login",
						description: "Please try again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
		expect(s.get(toggle).props?.["checked"]).toBeUndefined()
	})

	test("updates: check, then install what is available", () => {
		desktop()
			.resolve(CheckAutostart, DesktopMessage.CheckedAutostart({ isEnabled: true }))
			.resolve(ReadVersion, DesktopMessage.ReadAppVersion({ version: null }))
			.fire(button("Check for updates"), "press")
			.expectExact(CheckForUpdate.make({}))
			.resolve(CheckForUpdate, Component.noop)
		desktop({ _tag: "Available", version: "1.5.0", body: "Faster sync" })
			.resolve(CheckAutostart, DesktopMessage.CheckedAutostart({ isEnabled: true }))
			.resolve(ReadVersion, DesktopMessage.ReadAppVersion({ version: "1.4.0" }))
			.expect(byProp("banner", "title", "Update available"))
			.toExist()
			.fire(button("Install & Restart"), "press")
			.expectExact(InstallUpdate.make({}))
			.resolve(InstallUpdate, Component.noop)
	})
})
