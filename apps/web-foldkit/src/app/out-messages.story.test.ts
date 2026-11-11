// @vitest-environment jsdom
import * as UiToast from "@foldkit/ui/toast"
import { ChannelId, ChannelMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { update } from "../main"
import * as CommandPalette from "../overlay/command-palette"
import { FocusInput, SetPresenceStatus } from "../overlay/command-palette/commands"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import { userMenuEntries } from "../shell/menus"
import * as Shell from "../shell/model"
import * as Platform from "../platform"
import * as Presence from "../platform/presence/message"
import { AFK_TIMEOUT_MS } from "../platform/presence/model"
import { BroadcastActivity, SendPresenceUpdate } from "../platform/presence/update"
import { ada, hazelOrg, plainMember, signedIn, urlOf } from "../test/root-fixtures"
import * as CommandMenu from "../ui/command-menu"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import * as Menu from "../ui/menu"
import {
	ApplyTheme,
	CreateDm,
	LoadExternal,
	NavigateInternal,
	SaveSoundSettings,
	SaveThemePreference,
	SignOut,
} from "./command"
import { Message } from "./message"
import { dmRequestKey, type Model } from "./model"
import { Message as HomeMessage } from "../page/home/message"
import type { DirectoryMember } from "../page/home/model"

/** The facts children report (OutMessages) and what the root does with them. */

const sidebar = (inner: ChannelsSidebar.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotChannelsSidebarMessage({ message: inner }) })
const paletteItem = (key: string): Message =>
	Message.GotCommandPaletteMessage({
		message: CommandPalette.Message.GotMenuMessage({ message: CommandMenu.Message.ClickedItem({ key }) }),
	})
const focused = CommandPalette.Message.CompletedFocusInput()
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
			model((m) => expect(m.modal.current?._tag).toBe("NewChannel")),
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
				expect(m.modal.current?._tag).toBe("EmailInvite")
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

describe("RequestedSignOut", () => {
	test("Log out in the user menu signs out, then loads `/` afresh", () => {
		const userMenu = (inner: Menu.Message): Message =>
			Message.GotShellMessage({ message: Shell.Message.GotUserMenuMessage({ message: inner }) })
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(userMenu(Menu.Message.PressedTrigger({ pointerType: "mouse" }))),
			message(
				userMenu(
					Menu.Message.ClickedItem({ key: "logout", entries: userMenuEntries("hazel", ada.id) }),
				),
			),
			Command.expectExact(SignOut()),
			Command.resolve(SignOut, Message.SucceededSignOut()),
			Command.expectExact(LoadExternal({ href: "/" })),
			Command.resolve(LoadExternal, Message.CompletedLoadExternal()),
		)
	})

	test("a failed sign-out keeps the app up and says so", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.FailedSignOut({ reason: "Offline" })),
			model((m) =>
				expect(m.toasts.entries.map((entry) => entry.payload.title)).toEqual(["Failed to sign out"]),
			),
			UiToast.test.drainEntry({ entryId: "toaster-entry-0" }),
			model((m) => expect(m.toasts.entries).toEqual([])),
		)
	})
})

describe("RequestedDmCreation", () => {
	const grace = Schema.decodeSync(UserId)("00000000-0000-4000-8000-0000000000d1")
	const dmId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000d2")
	const home = (message: HomeMessage): Message =>
		Message.GotPageMessage({ message: { _tag: "OrgHome", message } })
	const graceMember: DirectoryMember = {
		id: grace,
		firstName: "Grace",
		lastName: "Hopper",
		email: "grace@hazel.test",
		avatarUrl: null,
		role: "member",
		presenceStatus: null,
	}
	const pressGrace = home(HomeMessage.PressedMessageMember({ userId: grace, name: "Grace Hopper" }))
	const pressMessageGrace = [
		home(HomeMessage.UpdatedMembers({ members: [graceMember] })),
		home(HomeMessage.UpdatedDmChannels({ rows: [] })),
		pressGrace,
	]
	const createDm = CreateDm({
		organizationId: hazelOrg.id,
		orgSlug: "hazel",
		userId: grace,
		name: "Grace Hopper",
	})
	const succeeded = Message.SucceededCreateDm({
		organizationId: hazelOrg.id,
		orgSlug: "hazel",
		userId: grace,
		channelId: dmId,
		name: "Grace Hopper",
	})
	const isCreatingDmWithGrace = (m: Model) => m.creatingDms.includes(dmRequestKey(hazelOrg.id, grace))
	const toastTitles = (m: Model) => m.toasts.entries.map((entry) => entry.payload.title)

	/**
	 * Folds Messages through the root update, keeping the last step's Commands as `{ name, args }`.
	 * Not `story`: it would make every test resolve the toast timers and the route's own Commands.
	 */
	const run = (model: Model, messages: ReadonlyArray<Message>) =>
		messages.reduce<{ model: Model; commands: ReadonlyArray<{ name: string; args: unknown }> }>(
			(current, next) => {
				const result = update(current.model, next)
				const commands = (result.commands ?? []).map(({ name, args }) => ({ name, args }))
				return { model: result.model, commands }
			},
			{ model, commands: [] },
		)
	const asCall = ({ name, args }: { name: string; args: unknown }) => ({ name, args })

	test("the loading toast resolves even after the user leaves the home page", () => {
		const pressed = run(signedIn("/hazel"), pressMessageGrace)
		expect(pressed.commands).toContainEqual(asCall(createDm))
		expect(toastTitles(pressed.model)).toEqual(["Starting conversation with Grace Hopper..."])
		expect(isCreatingDmWithGrace(pressed.model)).toBe(true)

		// The user moves on before the RPC answers; the home page is gone.
		const left = run(pressed.model, [Message.ChangedUrl({ url: urlOf("/hazel/notifications") })])
		expect(left.model.page?._tag).not.toBe("OrgHome")

		const done = run(left.model, [succeeded])
		expect(toastTitles(done.model)).toEqual(["Started conversation with Grace Hopper"])
		expect(done.model.creatingDms).toEqual([])
		expect(done.commands).toContainEqual(asCall(NavigateInternal({ url: `/hazel/chat/${dmId}` })))
	})

	test("after a move to another org, success only toasts", () => {
		const pressed = run(signedIn("/hazel"), pressMessageGrace)
		const elsewhere = run(pressed.model, [Message.ChangedUrl({ url: urlOf("/acme") })])
		const done = run(elsewhere.model, [succeeded])
		expect(toastTitles(done.model)).toEqual(["Started conversation with Grace Hopper"])
		expect(done.commands.map((command) => command.name)).not.toContain("NavigateInternal")
	})

	test("a request for another member runs beside the first, with its own toast", () => {
		const alan = Schema.decodeSync(UserId)("00000000-0000-4000-8000-0000000000d3")
		const alanMember: DirectoryMember = {
			...graceMember,
			id: alan,
			firstName: "Alan",
			lastName: "Turing",
		}
		const pressed = run(signedIn("/hazel"), [
			home(HomeMessage.UpdatedMembers({ members: [graceMember, alanMember] })),
			home(HomeMessage.UpdatedDmChannels({ rows: [] })),
			pressGrace,
		])
		const both = run(pressed.model, [
			home(HomeMessage.PressedMessageMember({ userId: alan, name: "Alan Turing" })),
		])
		expect(both.commands.map((command) => command.name)).toContain("CreateDm")
		expect(toastTitles(both.model)).toEqual([
			"Starting conversation with Grace Hopper...",
			"Starting conversation with Alan Turing...",
		])
		const graceDone = run(both.model, [succeeded])
		expect(graceDone.model.creatingDms).toEqual([dmRequestKey(hazelOrg.id, alan)])
	})

	test("a second press while the DM is being created is ignored", () => {
		const pressed = run(signedIn("/hazel"), pressMessageGrace)
		const again = run(pressed.model, [pressGrace])
		expect(again.commands).not.toContainEqual(asCall(createDm))
		expect(again.model.toasts.entries).toHaveLength(1)
	})

	test("a failure replaces the loading toast with the error and allows another try", () => {
		const pressed = run(signedIn("/hazel"), pressMessageGrace)
		const failed = run(pressed.model, [
			Message.FailedCreateDm({ organizationId: hazelOrg.id, userId: grace, reason: "AlreadyExists" }),
		])
		expect(toastTitles(failed.model)).toEqual(["You already have a conversation with them"])
		expect(failed.model.creatingDms).toEqual([])
		expect(run(failed.model, [pressGrace]).commands).toContainEqual(asCall(createDm))
	})
})

describe("RequestedSoundSettings", () => {
	test("the notifications page's sound toggle is stored by the root and shared back", () => {
		const off = { ...DEFAULT_SOUND_SETTINGS, enabled: false }
		story(
			update,
			given(signedIn("/hazel/my-settings/notifications")),
			message(
				Message.GotPageMessage({
					message: {
						_tag: "MySettingsNotifications",
						message: { _tag: "ToggledSounds", isSelected: false },
					},
				}),
			),
			Command.expectHas(SaveSoundSettings({ settings: off })),
			Command.resolveAll([SaveSoundSettings, Message.CompletedSaveSoundSettings()]),
			model((m) => expect(m.soundSettings).toEqual(off)),
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
			model((m) => expect(m.modal.current).toBeNull()),
		)
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "channel.create" })),
			model((m) => expect(m.modal.current?._tag).toBe("NewChannel")),
		)
	})

	test("Alt+ArrowDown (channel.next) opens the sidebar's next channel; Alt+ArrowUp the one above", () => {
		const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
		const [general, random] = [uuid(9001), uuid(9002)].map((raw) =>
			Schema.decodeSync(ChannelId)(raw),
		) as [ChannelId, ChannelId]
		const entry = (channelId: ChannelId, n: number) => ({
			channel: { id: channelId, name: `c${n}`, type: "public", icon: null, sectionId: null },
			member: {
				id: Schema.decodeSync(ChannelMemberId)(uuid(9100 + n)),
				isMuted: false,
				isFavorite: false,
				notificationCount: 0,
			},
		})
		const withChannels = (root: ReturnType<typeof signedIn>) =>
			update(
				root,
				sidebar(
					ChannelsSidebar.Message.UpdatedSectionChannels({
						sectionKey: "default",
						channels: [entry(general, 1), entry(random, 2)],
					}),
				),
			).model
		story(
			update,
			given(withChannels(signedIn(`/hazel/chat/${general}`))),
			message(Message.PressedHotkey({ actionId: "channel.next" })),
			Command.expectExact(NavigateInternal({ url: `/hazel/chat/${random}` })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
		)
		story(
			update,
			given(withChannels(signedIn(`/hazel/chat/${random}`))),
			message(Message.PressedHotkey({ actionId: "channel.previous" })),
			Command.expectExact(NavigateInternal({ url: `/hazel/chat/${general}` })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
		)
	})

	test("only the layout's action ids are a PressedHotkey", () => {
		const decode = Schema.decodeUnknownOption(LayoutHotkeyActionId)
		expect(Option.isSome(decode("dm.create"))).toBe(true)
		expect(Option.isNone(decode("nope"))).toBe(true)
	})
})

describe("palette status and presence", () => {
	const succeeded = CommandPalette.Message.SucceededSetPresenceStatus()

	test("picking a status sends it", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("status:dnd")),
			Command.expectExact(SetPresenceStatus({ status: "dnd" })),
			Command.resolve(SetPresenceStatus, succeeded),
		)
	})

	// B3: legacy `setStatus` sets `manualStatusAtom`, which overrides the AFK-derived status, and
	// its sync effect sends the new computed status once.
	test("a picked status survives going AFK and coming back", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(
				presence(
					Presence.Message.ChangedContext({ userId: ada.id, activeChannelId: null, nowMs: 1 }),
				),
			),
			message(presence(Presence.Message.ElapsedSyncDebounce({ version: 1 }))),
			Command.resolve(
				SendPresenceUpdate,
				Presence.Message.SucceededSendPresenceUpdate({
					userId: ada.id,
					sent: { status: "online", activeChannelId: null },
				}),
			),
			message(Message.PressedHotkey({ actionId: "commandPalette.open" })),
			Command.resolve(FocusInput, focused),
			message(paletteItem("status:dnd")),
			Command.resolve(SetPresenceStatus, succeeded),
			model((m) => expect(m.platform.presence.manualStatus).toBe("dnd")),
			message(presence(Presence.Message.ElapsedSyncDebounce({ version: 2 }))),
			Command.expectExact(
				SendPresenceUpdate({
					userId: ada.id,
					snapshot: { status: "dnd", activeChannelId: null },
					status: "dnd",
				}),
			),
			Command.resolve(
				SendPresenceUpdate,
				Presence.Message.SucceededSendPresenceUpdate({
					userId: ada.id,
					sent: { status: "dnd", activeChannelId: null },
				}),
			),
			message(presence(Presence.Message.ReachedAfkTimeout({ nowMs: 1 + AFK_TIMEOUT_MS }))),
			message(presence(Presence.Message.DetectedActivity({ atMs: 2 + AFK_TIMEOUT_MS }))),
			Command.resolve(BroadcastActivity, Presence.Message.CompletedBroadcastActivity()),
			model((m) => {
				expect(m.platform.presence.syncVersion).toBe(2)
				expect(m.platform.presence.isSyncPending).toBe(false)
			}),
			message(presence(Presence.Message.ElapsedSyncDebounce({ version: 2 }))),
			Command.expectNone(),
		)
	})
})
