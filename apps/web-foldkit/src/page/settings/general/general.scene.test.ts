// @vitest-environment jsdom
import { routeOfPath } from "../../../route"
import type { OrganizationExport } from "@hazel/domain/models"
import type { OrganizationExportId } from "@hazel/schema"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import {
	makeShared,
	memberWithRole,
	organizationId,
	pageScene,
	portalModalMounted,
} from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { errorToast, reasonToast, successToast } from "../../../data/actions"
import * as Modal from "../../../ui/modal"
import { Message } from "./message"
import {
	DeleteOrganization,
	DownloadOrganizationExport,
	init,
	SetPublicMode,
	StartOrganizationExport,
	update,
	UpdateOrganizationName,
} from "./update"
import { view } from "./view"

/** The general settings page through its view: rename, public invites and the delete-workspace dialog. */

const route = { _tag: "SettingsGeneral", orgSlug: "hazel" } as const
const owner = makeShared()
/** The init model after `ReadOrigin` resolved. */
const initialModel = (shared = owner) => ({ ...init(route, shared).model, origin: "http://localhost:3000" })
const nameInput = Scene.label("Organization Name")
const dialog = Scene.role("dialog")
const confirmInput = Scene.placeholder("Hazel Labs")
const confirmDelete = Scene.within(dialog, Scene.role("button", { name: "Delete workspace" }))

describe("organization name", () => {
	test("Save Changes appears for a changed name and saves the trimmed name", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(initialModel()),
			Scene.expect(Scene.role("button", { name: "Save Changes" })).toBeAbsent(),
			Scene.type(nameInput, " Hazel HQ "),
			Scene.click(Scene.role("button", { name: "Save Changes" })),
			Scene.Command.expectExact(UpdateOrganizationName({ organizationId, name: "Hazel HQ" })),
			Scene.expect(Scene.role("button", { name: "Saving..." })).toBeDisabled(),
			Scene.Command.resolve(UpdateOrganizationName, Message.SucceededUpdateName()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Organization name updated") }),
			),
		)
	})

	test("a failed rename re-enables the form and reports the failure", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(initialModel()),
			Scene.type(nameInput, "Hazel HQ"),
			Scene.keydown(nameInput, "Enter"),
			Scene.expectHandled(),
			Scene.Command.resolve(UpdateOrganizationName, Message.FailedUpdateName({ reason: "Offline" })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
			Scene.expect(Scene.role("button", { name: "Save Changes" })).toBeEnabled(),
		)
	})

	test("Cancel restores the server name", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(initialModel()),
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
			Scene.given(initialModel(member)),
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
			Scene.given(initialModel()),
			Scene.click(Scene.role("switch")),
			Scene.Command.expectExact(SetPublicMode({ organizationId, isPublic: true })),
			Scene.Command.resolve(SetPublicMode, Message.SucceededSetPublicMode({ isPublic: true })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Public invites enabled") }),
			),
			Scene.expect(
				Scene.text("Anyone with this link can join your workspace as a member."),
			).toBeAbsent(),
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
			Scene.given(initialModel()),
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
			Scene.Mount.expectEnded(Modal.AcquireResources),
		)
	})

	test("confirming deletes, toasts, then navigates home", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(initialModel()),
			Scene.click(Scene.role("button", { name: "Delete workspace" })),
			portalModalMounted,
			Scene.type(confirmInput, "Hazel Labs"),
			Scene.click(confirmDelete),
			Scene.Command.expectExact(DeleteOrganization({ organizationId })),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Deleting..." }))).toBeDisabled(),
			Scene.Command.resolve(DeleteOrganization, Message.SucceededDeleteWorkspace()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/"),
					replace: false,
					toast: successToast("Workspace deleted successfully"),
				}),
			),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
		)
	})

	test("a failed delete keeps the dialog open with the typed name", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(initialModel()),
			Scene.click(Scene.role("button", { name: "Delete workspace" })),
			portalModalMounted,
			Scene.type(confirmInput, "Hazel Labs"),
			Scene.click(confirmDelete),
			Scene.Command.resolve(
				DeleteOrganization,
				Message.FailedDeleteWorkspace({ reason: "NotPermitted" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Unauthorized", "You don't have permission to delete this workspace."),
				}),
			),
			Scene.expect(confirmInput).toHaveValue("Hazel Labs"),
			Scene.expect(confirmDelete).toBeEnabled(),
		)
	})

	test("only the owner can open the dialog", () => {
		const admin = makeShared({ member: memberWithRole("admin") })
		Scene.scene(
			pageScene(update, view, admin),
			Scene.given(initialModel(admin)),
			Scene.expect(Scene.text("Danger Zone")).toBeAbsent(),
		)
	})
})

describe("export data", () => {
	const exportId = "6f1c1b62-3e1f-4f6e-8f0a-9a1d2c3b4e5f" as OrganizationExportId
	const exportRow = (overrides: Partial<OrganizationExport.Type> = {}): OrganizationExport.Type => ({
		id: exportId,
		organizationId,
		requestedBy: "1d2c3b4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e" as OrganizationExport.Type["requestedBy"],
		status: "ready",
		channelCount: 4,
		channelsDone: 4,
		partCount: 2,
		rowCount: 1234,
		byteSize: 2048,
		error: null,
		createdAt: new Date(owner.nowMs - 60_000),
		updatedAt: null,
		completedAt: new Date(owner.nowMs - 30_000),
		expiresAt: new Date(owner.nowMs + 86_400_000),
		...overrides,
	})

	test("an admin starts an export", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(initialModel()),
			Scene.click(Scene.role("button", { name: "Export data" })),
			Scene.Command.expectExact(StartOrganizationExport({ organizationId })),
			Scene.expect(Scene.role("button", { name: "Starting..." })).toBeDisabled(),
			Scene.Command.resolve(StartOrganizationExport, Message.SucceededStartExport()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: successToast("Export started", "It is ready to download here when it finishes."),
				}),
			),
		)
	})

	test("a running export shows its progress and blocks another", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given({
				...initialModel(),
				exports: [
					exportRow({ status: "running", channelsDone: 1, completedAt: null, expiresAt: null }),
				],
			}),
			Scene.expect(Scene.role("button", { name: "Export data" })).toBeDisabled(),
			Scene.expect(Scene.role("progressbar", { name: "Export progress" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Download" })).toBeAbsent(),
		)
	})

	test("a ready export downloads through a signed link", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given({ ...initialModel(), exports: [exportRow()] }),
			Scene.click(Scene.role("button", { name: "Download" })),
			Scene.Command.expectExact(DownloadOrganizationExport({ organizationId, exportId })),
			Scene.Command.resolve(
				DownloadOrganizationExport,
				Message.FailedDownloadExport({ reason: "Expired" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast(
						"Export expired",
						"Exports can be downloaded for 7 days. Start a new one.",
					),
				}),
			),
		)
	})

	test("members don't see the card", () => {
		const member = makeShared({ member: memberWithRole("member") })
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(initialModel(member)),
			Scene.expect(Scene.role("button", { name: "Export data" })).toBeAbsent(),
		)
	})
})
