// @vitest-environment jsdom
import { Command, Mount, click, expect as sceneExpect, given, label, role, scene, submit, text, type, within, selector } from "foldkit/scene"
import { describe, test } from "vitest"
import * as CreateSection from "../overlay/modal/create-section"
import * as Shell from "../shell/model"
import { after, hazelOrg, rootScene, signedIn } from "../test/root-fixtures"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import * as Modal from "../ui/modal"
import * as Toast from "../ui/toast"
import { Message } from "./message"

/** The root modal slot: a modal opened by the shell, its result toast, and closing (legacy `useModal`). */

const orgSwitcher = (inner: Menu.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotOrgSwitcherMessage({ message: inner }) })

const withCreateSection = after(signedIn("/hazel/chat"), [
	orgSwitcher(Menu.Message.PressedTrigger({ pointerType: "mouse" })),
	orgSwitcher(Menu.Message.ClickedItem({ key: "create-category" })),
])

const dialog = role("dialog", { name: "Create a new Section" })
const mounted = [
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(Modal.PortalModal, Modal.Message.CompletedPortalModal()),
] as const

describe("modal host", () => {
	test("a modal requested by the shell opens in the root slot", () => {
		scene(rootScene, given(withCreateSection), ...mounted, sceneExpect(dialog).toExist())
	})

	test("success closes the modal and shows the modal's toast", () => {
		scene(
			rootScene,
			given(withCreateSection),
			...mounted,
			type(label("Section Name"), "D"),
			sceneExpect(label("Section Name")).toHaveAttr("aria-invalid", "true"),
			sceneExpect(role("button", { name: "Create section" })).toBeDisabled(),
			type(label("Section Name"), "Design"),
			submit(within(dialog, selector("form"))),
			Command.expectExact(CreateSection.CreateSection({ name: "Design", organizationId: hazelOrg.id })),
			sceneExpect(role("button", { name: "Creating..." })).toBeDisabled(),
			Command.resolve(CreateSection.CreateSection, CreateSection.Message.SucceededCreateSection()),
			sceneExpect(dialog).toBeAbsent(),
			Mount.expectEnded(Modal.PortalModal),
			sceneExpect(text("Section created successfully")).toExist(),
			Mount.resolve(Toast.MeasureToast, Toast.Message.MeasuredToast({ id: 1, height: 52 })),
			Command.resolve(Toast.StartToastTimer, Toast.Message.StartedTimer({ id: 1, version: 1, at: 0 })),
			Command.resolve(Toast.WaitForToastLifetime, Toast.Message.CompletedWaitForLifetime({ id: 1, version: 1 })),
			Command.resolve(Toast.WaitForToastRemoval, Toast.Message.CompletedWaitForRemoval({ id: 1 })),
			Mount.expectEnded(Toast.MeasureToast),
		)
	})

	test("a failure keeps the modal open, re-enables it and toasts the error", () => {
		const failed = { intent: "error" as const, title: "Could not create the section", description: null }
		scene(
			rootScene,
			given(withCreateSection),
			...mounted,
			type(label("Section Name"), "Design"),
			submit(within(dialog, selector("form"))),
			Command.resolve(CreateSection.CreateSection, CreateSection.Message.FailedCreateSection({ toast: failed })),
			sceneExpect(dialog).toExist(),
			sceneExpect(role("button", { name: "Create section" })).toBeEnabled(),
			sceneExpect(text("Could not create the section")).toExist(),
			Mount.resolve(Toast.MeasureToast, Toast.Message.MeasuredToast({ id: 1, height: 52 })),
			Command.resolve(Toast.StartToastTimer, Toast.Message.StartedTimer({ id: 1, version: 1, at: 0 })),
			Command.resolve(Toast.WaitForToastLifetime, Toast.Message.CompletedWaitForLifetime({ id: 1, version: 1 })),
			Command.resolve(Toast.WaitForToastRemoval, Toast.Message.CompletedWaitForRemoval({ id: 1 })),
			Mount.expectEnded(Toast.MeasureToast),
		)
	})

	test("Cancel closes without a toast", () => {
		scene(
			rootScene,
			given(withCreateSection),
			...mounted,
			click(role("button", { name: "Cancel" })),
			sceneExpect(dialog).toBeAbsent(),
			Mount.expectEnded(Modal.PortalModal),
			Command.expectNone(),
		)
	})
})
