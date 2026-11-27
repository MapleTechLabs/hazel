// @vitest-environment jsdom
import * as UiToast from "@foldkit/ui/toast"
import { ChannelId, ChannelMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Toaster from "../overlay/toaster"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as Shell from "../shell/model"
import * as Platform from "../platform"
import { update as shellUpdate } from "../root/logic"
import { AppMessage } from "../root/message"
import * as Presence from "../platform/presence/message"
import { AFK_TIMEOUT_MS } from "../platform/presence/model"
import { BroadcastActivity, SendPresenceUpdate } from "../platform/presence/update"
import { PageOutMessage } from "../page/out-message"
import {
	ada,
	changedContext,
	hazelOrg,
	hotkey,
	navigated,
	navigation,
	plainMember,
	signedIn,
	hostRequestsOf,
	shellSignedIn,
	toShell,
} from "../test/root-fixtures"
import { combo } from "~/lib/keybindings/key-combo"
import * as Menu from "../ui/menu"
import { CreateDm, Emit, emit } from "./command"
import { Message, type ShellRequest } from "./message"
import { dmRequestKey, type Model, reportOf, sharedOf } from "./model"
import { update } from "./update"

/** The facts children report (OutMessages): the host opens its overlays and asks the shell for the rest. */

const sidebar = (inner: ChannelsSidebar.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotChannelsSidebarMessage({ message: inner }) })
const done = Message.CompletedEmit()
const emitted = Command.resolve(Emit, done)
// The frame learns of each overlay opening or closing.
const overlayReport = (isOverlayOpen: boolean) =>
	emit({ _tag: "Report", report: { ...reportOf(signedIn("/hazel/chat")), isOverlayOpen } })
const overlayOpened = Command.resolve(overlayReport(true), done)
const overlayClosed = Command.resolve(overlayReport(false), done)
const sent = (outMessage: PageOutMessage) => Command.resolve(toShell(outMessage), done)
const presence = (inner: Presence.Message): Message =>
	Message.GotPlatformMessage({ message: Platform.Message.GotPresenceMessage({ message: inner }) })

describe("RequestedSignOut", () => {
	// Log out in the account menu is a native request (`shared-screens/src/shell/Chrome.test.ts`).
	test("a failed sign-out keeps the app up and says so", () => {
		const [request] = hostRequestsOf(
			shellUpdate(shellSignedIn("/hazel/chat"), AppMessage.FailedSignOut({ reason: "Offline" }))
				.commands,
		) as Array<ShellRequest>
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.ReceivedShellRequest({ request: request! })),
			model((m) =>
				expect(m.toasts.entries.map((entry) => entry.payload.title)).toEqual(["Failed to sign out"]),
			),
			Command.resolve(Toaster.PlayToastFeedback, Toaster.Message.CompletedToastFeedback()),
			UiToast.test.drainEntry({ entryId: "toaster-entry-0" }),
			model((m) => expect(m.toasts.entries).toEqual([])),
		)
	})
})

describe("RequestedDmCreation", () => {
	const grace = Schema.decodeSync(UserId)("00000000-0000-4000-8000-0000000000d1")
	const dmId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000d2")
	// The member directory's Message (a native page): the root forwards its request to the host.
	const requestDm = (userId: UserId, name: string): Message =>
		Message.ReceivedShellRequest({
			request: {
				_tag: "RequestedPageOut",
				outMessage: PageOutMessage.RequestedDmCreation({
					organizationId: hazelOrg.id,
					orgSlug: "hazel",
					userId,
					name,
				}),
			},
		})
	const pressGrace = requestDm(grace, "Grace Hopper")
	const pressMessageGrace = [pressGrace]
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
	 * Folds Messages through the host update, keeping the last step's Commands as `{ name, args }`.
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
		const left = run(pressed.model, [navigated(pressed.model, "/hazel/notifications")])

		const done = run(left.model, [succeeded])
		expect(toastTitles(done.model)).toEqual(["Started conversation with Grace Hopper"])
		expect(done.model.creatingDms).toEqual([])
		expect(done.commands).toContainEqual(asCall(navigation(`/hazel/chat/${dmId}`)))
	})

	test("after a move to another org, success only toasts", () => {
		const pressed = run(signedIn("/hazel"), pressMessageGrace)
		const elsewhere = run(pressed.model, [navigated(pressed.model, "/acme")])
		const done = run(elsewhere.model, [succeeded])
		expect(toastTitles(done.model)).toEqual(["Started conversation with Grace Hopper"])
		expect(done.commands).not.toContainEqual(asCall(navigation(`/acme/chat/${dmId}`)))
		expect(done.commands).not.toContainEqual(asCall(navigation(`/hazel/chat/${dmId}`)))
	})

	test("a request for another member runs beside the first, with its own toast", () => {
		const alan = Schema.decodeSync(UserId)("00000000-0000-4000-8000-0000000000d3")
		const pressed = run(signedIn("/hazel"), pressMessageGrace)
		const both = run(pressed.model, [requestDm(alan, "Alan Turing")])
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

describe("RequestedKeybindings", () => {
	test("the Keybinds page's new key goes to the shell, whose context rebinds the hotkeys", () => {
		const overrides = { "inbox.open": combo("Mod+Shift+J") }
		const signed = signedIn("/hazel/my-settings/keybinds")
		story(
			update,
			given(signed),
			message(
				Message.GotPageMessage({
					message: {
						_tag: "MySettingsKeybinds",
						message: { _tag: "ClickedRecord", actionId: "inbox.open" },
					},
				}),
			),
			message(
				Message.GotPageMessage({
					message: {
						_tag: "MySettingsKeybinds",
						message: { _tag: "PressedCombo", combo: combo("Mod+Shift+J") },
					},
				}),
			),
			Command.expectHas(toShell(PageOutMessage.RequestedKeybindings({ overrides }))),
			emitted,
			message(changedContext(signed, { keybindingOverrides: overrides })),
			model((m) => expect(sharedOf(m).keys["inbox.open"]).toBe("Mod+Shift+J")),
		)
	})
})

describe("hotkeys", () => {
	test("create channel needs the channel.create permission", () => {
		story(
			update,
			given(signedIn("/hazel/chat", plainMember)),
			message(hotkey("channel.create")),
			Command.expectNone(),
		)
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("channel.create")),
			sent(PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } })),
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
				mutedUntilMs: null,
				notificationLevel: null,
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
			message(hotkey("channel.next")),
			Command.expectExact(navigation(`/hazel/chat/${random}`)),
			emitted,
		)
		story(
			update,
			given(withChannels(signedIn(`/hazel/chat/${random}`))),
			message(hotkey("channel.previous")),
			Command.expectExact(navigation(`/hazel/chat/${general}`)),
			emitted,
		)
	})

	test("only the layout's action ids are a PressedHotkey", () => {
		const decode = Schema.decodeUnknownOption(LayoutHotkeyActionId)
		expect(Option.isSome(decode("dm.create"))).toBe(true)
		expect(Option.isNone(decode("nope"))).toBe(true)
	})
})

describe("palette status and presence", () => {
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
			// The shell's palette ran the status RPC; the host keeps the pick ahead of the away timer.
			message(
				Message.ReceivedShellRequest({ request: { _tag: "PickedPresenceStatus", status: "dnd" } }),
			),
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
