// @vitest-environment jsdom
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import * as Toaster from "../overlay/toaster"
import * as Updates from "../platform/updates"
import { navigation, signedIn } from "../test/root-fixtures"
import { Message } from "./message"
import { update } from "./update"

/** The desktop app's update toast and menu, in the Foldkit host (the shell forwards the menu's items). */

const menuItem = (item: "CheckForUpdates" | "OpenSettings") =>
	Message.ReceivedShellRequest({ request: { _tag: "PressedDesktopMenuItem", item } })

const found = Message.GotUpdatesMessage({
	message: Updates.Message.FoundUpdate({ version: "1.2.0", body: "Faster sync" }),
})

describe("desktop updates", () => {
	test("an available update shows a sticky toast whose button installs it", () => {
		const available = update(signedIn("/hazel/chat"), found).model
		const toast = available.toasts.entries.find(
			(entry) => entry.payload.title === "Update available: v1.2.0",
		)
		expect(toast?.payload.maybeAction).toEqual(
			Option.some({ label: "Install & Restart", key: "InstallUpdate" }),
		)
		expect(toast?.maybeDuration).toEqual(Option.none())

		const clicked = update(
			available,
			Message.GotToastsMessage({
				message: Toaster.Message.ClickedAction({ entryId: toast!.id, action: "InstallUpdate" }),
			}),
		)
		expect(clicked.model.desktopUpdate._tag).toBe("Downloading")
		// The clicked toast leaves; the download progress shows as a new loading toast.
		expect(clicked.model.toasts.entries.map((entry) => entry.payload.kind)).toEqual(["info", "loading"])
	})

	test("the menu's Check for Updates starts a check", () => {
		const result = update(signedIn("/hazel/chat"), menuItem("CheckForUpdates"))
		expect(result.model.desktopUpdate._tag).toBe("Checking")
		expect(result.commands?.map((command) => command.name)).toContain(Updates.CheckForUpdate.name)
	})

	test("the menu's Settings opens the desktop settings page", () => {
		const result = update(signedIn("/hazel/chat"), menuItem("OpenSettings"))
		expect(result.commands?.map((command) => command.args)).toContainEqual(
			navigation("/hazel/my-settings/desktop").args,
		)
	})
})
