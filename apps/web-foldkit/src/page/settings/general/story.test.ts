// @vitest-environment jsdom
import { routeOfPath } from "../../../route"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import * as Modal from "../../../ui/modal"
import * as ConfirmAction from "../../shared/confirm-action"
import { errorToast, reasonToast, successToast } from "../../../data/actions"
import { makeShared, organization, organizationId, storyUpdate } from "../../../test/pages-fixtures"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { LogoUpload, type Model, NameSave, PublicModeSave, type UploadLogoFailure } from "./model"
import {
	DeleteOrganization,
	init,
	OpenLogoPicker,
	ReadOrigin,
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

describe("init", () => {
	test("reads the origin through a Command, not during init", () => {
		const result = init(route, owner)
		expect(result.model.origin).toBe("")
		expect(result.commands?.map((command) => command.name)).toEqual([ReadOrigin.name])
		const read = update(result.model, Message.ResolvedOrigin({ origin: "http://localhost:3000" }), owner)
		expect(read.model.origin).toBe("http://localhost:3000")
	})
})

describe("organization name", () => {
	test("an unchanged or blank name is not saved", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.SubmittedName()),
			Command.expectNone(),
		)
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
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Organization name updated") }),
			),
			model((current) => expect(current.nameSave).toEqual(NameSave.Idle())),
		)
		const saving = update(
			{ ...initial, name: "Hazel HQ", nameSave: NameSave.Saving() },
			Message.SubmittedName(),
			owner,
		)
		expect(saving.commands ?? []).toHaveLength(0)
	})

	test("a failed save goes back to idle, keeps the draft and toasts the reason's copy", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given({ ...initial, name: "Hazel HQ" }),
			message(Message.SubmittedName()),
			Command.resolve(UpdateOrganizationName, Message.FailedUpdateName({ reason: "Offline" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
			model((current) =>
				expect(current).toMatchObject({ nameSave: NameSave.Idle(), name: "Hazel HQ" }),
			),
		)
		expect(
			update({ ...initial, name: "Hazel HQ" }, Message.FailedUpdateName({ reason: "SlugTaken" }), owner)
				.outMessage,
		).toMatchObject({
			toast: errorToast("Slug already exists", "This organization slug is already taken."),
		})
	})

	test("a new server name replaces the draft, an unchanged one keeps it", () => {
		const draft: Model = { ...initial, name: "draft" }
		expect(sharedChanged(draft, withName("Hazel HQ")).model).toMatchObject({
			name: "Hazel HQ",
			syncedName: "Hazel HQ",
		})
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
			model((current) => expect(current.logoUpload).toEqual(LogoUpload.Uploading())),
			Command.resolve(UploadLogo, Message.SucceededUploadLogo()),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Organization logo updated") }),
			),
			model((current) => expect(current.logoUpload).toEqual(LogoUpload.Idle())),
		)
	})

	test("a file picked while an upload runs is ignored", () => {
		const uploading: Model = { ...initial, logoUpload: LogoUpload.Uploading() }
		expect(update(uploading, Message.SelectedLogo({ files: [logo] }), owner).commands ?? []).toHaveLength(
			0,
		)
	})

	test("a failed upload goes back to idle and toasts; an empty pick does nothing", () => {
		const toast = errorToast("File too large", "File size must be less than 5MB")
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.SelectedLogo({ files: [] })),
			Command.expectNone(),
			message(Message.SelectedLogo({ files: [logo] })),
			Command.resolve(UploadLogo, Message.FailedUploadLogo({ reason: "TooLarge" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
			model((current) => expect(current.logoUpload).toEqual(LogoUpload.Idle())),
		)
	})

	test("upload problems and organization errors each get their own copy, not a generic one", () => {
		const toastFor = (reason: UploadLogoFailure) =>
			update(initial, Message.FailedUploadLogo({ reason }), owner).outMessage
		expect(toastFor("NotConfigured")).toMatchObject({ toast: { title: "Configuration error" } })
		expect(toastFor("StorageOffline")).toMatchObject({ toast: { title: "Upload failed" } })
		expect(toastFor("NotFound")).toMatchObject({
			toast: errorToast("Organization not found", "This organization may have been deleted."),
		})
		expect(toastFor("SignedOut")).toMatchObject({ toast: reasonToast("SignedOut") })
	})
})

describe("public mode", () => {
	test("a failed toggle clears the pending flag and leaves isPublic to the live row", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ToggledPublicMode({ isPublic: true })),
			Command.expectExact(SetPublicMode({ organizationId, isPublic: true })),
			model((current) =>
				expect(current.publicModeSave).toEqual(PublicModeSave.Saving({ isPublic: true })),
			),
			Command.resolve(SetPublicMode, Message.FailedSetPublicMode({ reason: "Unexpected" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Unexpected") })),
			model((current) =>
				expect(current).toMatchObject({ publicModeSave: PublicModeSave.Idle(), isPublic: false }),
			),
		)
	})

	test("a second toggle while one runs sends nothing", () => {
		const toggling: Model = { ...initial, publicModeSave: PublicModeSave.Saving({ isPublic: false }) }
		expect(
			update(toggling, Message.ToggledPublicMode({ isPublic: true }), owner).commands ?? [],
		).toHaveLength(0)
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
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/"),
					replace: false,
					toast: successToast("Workspace deleted successfully"),
				}),
			),
			model((current) =>
				expect(current).toMatchObject({
					confirmationText: "",
					deleteConfirm: { state: { _tag: "Closed" }, modal: { isOpen: false } },
				}),
			),
		)
	})

	test("a second confirm while deleting sends nothing", () => {
		const asking = ConfirmAction.ask(initial.deleteConfirm, { organizationId })
		const deleting: Model = {
			...initial,
			deleteConfirm: Option.getOrThrow(ConfirmAction.confirm(asking))[0],
			confirmationText: "Hazel Labs",
		}
		expect(update(deleting, Message.ClickedConfirmDelete(), owner).commands ?? []).toHaveLength(0)
	})

	test("closing the modal clears the confirmation", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ClickedDeleteWorkspace()),
			message(Message.ChangedConfirmation({ value: "Hazel" })),
			message(Message.ClickedCancelDelete()),
			model((current) =>
				expect(current).toMatchObject({
					confirmationText: "",
					deleteConfirm: { state: { _tag: "Closed" }, modal: { isOpen: false } },
				}),
			),
			message(Message.ClickedDeleteWorkspace()),
			model((current) => expect(current.confirmationText).toBe("")),
		)
	})

	test("dismissing the dialog (Escape, backdrop) also clears the confirmation", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, owner),
			given(initial),
			message(Message.ClickedDeleteWorkspace()),
			message(Message.ChangedConfirmation({ value: "Hazel" })),
			message(
				Message.GotDeleteConfirmMessage({
					message: ConfirmAction.toModalMessage(Modal.Message.RequestedClose()),
				}),
			),
			model((current) =>
				expect(current).toMatchObject({
					confirmationText: "",
					deleteConfirm: { state: { _tag: "Closed" } },
				}),
			),
		)
	})
})
