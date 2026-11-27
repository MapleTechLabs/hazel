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
import { AutoFocusSearch } from "../page/home/commands"
import { Message as HomeMessage } from "../page/home/message"
import { CreateChannel, FocusInput } from "../overlay/command-palette/commands"
import { PageOutMessage } from "../page/out-message"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as Shell from "../shell/model"
import {
	ada,
	after,
	changedContext,
	hazelOrg,
	hotkey,
	rootScene,
	signedIn,
	toShell,
} from "../test/root-fixtures"
import { drainToast, playToastFeedback } from "../test/toast-fixtures"
import * as CommandMenu from "../ui/command-menu"
import { PortalCommandMenu } from "../ui/command-menu-view"
import * as Modal from "../ui/modal"
import { emit } from "./command"
import { Message } from "./message"
import { reportOf } from "./model"

/** The host's parts of the org shell: the sidebar's paint mark, the sidebar sheet and the command palette. */

const navItem = (name: string) => role("link", { name })
const paletteDone = CommandPalette.Message.CompletedFocusInput()
const palette = role("dialog", { name: "Command Menu" })
// The frame learns of each overlay opening or closing.
const overlayReport = (isOverlayOpen: boolean) =>
	emit({ _tag: "Report", report: { ...reportOf(signedIn("/hazel/chat")), isOverlayOpen } })
const reported = (isOverlayOpen: boolean) =>
	Command.resolve(overlayReport(isOverlayOpen), Message.CompletedEmit())

describe("the last screen's paint", () => {
	// The shell's `#app[data-paint="shell"]` holds the sidebar region (`root/frame.scene.test.ts`).
	const waiting = selector('[data-foldkit-region="sidebar"] [data-paint="loading"]')
	const toSidebar = (message: ChannelsSidebar.Message) =>
		Message.GotShellMessage({ message: Shell.Message.GotChannelsSidebarMessage({ message }) })
	const membershipsArrived = toSidebar(ChannelsSidebar.Message.UpdatedMemberChannelIds({ channelIds: [] }))
	// Every list the sidebar draws: each comes from its own query.
	const channelListsArrived = [
		membershipsArrived,
		toSidebar(ChannelsSidebar.Message.UpdatedSections({ sections: [] })),
		toSidebar(ChannelsSidebar.Message.UpdatedFavorites({ channels: [] })),
		toSidebar(ChannelsSidebar.Message.UpdatedChannelCustomers({ customers: [] })),
		toSidebar(ChannelsSidebar.Message.UpdatedDmChannelIds({ channelIds: [] })),
		toSidebar(ChannelsSidebar.Message.UpdatedSectionChannels({ sectionKey: "default", channels: [] })),
	]

	test("stays up while the sidebar's channel lists have yet to arrive", () => {
		scene(rootScene, given(signedIn("/hazel/chat")), sceneExpect(waiting).toExist())
	})

	test("stays up while only the memberships have arrived, not the Channels list", () => {
		scene(
			rootScene,
			given(after(signedIn("/hazel/chat"), [membershipsArrived])),
			sceneExpect(waiting).toExist(),
		)
	})

	test("goes once they have, empty or not", () => {
		scene(
			rootScene,
			given(after(signedIn("/hazel/chat"), channelListsArrived)),
			sceneExpect(waiting).toBeAbsent(),
		)
	})
})

// The tab bar and top bars are the shell's (`root/frame.scene.test.ts`); the host draws the rest.
describe("mobile", () => {
	const toPhone = (path: string) => {
		const desktop = signedIn(path)
		return { desktop, phone: changedContext(desktop, { isMobile: true }) }
	}
	const sheet = role("dialog", { name: "Sidebar" })

	// Settings' and Activity's sheets are the shell's (`root/frame.scene.test.ts`); Customers' is still the host's.
	test("a section's top bar menu opens its sidebar sheet", () => {
		const { desktop, phone } = toPhone("/hazel/customers")
		scene(
			rootScene,
			given(desktop),
			Subscription.emit(phone),
			sceneExpect(sheet).toBeAbsent(),
			Subscription.emit(Message.ReceivedShellRequest({ request: { _tag: "PressedMobileMenu" } })),
			sceneExpect(sheet).toExist(),
			Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources()),
			sceneExpect(within(sheet, navItem("Overview"))).toExist(),
		)
	})

	// The Effect UI channel sidebar fills the hole, with its Members link (`ChannelSidebar.test.ts`).
	test("the Home tab's page is the chat list", () => {
		const chat = toPhone("/hazel/chat")
		scene(
			rootScene,
			given(chat.desktop),
			// The channels sidebar moves from the dock into the page.
			Subscription.emit(chat.phone),
			sceneExpect(
				selector('[data-foldkit-region="page"] [data-hazel-hole="channel-sidebar"]'),
			).toExist(),
			sceneExpect(sheet).toBeAbsent(),
		)
		const home = toPhone("/hazel")
		scene(
			rootScene,
			given(home.desktop),
			// The desktop focuses the member search; a phone leaves its keyboard down.
			Mount.resolve(AutoFocusSearch, HomeMessage.CompletedFocusSearch()),
			Subscription.emit(home.phone),
			Mount.expectEnded(AutoFocusSearch),
		)
	})

	test("Customers is under More", () => {
		const { desktop, phone } = toPhone("/hazel/more")
		scene(
			rootScene,
			given(desktop),
			Subscription.emit(phone),
			sceneExpect(role("link", { name: /Customers/ })).toHaveAttr("href", "/hazel/customers"),
		)
	})
})

describe("command palette", () => {
	const opened = [
		Subscription.emit(hotkey("commandPalette.open")),
		Command.resolve(FocusInput, paletteDone),
		reported(true),
		Mount.resolve(PortalCommandMenu, CommandMenu.Message.CompletedPortalCommandMenu()),
	] as const

	test("the hotkey opens it on the home page, and Escape closes it", () => {
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			sceneExpect(palette).toBeAbsent(),
			...opened,
			sceneExpect(within(palette, role("menuitem", { name: /Create channel/ }))).toExist(),
			keydown("Escape")(within(palette, selector("input"))),
			reported(false),
			sceneExpect(palette).toBeAbsent(),
			Mount.expectEnded(PortalCommandMenu),
		)
	})

	test("creating a channel validates, then closes, navigates and toasts", () => {
		const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000c1")
		const nameField = placeholder("e.g. general, design, marketing")
		// The palette's links stay hrefs: they can carry a search.
		const toChannel = toShell(PageOutMessage.RequestedHref({ href: `/hazel/chat/${channelId}` }))
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
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
			Command.expectHas(toChannel),
			Command.resolve(toChannel, Message.CompletedEmit()),
			reported(false),
			sceneExpect(palette).toBeAbsent(),
			Mount.expectEnded(PortalCommandMenu),
			sceneExpect(text("Channel created successfully")).toExist(),
			// The toast enters, its 4s lifetime runs out, then it is removed after its exit animation.
			playToastFeedback,
			...drainToast(),
			sceneExpect(text("Channel created successfully")).toBeAbsent(),
		)
	})
})
