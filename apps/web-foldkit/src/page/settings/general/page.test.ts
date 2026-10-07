// @vitest-environment jsdom
import { OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { sharedChanged, update } from "./update"
import { sharedDefaults } from "../../test-shared"

/** Update-loop tests for the general settings page: name drafts, saves and the delete flow. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))

const shared = (name: string, role: "owner" | "admin" | "member" = "owner"): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: organizationId, name, slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(2)), role },
	nowMs: 0,
	...sharedDefaults,
})

const model = (name: string): Model => ({
	orgSlug: "hazel",
	origin: "http://localhost",
	name,
	syncedName: "Hazel Labs",
	isPublic: false,
	isSavingName: false,
	isTogglingPublic: false,
	isUploading: false,
	deleteModal: { id: "delete-workspace", isOpen: false },
	confirmationText: "",
	isDeleting: false,
})

const commandNames = (result: { readonly commands?: ReadonlyArray<{ readonly name: string }> }) =>
	(result.commands ?? []).map((command) => command.name)

describe("organization name", () => {
	test("an unchanged or blank name is not saved", () => {
		expect(commandNames(update(model("Hazel Labs"), Message.SubmittedName(), shared("Hazel Labs")))).toEqual([])
		expect(commandNames(update(model("   "), Message.SubmittedName(), shared("Hazel Labs")))).toEqual([])
	})

	test("a changed name is trimmed and saved once", () => {
		const result = update(model(" Hazel HQ "), Message.SubmittedName(), shared("Hazel Labs"))
		expect(result.model.isSavingName).toBe(true)
		expect(result.commands?.[0]).toMatchObject({
			name: "UpdateOrganizationName",
			args: { organizationId, name: "Hazel HQ" },
		})
		expect(commandNames(update(result.model, Message.SubmittedName(), shared("Hazel Labs")))).toEqual([])
	})

	test("a new server name replaces the draft", () => {
		const result = sharedChanged(model("draft"), shared("Hazel HQ"))
		expect(result.model).toMatchObject({ name: "Hazel HQ", syncedName: "Hazel HQ" })
		expect(sharedChanged(model("draft"), shared("Hazel Labs")).model.name).toBe("draft")
	})
})

describe("delete workspace", () => {
	test("deleting needs the exact organization name", () => {
		const open = update(model("Hazel Labs"), Message.ClickedDeleteWorkspace(), shared("Hazel Labs")).model
		expect(open.deleteModal.isOpen).toBe(true)
		const typed = update(open, Message.ChangedConfirmation({ value: "Hazel" }), shared("Hazel Labs")).model
		expect(commandNames(update(typed, Message.ClickedConfirmDelete(), shared("Hazel Labs")))).toEqual([])
		const confirmed = update(open, Message.ChangedConfirmation({ value: "Hazel Labs" }), shared("Hazel Labs"))
		expect(commandNames(update(confirmed.model, Message.ClickedConfirmDelete(), shared("Hazel Labs")))).toEqual([
			"DeleteOrganization",
		])
	})

	test("closing the modal clears the confirmation", () => {
		const open = update(model("Hazel Labs"), Message.ClickedDeleteWorkspace(), shared("Hazel Labs")).model
		const typed = update(open, Message.ChangedConfirmation({ value: "Hazel" }), shared("Hazel Labs")).model
		const closed = update(typed, Message.ClickedCancelDelete(), shared("Hazel Labs")).model
		expect(closed).toMatchObject({ confirmationText: "", deleteModal: { isOpen: false } })
	})

	test("success toasts, then navigates home", () => {
		const result = update(model("Hazel Labs"), Message.SucceededDeleteWorkspace(), shared("Hazel Labs"))
		expect(result.outMessage).toMatchObject({ _tag: "RequestedToast" })
		expect(commandNames(result)).toEqual(["LeaveDeletedWorkspace"])
		const next = update(result.model, Message.CompletedLeaveDeletedWorkspace(), shared("Hazel Labs"))
		expect(next.outMessage).toMatchObject({ _tag: "RequestedNavigation", href: "/" })
	})
})
