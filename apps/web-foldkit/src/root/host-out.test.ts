// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { combo } from "~/lib/keybindings/key-combo"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { PageOutMessage } from "../page/out-message"
import { AppRoute } from "../route"
import { callsOf, hostRequestsOf, namesOf, navigationsOf, shellSignedIn } from "../test/root-fixtures"
import { hostContextOf, keysOf, update } from "./logic"
import { AppMessage } from "./message"

/** What the shell does with the Foldkit host's requests, and the keys and buttons it hands the host. */

const fromHost = (outMessage: PageOutMessage) =>
	update(shellSignedIn("/hazel/chat"), AppMessage.ReceivedHostOut({ out: { _tag: "Page", outMessage } }))

const info = { intent: "info", title: "Saved", description: null } as const

describe("navigation", () => {
	test("a page's navigation pushes its route, or replaces the entry", () => {
		const route = AppRoute.SettingsInvitations({ orgSlug: "hazel" })
		expect(
			navigationsOf(fromHost(PageOutMessage.RequestedNavigation({ route, replace: false })).commands),
		).toEqual(["push /hazel/settings/invitations"])
		expect(
			navigationsOf(fromHost(PageOutMessage.RequestedNavigation({ route, replace: true })).commands),
		).toEqual(["replace /hazel/settings/invitations"])
	})

	test("a navigation's toast shows with it", () => {
		const route = AppRoute.SettingsInvitations({ orgSlug: "hazel" })
		const result = fromHost(PageOutMessage.RequestedNavigation({ route, replace: false, toast: info }))
		expect(hostRequestsOf(result.commands)).toEqual([{ _tag: "RequestedToast", toast: info }])
		expect(navigationsOf(result.commands)).toEqual(["push /hazel/settings/invitations"])
	})

	test("Mod+[ and Mod+] go back and forward in the history", () => {
		const back = namesOf(fromHost(PageOutMessage.RequestedHistory({ direction: "Back" })).commands)
		const forward = namesOf(fromHost(PageOutMessage.RequestedHistory({ direction: "Forward" })).commands)
		expect(back).toEqual(["@effect/ui/Router/Back"])
		expect(forward).toEqual(["@effect/ui/Router/Forward"])
	})
})

describe("sign-out", () => {
	test("Log out signs out, then loads `/` afresh", () => {
		const result = fromHost(PageOutMessage.RequestedSignOut())
		expect(namesOf(result.commands)).toEqual(["shell/SignOut"])
		expect(callsOf(update(result.model, AppMessage.SucceededSignOut()).commands)).toEqual([
			{ name: "LoadExternal", args: { href: "/" } },
		])
	})

	test("a failed sign-out keeps the app up and says so", () => {
		const result = update(shellSignedIn("/hazel/chat"), AppMessage.FailedSignOut({ reason: "Offline" }))
		expect(result.model.session._tag).toBe("SignedIn")
		expect(hostRequestsOf(result.commands)).toMatchObject([
			{ _tag: "RequestedToast", toast: { intent: "error", title: "Failed to sign out" } },
		])
	})
})

describe("settings the shell stores", () => {
	test("the notifications page's sound toggle is stored and shared back", () => {
		const off = { ...DEFAULT_SOUND_SETTINGS, enabled: false }
		const result = fromHost(PageOutMessage.RequestedSoundSettings({ settings: off }))
		expect(callsOf(result.commands)).toEqual([{ name: "SaveSoundSettings", args: { settings: off } }])
		expect(hostContextOf(result.model).soundSettings).toEqual(off)
	})

	test("the Keybinds page's new key is stored and rebinds the hotkeys", () => {
		const overrides = { "inbox.open": combo("Mod+Shift+J") }
		const result = fromHost(PageOutMessage.RequestedKeybindings({ overrides }))
		expect(callsOf(result.commands)).toEqual([{ name: "SaveKeybindings", args: { overrides } }])
		expect(hostContextOf(result.model).keybindingOverrides).toEqual(overrides)
		expect(keysOf(result.model)["inbox.open"]).toBe("Mod+Shift+J")
	})
})

describe("toasts and the current user", () => {
	test("a page's toast goes back to the host's toaster", () => {
		expect(hostRequestsOf(fromHost(PageOutMessage.RequestedToast({ toast: info })).commands)).toEqual([
			{ _tag: "RequestedToast", toast: info },
		])
	})

	test("a page's refresh asks user.me again, keeping the user on screen", () => {
		const result = fromHost(PageOutMessage.RequestedCurrentUserRefresh({}))
		expect(callsOf(result.commands)).toEqual([
			{ name: "shell/FetchCurrentUser", args: { delayed: false } },
		])
		expect(hostContextOf(result.model).currentUser).not.toBeNull()
	})
})

describe("what the shell hands the host", () => {
	test("every layout hotkey, desktop menu item and frame button", () => {
		const signed = shellSignedIn("/hazel/chat")
		const requestOf = (message: AppMessage) => hostRequestsOf(update(signed, message).commands)
		expect(requestOf(AppMessage.PressedHotkey({ actionId: "inbox.open" }))).toEqual([
			{ _tag: "PressedHotkey", actionId: "inbox.open" },
		])
		expect(requestOf(AppMessage.PressedDesktopMenuItem({ item: "CheckForUpdates" }))).toEqual([
			{ _tag: "PressedDesktopMenuItem", item: "CheckForUpdates" },
		])
		expect(requestOf(AppMessage.PressedMobileMenu())).toEqual([{ _tag: "PressedMobileMenu" }])
		expect(requestOf(AppMessage.PressedAiPanelToggle())).toEqual([{ _tag: "PressedAiPanelToggle" }])
	})
})
