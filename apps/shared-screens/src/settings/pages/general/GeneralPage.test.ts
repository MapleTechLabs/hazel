// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { OrganizationExportId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Leave, Navigate, ShowToast } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { button, byProp, orgId, sessionAs } from "../../testing"
import {
	CopyLink,
	DeleteOrganization,
	GetExportLink,
	PickLogo,
	RenameOrganization,
	SetPublicMode,
	UploadLogo,
} from "./commands"
import { exportDetail, formatBytes } from "./ExportCard"
import { GeneralPageNoDeps } from "./GeneralPage"
import { type ExportRow, GeneralMessage } from "./model"

/** The general settings: the profile, public invites, exports and the danger zone, by role. */

const ORGANIZATION = `organization:"${orgId}"`
const EXPORTS = `exports:"${orgId}"`

const start = (session: Session = sessionAs("owner")) =>
	Scene.start(GeneralPageNoDeps, {
		session,
		orgSlug: "hazel",
		origin: "https://app.hazel.sh",
		nowMs: Date.UTC(2026, 10, 26),
	})

/** The settings card whose text includes `title`. */
const card = (title: string): Locator.Locator => ({
	description: `<hz:frame> with "${title}"`,
	all: (root) =>
		Locator.all(root, Locator.tag("hz:frame")).filter((node) => Locator.textOf(node).includes(title)),
})
const field = (label: string) => byProp("textField", "label", label)
const typed = (value: string, edit = 1) => ({ value, rev: 0, edit })

const exportRow = (overrides: Partial<ExportRow>): ExportRow => ({
	id: OrganizationExportId.make("00000008-0000-4000-8000-000000000001"),
	status: "ready",
	createdAtMs: Date.UTC(2026, 10, 25),
	expiresAtMs: Date.UTC(2026, 11, 2),
	channelCount: 12,
	channelsDone: 12,
	rowCount: 48210,
	byteSize: 3_481_600,
	error: null,
	...overrides,
})

const success = (title: string, description: string | null = null) =>
	ShowToast.make({ toast: { intent: "success", title, description } })

describe("general settings", () => {
	test("the cards follow the role: members see only the profile, read-only", () => {
		const member = start(sessionAs("member"))
		expect(member.all(Locator.tag("hz:frame"))).toHaveLength(1)
		expect(member.get(field("Organization name")).props?.["disabled"]).toBe(true)
		expect(start(sessionAs("admin")).all(Locator.tag("hz:frame"))).toHaveLength(3)
		expect(start(sessionAs("owner")).all(Locator.tag("hz:frame"))).toHaveLength(4)
	})

	test("a changed name offers Save, and saving renames once", () => {
		const s = start()
			.expect(button("Save changes"))
			.toBeAbsent()
			.fire(field("Organization name"), "change", typed("Hazel Labs"))
			.fire(button("Save changes"), "press")
			.expectExact(RenameOrganization.make({ organizationId: orgId, name: "Hazel Labs" }))
		expect(s.get(button("Saving...")).props?.["disabled"]).toBe(true)
		s.resolve(RenameOrganization, GeneralMessage.SucceededRename())
			.expectExact(success("Organization name updated"))
			.resolve(ShowToast, Component.noop)
	})

	test("a new name from the server replaces the draft; Cancel restores it", () => {
		const s = start()
			.fire(field("Organization name"), "change", typed("Draft"))
			.fire(Locator.inside(card("Organization profile"), button("Cancel")), "press")
		expect(s.get(field("Organization name")).props?.["value"]).toMatchObject({ text: "Hazel" })
		s.subscription(ORGANIZATION, GeneralMessage.UpdatedOrganization({ name: "Hazel HQ", isPublic: true }))
			.expect(byProp("toggle", "checked", true))
			.toExist()
		expect(s.get(field("Organization name")).props?.["value"]).toMatchObject({ text: "Hazel HQ" })
	})

	test("the logo picks, checks and uploads; a wrong file never uploads", () => {
		const image = { id: "image-1", name: "logo.png", type: "image/png", size: 1024 }
		start()
			.fire(byProp("avatar", "name", "Hazel"), "press")
			.expectExact(PickLogo.make({}))
			.resolve(PickLogo, GeneralMessage.PickedLogo({ image: { ...image, type: "image/gif" } }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Invalid file type",
						description: "Please select a JPEG, PNG, or WebP image",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
			.fire(byProp("avatar", "name", "Hazel"), "press")
			.resolve(PickLogo, GeneralMessage.PickedLogo({ image }))
			.expectExact(UploadLogo.make({ organizationId: orgId, image }))
			.expect(Locator.text("Uploading..."))
			.toExist()
			.resolve(UploadLogo, GeneralMessage.FailedUploadLogo({ reason: "TooLarge" }))
			.expectHas(ShowToast)
			.resolve(ShowToast, Component.noop)
	})

	test("public invites switch on and show the link to copy", () => {
		start()
			.fire(byProp("toggle", "label", "Enable public invite link"), "change", { checked: true })
			.expectExact(SetPublicMode.make({ organizationId: orgId, isPublic: true }))
			.resolve(SetPublicMode, GeneralMessage.SucceededSetPublic({ isPublic: true }))
			.expectExact(success("Public invites enabled"))
			.resolve(ShowToast, Component.noop)
			.subscription(ORGANIZATION, GeneralMessage.UpdatedOrganization({ name: "Hazel", isPublic: true }))
			.fire(Locator.inside(byProp("stack", "key", "public:row"), button("Copy")), "press")
			.expectExact(CopyLink.make({ target: "InviteLink", text: "https://app.hazel.sh/join/hazel" }))
			.resolve(CopyLink, GeneralMessage.FailedCopy({ target: "InviteLink" }))
			.expectExact(
				ShowToast.make({
					toast: { intent: "error", title: "Failed to copy link", description: null },
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("deleting asks for the workspace's name, then leaves it", () => {
		const s = start().fire(Locator.inside(card("Danger zone"), button("Delete workspace")), "press")
		expect(s.get(Locator.tag("hz:dialog")).props?.["open"]).toBe(true)
		const confirm = Locator.inside(Locator.tag("hz:dialog"), button("Delete workspace"))
		expect(s.get(confirm).props?.["disabled"]).toBe(true)
		s.fire(field("Type Hazel to confirm"), "change", typed("Hazel", 0))
			.fire(confirm, "press")
			.expectExact(DeleteOrganization.make({ organizationId: orgId }))
			.resolve(DeleteOrganization, GeneralMessage.SucceededDelete())
			.expectExact(
				Navigate.make({
					href: "/",
					replace: false,
					toast: { intent: "success", title: "Workspace deleted successfully", description: null },
				}),
			)
			.resolve(Navigate, Component.noop)
		expect(s.get(Locator.tag("hz:dialog")).props?.["open"]).toBeUndefined()
	})

	test("a ready export downloads through the app", () => {
		const row = exportRow({})
		start()
			.subscription(EXPORTS, GeneralMessage.UpdatedExports({ exports: [row] }))
			.fire(button("Download"), "press")
			.expectExact(GetExportLink.make({ organizationId: orgId, exportId: row.id }))
			.resolve(
				GetExportLink,
				GeneralMessage.SucceededExportLink({ url: "https://files.hazel.test/export.zip" }),
			)
			.expectExact(Leave.make({ href: "https://files.hazel.test/export.zip" }))
			.resolve(Leave, Component.noop)
	})

	test("an export's line says how far it got", () => {
		const now = Date.UTC(2026, 10, 26)
		expect(exportDetail(exportRow({}), now)).toBe(`${(48210).toLocaleString()} records · 3.3 MB`)
		expect(exportDetail(exportRow({ expiresAtMs: now - 1 }), now)).toBe("No longer available")
		expect(exportDetail(exportRow({ status: "running", channelsDone: 3 }), now)).toContain(
			"3 of 12 channels",
		)
		expect(formatBytes(512)).toBe("512 B")
	})
})
