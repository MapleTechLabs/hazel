// @vitest-environment jsdom
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToast, successToast } from "../../../data/actions"
import { failureToastFixture, makeShared, organization, organizationId, storyUpdate } from "../../../test/pages-fixtures"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Model } from "./model"
import {
	DeleteOrganization,
	init,
	LeaveDeletedWorkspace,
	OpenLogoPicker,
	SetPublicMode,
	sharedChanged,
	update,
	UpdateOrganizationName,
	UploadLogo,
} from "./update"

/** Update-loop tests for the general settings page: name drafts, logo, public mode and the delete flow. */

const route = { _tag: "SettingsGeneral", orgSlug: "hazel" } as const
const owner = makeShared()
const withName = (name: string): Shared => makeShared({ organization: { ...organization, name } })
const initial: Model = init(route, owner).model
const logo = new File(["png"], "logo.png", { type: "image/png" })

describe("organization name", () => {
	test("an unchanged or blank name is not saved", () => {
		story<Model, Message, PageOutMessage>(storyUpdate(update, owner), given(initial), message(Message.SubmittedName()), Command.expectNone())
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ChangedName({ value: "   " })),
			message(Message.SubmittedName()),
			Command.expectNone(),
		)
	})

	test("a changed name is trimmed, saved once, and a second submit while saving is ignored", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ChangedName({ value: " Hazel HQ " })),
			message(Message.SubmittedName()),
			Command.expectExact(UpdateOrganizationName({ organizationId, name: "Hazel HQ" })),
			Command.resolve(UpdateOrganizationName, Message.SucceededUpdateName()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Organization name updated") })),
			model((current) => expect(current.isSavingName).toBe(false)),
		)
		const saving = update(
			{ ...initial, name: "Hazel HQ", isSavingName: true },
			Message.SubmittedName(),
			owner,
		)
		expect(saving.commands ?? []).toHaveLength(0)
	})

	test("a failed save clears the saving flag and forwards the failure toast", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given({ ...initial, name: "Hazel HQ" }),
			message(Message.SubmittedName()),
			Command.resolve(UpdateOrganizationName, Message.FailedUpdateName({ toast: failureToastFixture })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			model((current) => expect(current).toMatchObject({ isSavingName: false, name: "Hazel HQ" })),
		)
	})

	test("a new server name replaces the draft, an unchanged one keeps it", () => {
		const draft: Model = { ...initial, name: "draft" }
		expect(sharedChanged(draft, withName("Hazel HQ")).model).toMatchObject({ name: "Hazel HQ", syncedName: "Hazel HQ" })
		expect(sharedChanged(draft, owner).model.name).toBe("draft")
	})
})

describe("logo", () => {
	test("clicking opens the picker; a picked file uploads and toasts", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ClickedLogo()),
			Command.resolve(OpenLogoPicker, Message.CompletedOpenLogoPicker()),
			expectNoOutMessage(),
			message(Message.SelectedLogo({ files: [logo] })),
			// Matched by name: structural equality cannot compare a jsdom File.
			Command.expectExact(UploadLogo),
			model((current) => expect(current.isUploading).toBe(true)),
			Command.resolve(UploadLogo, Message.SucceededUploadLogo()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Organization logo updated") })),
			model((current) => expect(current.isUploading).toBe(false)),
		)
	})

	test("a failed upload clears the uploading flag and toasts; an empty pick does nothing", () => {
		const toast = errorToast("Upload failed", "Failed to update organization. Please try again.")
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.SelectedLogo({ files: [] })),
			Command.expectNone(),
			message(Message.SelectedLogo({ files: [logo] })),
			Command.resolve(UploadLogo, Message.FailedUploadLogo({ toast })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
			model((current) => expect(current.isUploading).toBe(false)),
		)
	})
})

describe("public mode", () => {
	test("a failed toggle clears the pending flag and leaves isPublic to the live row", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ToggledPublicMode({ isPublic: true })),
			Command.expectExact(SetPublicMode({ organizationId, isPublic: true })),
			Command.resolve(SetPublicMode, Message.FailedSetPublicMode({ toast: failureToastFixture })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			model((current) => expect(current).toMatchObject({ isTogglingPublic: false, isPublic: false })),
		)
	})

	test("nothing is sent before the organization is known", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, makeShared({ organization: null })),
			given(initial),
			message(Message.ToggledPublicMode({ isPublic: true })),
			Command.expectNone(),
		)
	})
})

describe("delete workspace", () => {
	test("confirming needs the exact organization name", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ClickedDeleteWorkspace()),
			message(Message.ChangedConfirmation({ value: "Hazel" })),
			message(Message.ClickedConfirmDelete()),
			Command.expectNone(),
			message(Message.ChangedConfirmation({ value: "Hazel Labs" })),
			message(Message.ClickedConfirmDelete()),
			Command.expectExact(DeleteOrganization({ organizationId })),
			Command.resolve(DeleteOrganization, Message.SucceededDeleteWorkspace()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Workspace deleted successfully") })),
			model((current) => expect(current).toMatchObject({ confirmationText: "", deleteModal: { isOpen: false } })),
			Command.resolve(LeaveDeletedWorkspace, Message.CompletedLeaveDeletedWorkspace()),
			expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/", replace: false })),
		)
	})

	test("closing the modal clears the confirmation", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ClickedDeleteWorkspace()),
			message(Message.ChangedConfirmation({ value: "Hazel" })),
			message(Message.ClickedCancelDelete()),
			model((current) => expect(current).toMatchObject({ confirmationText: "", deleteModal: { isOpen: false } })),
		)
	})
})
