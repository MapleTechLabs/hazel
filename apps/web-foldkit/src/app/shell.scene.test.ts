// @vitest-environment jsdom
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import {
	Command,
	Mount,
	Subscription,
	click,
	expect as sceneExpect,
	given,
	keydown,
	placeholder,
	role,
	scene,
	selector,
	submit,
	text,
	type,
	within,
} from "foldkit/scene"
import { describe, test } from "vitest"
import * as CommandPalette from "../overlay/command-palette"
import { CreateChannel, FocusInput } from "../overlay/command-palette/commands"
import * as Shell from "../shell/model"
import { ada, hazelOrg, rootScene, signedIn } from "../test/root-fixtures"
import * as CommandMenu from "../ui/command-menu"
import { PortalCommandMenu } from "../ui/command-menu-view"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import * as Modal from "../ui/modal"
import * as Toast from "../ui/toast"
import { NavigateInternal } from "./command"
import { Message } from "./message"

/** The org shell around every page: nav rail, mobile nav, the sidebar sheet and the command palette. */

// The sidebar header's org switcher and footer user menu focus their trigger on press.
const menusMounted = [
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
] as const

const navItem = (name: string) => role("link", { name })
const currentLink = selector('a[aria-current="page"]')
const paletteDone = CommandPalette.Message.CompletedFocusInput()
const palette = role("dialog", { name: "Command Menu" })

describe("nav rail", () => {
	test("marks the section of the current route", () => {
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			...menusMounted,
			sceneExpect(within(navItem("Settings"), currentLink)).toExist(),
			sceneExpect(within(navItem("Chat"), currentLink)).toBeAbsent(),
			sceneExpect(within(navItem("Home"), currentLink)).toBeAbsent(),
		)
	})
})

describe("mobile", () => {
	const mobile = Message.GotShellMessage({ message: Shell.Message.ChangedViewport({ isMobile: true }) })

	test("the bottom nav's Menu button opens the sidebar sheet", () => {
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			...menusMounted,
			sceneExpect(role("button", { name: /Menu/ })).toBeAbsent(),
			Subscription.emit(mobile),
			// The desktop dock (and its two menus) leaves the tree.
			Mount.expectEnded(FocusTriggerOnPress, FocusTriggerOnPress),
			sceneExpect(role("dialog", { name: "Sidebar" })).toBeAbsent(),
			click(role("button", { name: /Menu/ })),
			sceneExpect(role("dialog", { name: "Sidebar" })).toExist(),
			Mount.resolve(Modal.PortalModal, Modal.Message.CompletedPortalModal()),
			...menusMounted,
			sceneExpect(within(role("dialog", { name: "Sidebar" }), navItem("Settings"))).toExist(),
		)
	})
})

describe("command palette", () => {
	const opened = [
		Subscription.emit(Message.PressedHotkey({ actionId: "commandPalette.open" })),
		Command.resolve(FocusInput, paletteDone),
		Mount.resolve(PortalCommandMenu, CommandMenu.Message.CompletedPortalCommandMenu()),
	] as const

	test("the hotkey opens it on the home page, and Escape closes it", () => {
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			...menusMounted,
			sceneExpect(palette).toBeAbsent(),
			...opened,
			sceneExpect(within(palette, role("menuitem", { name: /Create channel/ }))).toExist(),
			keydown("Escape")(within(palette, selector("input"))),
			sceneExpect(palette).toBeAbsent(),
			Mount.expectEnded(PortalCommandMenu),
		)
	})

	test("creating a channel validates, then closes, navigates and toasts", () => {
		const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000c1")
		const nameField = placeholder("e.g. general, design, marketing")
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			...menusMounted,
			...opened,
			click(role("menuitem", { name: /Create channel/ })),
			Command.resolve(FocusInput, paletteDone),
			type(nameField, "ab"),
			submit(within(palette, selector("form"))),
			sceneExpect(role("alert")).toHaveText("Channel name must be at least 3 characters"),
			type(nameField, "design"),
			submit(within(palette, selector("form"))),
			Command.expectExact(
				CreateChannel({
					name: "design",
					type: "public",
					organizationId: hazelOrg.id,
					currentUserId: ada.id,
				}),
			),
			Command.resolve(CreateChannel, CommandPalette.Message.SucceededCreateChannel({ channelId })),
			Command.expectExact(
				NavigateInternal({ url: `/hazel/chat/${channelId}` }),
				Toast.StartToastTimer({ id: 1, version: 1 }),
			),
			Command.resolveAll(
				[NavigateInternal, Message.CompletedNavigateInternal()],
				[Toast.StartToastTimer, Toast.Message.StartedTimer({ id: 1, version: 1, at: 0 })],
			),
			sceneExpect(palette).toBeAbsent(),
			Mount.expectEnded(PortalCommandMenu),
			sceneExpect(text("Channel created successfully")).toExist(),
			Mount.resolve(Toast.MeasureToast, Toast.Message.MeasuredToast({ id: 1, height: 52 })),
			// The toast's lifetime runs out (sonner's 4s), then it is removed after its exit animation.
			Command.resolve(Toast.WaitForToastLifetime, Toast.Message.CompletedWaitForLifetime({ id: 1, version: 1 })),
			Command.resolve(Toast.WaitForToastRemoval, Toast.Message.CompletedWaitForRemoval({ id: 1 })),
			sceneExpect(text("Channel created successfully")).toBeAbsent(),
			Mount.expectEnded(Toast.MeasureToast),
		)
	})
})
