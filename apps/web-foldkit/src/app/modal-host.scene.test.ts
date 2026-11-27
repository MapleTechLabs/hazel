// @vitest-environment jsdom
import { Command, Mount, click, expect as sceneExpect, given, role, scene, text, within } from "foldkit/scene"
import { describe, expect, test } from "vitest"
import type { ModalRequest } from "../overlay/modal"
import { PageOutMessage } from "../page/out-message"
import { after, hotkey, rootScene, signedIn } from "../test/root-fixtures"
import * as Modal from "../ui/modal"
import * as Select from "../ui/select"
import { emit } from "./command"
import { Message } from "./message"
import { reportOf } from "./model"
import { update } from "./update"

/** The host's modal slot: the kinds still drawn here open in it; the rest go to the shell. */

/** What the native org switcher and account menu send for a modal (`shared-screens/src/shell/Chrome.ts`). */
const requestModal = (modal: ModalRequest): Message =>
	Message.ReceivedShellRequest({
		request: { _tag: "RequestedPageOut", outMessage: PageOutMessage.RequestedModal({ modal }) },
	})

const mounted = [Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources())] as const
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

	test("the Feedback modal opens from the account menu with its Category select", () => {
		const withFeedback = after(signedIn("/hazel/chat"), [requestModal({ _tag: "Feedback" })])
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
			...mounted,
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
