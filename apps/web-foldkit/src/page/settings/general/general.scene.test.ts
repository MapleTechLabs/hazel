// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { failureToastFixture, makeShared, memberWithRole, organizationId, pageScene, portalModalMounted } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { successToast } from "../../../data/actions"
import * as Modal from "../../../ui/modal"
import { Message } from "./message"
import { DeleteOrganization, init, LeaveDeletedWorkspace, SetPublicMode, update, UpdateOrganizationName } from "./update"
import { view } from "./view"

/** The general settings page through its view: rename, public invites and the delete-workspace dialog. */

const route = { _tag: "SettingsGeneral", orgSlug: "hazel" } as const
const owner = makeShared()
const nameInput = Scene.label("Organization Name")
const dialog = Scene.role("dialog")
const confirmInput = Scene.placeholder("Hazel Labs")
const confirmDelete = Scene.within(dialog, Scene.role("button", { name: "Delete workspace" }))

describe("organization name", () => {
	test("Save Changes appears for a changed name and saves the trimmed name", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.expect(Scene.role("button", { name: "Save Changes" })).toBeAbsent(),
			Scene.type(nameInput, " Hazel HQ "),
			Scene.click(Scene.role("button", { name: "Save Changes" })),
			Scene.Command.expectExact(UpdateOrganizationName({ organizationId, name: "Hazel HQ" })),
			Scene.expect(Scene.role("button", { name: "Saving..." })).toBeDisabled(),
			Scene.Command.resolve(UpdateOrganizationName, Message.SucceededUpdateName()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Organization name updated") })),
		)
	})

	test("a failed rename re-enables the form and reports the failure", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.type(nameInput, "Hazel HQ"),
			Scene.keydown(nameInput, "Enter"),
			Scene.expectHandled(),
			Scene.Command.resolve(UpdateOrganizationName, Message.FailedUpdateName({ toast: failureToastFixture })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(Scene.role("button", { name: "Save Changes" })).toBeEnabled(),
		)
	})

	test("Cancel restores the server name", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.type(nameInput, "Draft"),
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.expect(nameInput).toHaveValue("Hazel Labs"),
			Scene.expect(Scene.role("button", { name: "Save Changes" })).toBeAbsent(),
		)
	})

	test("a member sees the name read-only and no admin cards", () => {
		const member = makeShared({ member: memberWithRole("member") })
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(init(route, member).model),
			Scene.expect(nameInput).toBeDisabled(),
			Scene.expect(Scene.text("Public Invite Link")).toBeAbsent(),
			Scene.expect(Scene.text("Danger Zone")).toBeAbsent(),
		)
	})
})

describe("public invite link", () => {
	test("enabling it toasts, and the link shows once the live organization row turns public", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.click(Scene.role("switch")),
			Scene.Command.expectExact(SetPublicMode({ organizationId, isPublic: true })),
			Scene.Command.resolve(SetPublicMode, Message.SucceededSetPublicMode({ isPublic: true })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Public invites enabled") })),
			Scene.expect(Scene.text("Anyone with this link can join your workspace as a member.")).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedIsPublic({ isPublic: true })),
			Scene.expect(Scene.text("Anyone with this link can join your workspace as a member.")).toExist(),
			Scene.expect(Scene.text("http://localhost:3000/join/hazel")).toExist(),
		)
	})
})

describe("delete workspace", () => {
	test("the confirm button stays disabled until the exact name is typed", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.click(Scene.role("button", { name: "Delete workspace" })),
			portalModalMounted,
			Scene.expect(dialog).toExist(),
			Scene.expect(confirmDelete).toBeDisabled(),
			Scene.type(confirmInput, "Hazel"),
			Scene.expect(confirmDelete).toBeDisabled(),
			Scene.type(confirmInput, "Hazel Labs"),
			Scene.expect(confirmDelete).toBeEnabled(),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Cancel" }))),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
		)
	})

	test("confirming deletes, toasts, then navigates home", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.click(Scene.role("button", { name: "Delete workspace" })),
			portalModalMounted,
			Scene.type(confirmInput, "Hazel Labs"),
			Scene.click(confirmDelete),
			Scene.Command.expectExact(DeleteOrganization({ organizationId })),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Deleting..." }))).toBeDisabled(),
			Scene.Command.resolve(DeleteOrganization, Message.SucceededDeleteWorkspace()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Workspace deleted successfully") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Command.resolve(LeaveDeletedWorkspace, Message.CompletedLeaveDeletedWorkspace()),
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/", replace: false })),
		)
	})

	test("a failed delete keeps the dialog open with the typed name", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init(route, owner).model),
			Scene.click(Scene.role("button", { name: "Delete workspace" })),
			portalModalMounted,
			Scene.type(confirmInput, "Hazel Labs"),
			Scene.click(confirmDelete),
			Scene.Command.resolve(DeleteOrganization, Message.FailedDeleteWorkspace({ toast: failureToastFixture })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(confirmInput).toHaveValue("Hazel Labs"),
			Scene.expect(confirmDelete).toBeEnabled(),
		)
	})

	test("only the owner can open the dialog", () => {
		const admin = makeShared({ member: memberWithRole("admin") })
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(init(route, admin).model),
			Scene.expect(Scene.text("Danger Zone")).toBeAbsent(),
		)
	})
})
