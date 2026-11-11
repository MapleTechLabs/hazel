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
import { orgSwitcherEntries, userMenuEntries } from "../shell/menus"
import * as Shell from "../shell/model"
import { ada, after, hazelOrg, rootScene, signedIn } from "../test/root-fixtures"
import { drainToast } from "../test/toast-fixtures"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import * as Modal from "../ui/modal"
import * as Select from "../ui/select"
import { Message } from "./message"

/** The root modal slot: a modal opened by the shell, its result toast, and closing (legacy `useModal`). */

const orgSwitcher = (inner: Menu.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotOrgSwitcherMessage({ message: inner }) })

const withCreateSection = after(signedIn("/hazel/chat"), [
	orgSwitcher(Menu.Message.PressedTrigger({ pointerType: "mouse" })),
	orgSwitcher(
		Menu.Message.ClickedItem({
			key: "create-category",
			entries: orgSwitcherEntries({
				orgSlug: "hazel",
				isChat: true,
				isMobile: false,
				canCreateChannel: true,
				organizations: [],
			}),
		}),
	),
])

const dialog = role("dialog", { name: "Create a new Section" })
const mounted = [
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
	Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources()),
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
			Mount.expectEnded(Modal.AcquireResources),
			sceneExpect(text("Section created successfully")).toExist(),
			...drainToast(),
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
			Command.resolve(
				CreateSection.CreateSection,
				CreateSection.Message.FailedCreateSection({ toast: failed }),
			),
			sceneExpect(dialog).toExist(),
			sceneExpect(role("button", { name: "Create section" })).toBeEnabled(),
			sceneExpect(text("Could not create the section")).toExist(),
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
			Command.expectNone(),
		)
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
		const feedback = role("dialog", { name: "Send Feedback" })
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
			given(after(signedIn("/hazel/chat"), [Message.PressedHotkey({ actionId: "shortcuts.open" })])),
			...mounted.slice(0, 2),
			Mount.resolve(Modal.AcquireResources, Modal.Message.SucceededAcquireResources()),
			sceneExpect(shortcuts).toExist(),
			sceneExpect(within(shortcuts, text("Previous Channel"))).toExist(),
			sceneExpect(within(shortcuts, text("Delete Without Confirming"))).toExist(),
			sceneExpect(within(shortcuts, text("Alt+↑"))).toExist(),
			click(within(shortcuts, role("button", { name: "Close" }))),
			sceneExpect(shortcuts).toBeAbsent(),
			Mount.expectEnded(Modal.AcquireResources),
		)
	})
})
