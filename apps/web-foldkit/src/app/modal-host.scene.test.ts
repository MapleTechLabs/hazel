// @vitest-environment jsdom
import {
	Command,
	Mount,
	click,
	expect as sceneExpect,
	given,
	label,
	role,
	scene,
	submit,
	text,
	type,
	within,
	selector,
} from "foldkit/scene"
import { describe, test } from "vitest"
import * as CreateSection from "../overlay/modal/create-section"
import type { ModalRequest } from "../overlay/modal"
import { PageOutMessage } from "../page/out-message"
import { after, hazelOrg, hotkey, rootScene, signedIn } from "../test/root-fixtures"
import { drainToast, playToastFeedback } from "../test/toast-fixtures"
import * as Modal from "../ui/modal"
import * as Select from "../ui/select"
import { emit } from "./command"
import { Message } from "./message"
import { reportOf } from "./model"

/** The host's modal slot: a modal opened by the shell, its result toast, and closing (legacy `useModal`). */

/** What the native org switcher and account menu send for a modal (`shared-screens/src/shell/Chrome.ts`). */
const requestModal = (modal: ModalRequest): Message =>
	Message.ReceivedShellRequest({
		request: { _tag: "RequestedPageOut", outMessage: PageOutMessage.RequestedModal({ modal }) },
	})

const withCreateSection = after(signedIn("/hazel/chat"), [requestModal({ _tag: "CreateSection" })])

const dialog = role("dialog", { name: "Create section" })
const mounted = [Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources())] as const
// Closing tells the frame no overlay is open any more.
const closedReport = emit({ _tag: "Report", report: reportOf(signedIn("/hazel/chat")) })
const reportedClosed = Command.resolve(closedReport, Message.CompletedEmit())

describe("modal host", () => {
	test("a modal requested by the shell opens in the root slot", () => {
		scene(rootScene, given(withCreateSection), ...mounted, sceneExpect(dialog).toExist())
	})

	test("success closes the modal and shows the modal's toast", () => {
		scene(
			rootScene,
			given(withCreateSection),
			...mounted,
			type(label("Section name"), "D"),
			sceneExpect(label("Section name")).toHaveAttr("aria-invalid", "true"),
			sceneExpect(role("button", { name: "Create section" })).toBeDisabled(),
			type(label("Section name"), "Design"),
			submit(within(dialog, selector("form"))),
			Command.expectExact(CreateSection.CreateSection({ name: "Design", organizationId: hazelOrg.id })),
			sceneExpect(role("button", { name: "Creating..." })).toBeDisabled(),
			Command.resolve(CreateSection.CreateSection, CreateSection.Message.SucceededCreateSection()),
			reportedClosed,
			sceneExpect(dialog).toBeAbsent(),
			Mount.expectEnded(Modal.AcquireResources),
			sceneExpect(text("Section created successfully")).toExist(),
			playToastFeedback,
			...drainToast(),
		)
	})

	test("a failure keeps the modal open, re-enables it and toasts the error", () => {
		const failed = { intent: "error" as const, title: "Could not create the section", description: null }
		scene(
			rootScene,
			given(withCreateSection),
			...mounted,
			type(label("Section name"), "Design"),
			submit(within(dialog, selector("form"))),
			Command.resolve(
				CreateSection.CreateSection,
				CreateSection.Message.FailedCreateSection({ toast: failed }),
			),
			sceneExpect(dialog).toExist(),
			sceneExpect(role("button", { name: "Create section" })).toBeEnabled(),
			sceneExpect(text("Could not create the section")).toExist(),
			playToastFeedback,
			...drainToast(),
		)
	})

	test("Cancel closes without a toast", () => {
		scene(
			rootScene,
			given(withCreateSection),
			...mounted,
			click(role("button", { name: "Cancel" })),
			sceneExpect(dialog).toBeAbsent(),
			Mount.expectEnded(Modal.AcquireResources),
			Command.expectExact(closedReport),
			reportedClosed,
		)
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
