// @vitest-environment jsdom
import { Command, Mount, click, expect as sceneExpect, given, role, scene, text, within } from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import { userMenuEntries } from "../shell/menus"
import * as Shell from "../shell/model"
import { ada, after, hotkey, rootScene, signedIn } from "../test/root-fixtures"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import * as Modal from "../ui/modal"
import * as Select from "../ui/select"
import { emit } from "./command"
import { Message } from "./message"
import { reportOf } from "./model"
import { update } from "./update"

/** The host's modal slot: the kinds still drawn here open in it; the rest go to the shell. */

const mounted = [
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources()),
] as const
// Closing tells the frame no overlay is open any more.
const closedReport = emit({ _tag: "Report", report: reportOf(signedIn("/hazel/chat")) })
const reportedClosed = Command.resolve(closedReport, Message.CompletedEmit())

describe("modal host", () => {
	test("a kind the shell draws (`root/modals.ts`) goes to it, and the host opens nothing", () => {
		const result = update(signedIn("/hazel/chat"), hotkey("channel.create"))
		expect(result.model.modal.current).toBeNull()
		expect((result.commands ?? []).map((command) => command.args)).toContainEqual({
			out: {
				_tag: "Page",
				outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } }),
			},
		})
	})

	test("the Feedback modal opens from the user menu with its Category select", () => {
		const userMenu = (inner: Menu.Message): Message =>
			Message.GotShellMessage({ message: Shell.Message.GotUserMenuMessage({ message: inner }) })
		const withFeedback = after(signedIn("/hazel/chat"), [
			userMenu(Menu.Message.PressedTrigger({ pointerType: "mouse" })),
			userMenu(
				Menu.Message.ClickedItem({ key: "feedback", entries: userMenuEntries("hazel", ada.id) }),
			),
		])
		const feedback = role("dialog", { name: "Send feedback" })
		scene(
			rootScene,
			given(withFeedback),
			...mounted,
			Mount.resolve({ name: "FocusSelectTriggerOnPress" }, Select.Message.CompletedPortalSelect()),
			sceneExpect(feedback).toExist(),
			sceneExpect(within(feedback, text("Bug"))).toExist(),
		)
	})
})

describe("keyboard shortcuts (Mod+/)", () => {
	test("the dialog lists the shortcuts in this platform's notation", () => {
		const shortcuts = role("dialog", { name: "Keyboard shortcuts" })
		scene(
			rootScene,
			given(after(signedIn("/hazel/chat"), [hotkey("shortcuts.open")])),
			...mounted.slice(0, 2),
			Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources()),
			sceneExpect(shortcuts).toExist(),
			sceneExpect(within(shortcuts, text("Previous Channel"))).toExist(),
			sceneExpect(within(shortcuts, text("Delete Without Confirming"))).toExist(),
			sceneExpect(within(shortcuts, text("Alt+↑"))).toExist(),
			click(within(shortcuts, role("button", { name: "Close" }))),
			reportedClosed,
			sceneExpect(shortcuts).toBeAbsent(),
			Mount.expectEnded(Modal.AcquireResources),
		)
	})
})
