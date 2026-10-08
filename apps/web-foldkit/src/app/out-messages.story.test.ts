// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { update } from "../main"
import * as CommandPalette from "../overlay/command-palette"
import { FocusInput, SetPresenceStatus } from "../overlay/command-palette/commands"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as Shell from "../shell/model"
import * as Platform from "../platform"
import * as Presence from "../platform/presence/message"
import { AFK_TIMEOUT_MS } from "../platform/presence/model"
import { SendPresenceUpdate } from "../platform/presence/update"
import { ada, plainMember, signedIn } from "../test/root-fixtures"
import * as CommandMenu from "../ui/command-menu"
import { ApplyTheme, NavigateInternal, SaveThemePreference } from "./command"
import { Message } from "./message"

/** The facts children report (OutMessages) and what the root does with them. */

const sidebar = (inner: ChannelsSidebar.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotChannelsSidebarMessage({ message: inner }) })
const paletteItem = (key: string): Message =>
	Message.GotCommandPaletteMessage({
		message: CommandPalette.Message.GotMenuMessage({ message: CommandMenu.Message.ClickedItem({ key }) }),
	})
const focused = CommandPalette.Message.CompletedEffect()
const presence = (inner: Presence.Message): Message =>
	Message.GotPlatformMessage({ message: Platform.Message.GotPresenceMessage({ message: inner }) })

describe("RequestedCommandPalette", () => {
	test("the sidebar's Browse channels opens the palette on its home page", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(sidebar(ChannelsSidebar.Message.ClickedBrowseChannels())),
			Command.expectExact(FocusInput),
			Command.resolve(FocusInput, focused),
			model((m) => {
				expect(m.commandPalette.isOpen).toBe(true)
				expect(m.commandPalette.page._tag).toBe("Home")
			}),
		)
	})
})

describe("RequestedModal", () => {
	test("a sidebar section action opens its modal in the root slot", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(sidebar(ChannelsSidebar.Message.ClickedSectionAction({ action: "create-channel" }))),
			model((m) => expect(m.modal?._tag).toBe("NewChannel")),
		)
	})

	test("the palette closes itself before the modal opens", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("action:invite")),
			model((m) => {
				expect(m.commandPalette.isOpen).toBe(false)
				expect(m.modal?._tag).toBe("EmailInvite")
			}),
		)
	})
})

describe("RequestedTheme", () => {
	test("picking Dark in the palette applies, persists and shares the theme", () => {
		const signed = signedIn("/hazel/chat")
		const dark = { mode: "dark" as const, customization: signed.themePreference.customization }
		story(
			update,
			given(signed),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("theme:dark")),
			Command.expectExact(
				ApplyTheme({ resolved: "dark", customization: dark.customization }),
				SaveThemePreference({ preference: dark }),
			),
			Command.resolveAll(
				[ApplyTheme, Message.CompletedApplyTheme()],
				[SaveThemePreference, Message.CompletedSaveThemePreference()],
			),
			model((m) => {
				expect(m.themePreference.mode).toBe("dark")
				expect(m.commandPalette.isOpen).toBe(false)
			}),
		)
	})
})

describe("Completed (palette navigation)", () => {
	test("a palette link closes the palette and follows the org-relative path", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("settings:team")),
			Command.expectExact(NavigateInternal({ url: "/hazel/settings/team" })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
			model((m) => expect(m.commandPalette.isOpen).toBe(false)),
		)
	})
})

describe("hotkeys", () => {
	test("create channel needs the channel.create permission", () => {
		story(
			update,
			given(signedIn("/hazel/chat", plainMember)),
			message(Message.PressedHotkey({ actionId: "channel.create" })),
			Command.expectNone(),
			model((m) => expect(m.modal).toBeNull()),
		)
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "channel.create" })),
			model((m) => expect(m.modal?._tag).toBe("NewChannel")),
		)
	})

	test("an unknown action id does nothing", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "nope" })),
			Command.expectNone(),
			model((m) => {
				expect(m.modal).toBeNull()
				expect(m.commandPalette.isOpen).toBe(false)
			}),
		)
	})
})

describe("palette status and presence", () => {
	test("picking a status sends it", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("status:dnd")),
			Command.expectExact(SetPresenceStatus({ status: "dnd" })),
			Command.resolve(SetPresenceStatus, focused),
		)
	})

	// BUG: legacy `setStatus` also sets `manualStatusAtom`, which overrides the AFK-derived status.
	// The port has no manual status, so going AFK after picking Do Not Disturb sends "away".
	test.fails("a picked status survives going AFK", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(presence(Presence.Message.ChangedContext({ userId: ada.id, activeChannelId: null, nowMs: 1 }))),
			message(presence(Presence.Message.ElapsedSyncDebounce({ version: 1 }))),
			Command.resolve(SendPresenceUpdate, Presence.Message.SucceededSendPresenceUpdate()),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("status:dnd")),
			Command.resolve(SetPresenceStatus, focused),
			message(presence(Presence.Message.ReachedAfkTimeout({ nowMs: 1 + AFK_TIMEOUT_MS }))),
			message(presence(Presence.Message.ElapsedSyncDebounce({ version: 2 }))),
			Command.expectNone(),
		)
	})
})
