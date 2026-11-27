// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings` (`web-foldkit/src/page/settings/general`, now deleted): the workspace's name,
 * logo and URL, its public invite link, data exports (owners and admins) and the danger zone.
 */
import { Component, Subscription } from "@effect/ui"
import { eq } from "@tanstack/db"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Layer } from "effect"
import { withData } from "../../../app/live"
import { LoadPage, Navigate, ShowToast } from "../../../app/requests"
import type { SessionOrganization } from "../../../app/session"
import { copyOf, type ErrorCopy, errorToast, successToast } from "../../../modals/feedback"
import { cardBody, settingsCard, settingsColumn } from "../../shared/card"
import { isUploadProblem, uploadProblemMessage, validateUploadFile } from "../../shared/upload"
import {
	CopyLink,
	DeleteOrganization,
	GetExportLink,
	generalCommandsLayer,
	PickLogo,
	RenameOrganization,
	SetPublicMode,
	StartExport,
	UploadLogo,
} from "./commands"
import { exportCard, exportsStream } from "./ExportCard"
import {
	type CopyTarget,
	GeneralMessage,
	GeneralModel,
	GeneralProps,
	isAdmin,
	type UploadLogoFailure,
} from "./model"

const organizationNotFound: ErrorCopy = {
	title: "Organization not found",
	description: "This organization may have been deleted.",
}
const slugTaken: ErrorCopy = {
	title: "Slug already exists",
	description: "This organization slug is already taken.",
}

const uploadLogoCopy = (reason: UploadLogoFailure): ErrorCopy =>
	isUploadProblem(reason)
		? uploadProblemMessage("avatar", reason)
		: copyOf(reason, { NotFound: organizationNotFound, SlugTaken: slugTaken })

const exportCopy = {
	InProgress: {
		title: "An export is already running",
		description: "Wait for it to finish before starting another one.",
	},
	NotPermitted: {
		title: "Not allowed",
		description: "Only owners and admins can export the workspace's data.",
	},
	NotFound: { title: "Export not found", description: "It may have been removed." },
	NotReady: { title: "Export not ready", description: "It is still being prepared." },
	Failed: { title: "Export failed", description: "Start a new export." },
	Expired: {
		title: "Export expired",
		description: "Exports can be downloaded for 7 days. Start a new one.",
	},
}

const COPIED = {
	WorkspaceUrl: { success: "Workspace URL copied to clipboard", failure: "Failed to copy URL" },
	InviteLink: { success: "Invite link copied to clipboard", failure: "Failed to copy link" },
} satisfies Record<CopyTarget, { readonly success: string; readonly failure: string }>

const toast = (title: string, description?: string) =>
	ShowToast.make({ toast: { ...successToast(title), description: description ?? null } })
const failure = (copy: ErrorCopy) => ShowToast.make({ toast: errorToast(copy) })

const GeneralDef = Hazel.component({
	name: "GeneralPage",
	props: GeneralProps,
	model: GeneralModel,
	message: GeneralMessage,
	// After Back, writes that were in flight are not running any more.
	restore: (model) => ({
		...model,
		renaming: false,
		uploadingLogo: false,
		savingPublic: null,
		deleting: false,
		startingExport: false,
		downloadingExportId: null,
	}),
})

type H = Parameters<Parameters<typeof GeneralDef.make>[0]["view"]>[0]

/** A read-only link with its Copy button. */
const copyRow = (h: H, key: string, url: string, target: CopyTarget) =>
	h.stack
		.key(key)
		.axis("horizontal")
		.align("center")
		.density("compact")
		.children(
			// HAZEL-GAP(p4-code-box): today the link sits in a muted code box (`bg-bg-muted/30`, mono 14px).
			h.textField.readOnly().monospace().value({ text: url, rev: 0, edit: 0 }),
			h.button
				.label("Copy")
				.icon("copy")
				.variant("secondary")
				.on("press", GeneralMessage.PressedCopy({ target, text: url })),
		)

const profileCard = (h: H, model: GeneralModel, organization: SessionOrganization) => {
	const { session } = h.props
	const admin = isAdmin(session)
	const permissionsLoading = session.member === null
	const logoDisabled = model.uploadingLogo || permissionsLoading || !admin
	const nameDisabled = model.renaming || permissionsLoading || !admin
	const dirty = admin && model.name.text !== organization.name && model.name.text.trim() !== ""
	const workspaceUrl = `${h.props.origin}/${h.props.orgSlug}`
	const logo = h.avatar
		.name(organization.name)
		.src(organization.logoUrl ?? undefined)
		.size("xlarge")
		.corners("square")
	return settingsCard(
		h,
		"general:profile",
		{
			icon: "office",
			title: "Organization profile",
			subtitle: "Manage your organization's name and appearance.",
		},
		cardBody(
			h,
			h.stack
				.key("logo")
				.density("compact")
				.children(
					h.text.children("Organization logo"),
					// HAZEL-GAP(p4-avatar-upload): today's logo is a 64px button with an edit glyph over a
					// scrim on hover (always on phones) and a disabled look; `avatar` has `press` only.
					h.stack
						.axis("horizontal")
						.align("center")
						.children(
							logoDisabled ? logo : logo.on("press", GeneralMessage.PressedLogo()),
							h.stack.density("tight").children(
								h.text
									.role("label")
									.strong()
									.children(model.uploadingLogo ? "Uploading..." : "Click to upload"),
								h.text.role("caption").tone("muted").children("JPG, PNG or WebP. Max 5MB."),
							),
						),
				),
			// HAZEL-GAP(p4-field-width): today's name field is capped at 448px (`max-w-md`).
			h.textField
				.key("name")
				.label("Organization name")
				.placeholder("Enter organization name")
				.description("This is the display name for your organization.")
				.value(model.name)
				.disabled(nameDisabled)
				.on("change", (payload) => GeneralMessage.ChangedName({ payload }))
				.on("submit", () => GeneralMessage.SubmittedName())
				.on("blur", () => GeneralMessage.SubmittedName()),
			dirty
				? h.stack
						.key("name:actions")
						.axis("horizontal")
						.density("compact")
						.children(
							h.button
								.label(model.renaming ? "Saving..." : "Save changes")
								.size("small")
								.disabled(model.renaming)
								.on("press", GeneralMessage.SubmittedName()),
							h.button
								.label("Cancel")
								.variant("secondary")
								.size("small")
								.disabled(model.renaming)
								.on("press", GeneralMessage.PressedCancelName()),
						)
				: null,
			h.stack
				.key("url")
				.density("compact")
				.children(
					h.text.children("Workspace URL"),
					copyRow(h, "url:row", workspaceUrl, "WorkspaceUrl"),
					h.text
						.tone("muted")
						.children("This is your workspace's unique URL. Share it with your team."),
				),
		),
	)
}

const publicInviteCard = (h: H, model: GeneralModel) => {
	const { session } = h.props
	const inviteUrl = `${h.props.origin}/join/${h.props.orgSlug}`
	return settingsCard(
		h,
		"general:public",
		{
			icon: "share",
			title: "Public invite link",
			subtitle: "Allow anyone with the link to join your workspace.",
		},
		cardBody(
			h,
			// HAZEL-GAP(p4-toggle-label): today's switch label is regular weight; the toggle's is medium.
			h.toggle
				.key("public")
				.label("Enable public invite link")
				.checked(model.isPublic)
				.disabled(model.savingPublic !== null || session.member === null || !isAdmin(session))
				.on("change", ({ checked }) => GeneralMessage.ToggledPublic({ checked })),
			model.isPublic
				? h.stack
						.key("public:link")
						.density("compact")
						.children(
							h.text
								.role("label")
								.tone("muted")
								.children("Anyone with this link can join your workspace as a member."),
							copyRow(h, "public:row", inviteUrl, "InviteLink"),
						)
				: null,
		),
	)
}

const dangerCard = (h: H) => {
	const { member } = h.props.session
	return settingsCard(
		h,
		"general:danger",
		{
			icon: "warning",
			title: "Danger zone",
			subtitle: "Irreversible and destructive actions for this workspace.",
		},
		cardBody(
			h,
			h.stack
				.axis("horizontal")
				.align("center")
				.density("cozy")
				.children(
					h.stack
						.density("tight")
						.children(
							h.text.role("label").strong().children("Delete this workspace"),
							h.text
								.role("label")
								.tone("muted")
								.children(
									"Once deleted, all data including channels, messages, and members will be permanently removed.",
								),
						),
					h.spacer,
					h.button
						.label("Delete workspace")
						.variant("danger")
						.disabled(member === null || member.role !== "owner")
						.on("press", GeneralMessage.PressedDelete()),
				),
		),
	)
}

// HAZEL-GAP(p4-dialog-rich-text): today's description and field label set the workspace name and
// "cannot be undone" in bold; `dialog.description` and `textField.label` are plain text.
const deleteDialog = (h: H, model: GeneralModel, organization: SessionOrganization) =>
	h.dialog
		.key("general:delete")
		.open(model.deleteOpen)
		.destructive()
		.title("Delete workspace")
		.description(
			`This action cannot be undone. This will permanently delete the workspace ${organization.name}, all channels, messages, and remove all member access.`,
		)
		.on("dismiss", GeneralMessage.DismissedDelete())
		.children(
			h.textField
				.label(`Type ${organization.name} to confirm`)
				.placeholder(organization.name)
				.value(model.confirmation)
				.on("change", (payload) => GeneralMessage.ChangedConfirmation({ payload })),
		)
		.actions(
			h.button
				.label("Cancel")
				.variant("outline")
				.disabled(model.deleting)
				.on("press", GeneralMessage.DismissedDelete()),
			h.button
				.label(model.deleting ? "Deleting..." : "Delete workspace")
				.variant("danger")
				.loading(model.deleting)
				.disabled(model.confirmation.text !== organization.name || model.deleting)
				.on("press", GeneralMessage.PressedConfirmDelete()),
		)

export const GeneralPageNoDeps = GeneralDef.make({
	init: ($) => {
		const name = $.props.session.organization?.name ?? null
		return $.set({
			name: TextField.set(TextField.empty, name ?? ""),
			syncedName: name,
			isPublic: false,
			renaming: false,
			uploadingLogo: false,
			savingPublic: null,
			deleteOpen: false,
			deleting: false,
			confirmation: TextField.empty,
			exports: [],
			startingExport: false,
			downloadingExportId: null,
		})
	},
	update: {
		// A new server name replaces the draft (today's `sharedChanged`).
		UpdatedOrganization: ($, { name, isPublic }) =>
			name === $.model.syncedName
				? $.evolve({ isPublic: () => isPublic })
				: $.evolve({
						isPublic: () => isPublic,
						syncedName: () => name,
						name: (draft) => (name === "" ? draft : TextField.set(draft, name)),
					}),
		UpdatedExports: ($, { exports }) => $.evolve({ exports: () => exports }),
		ChangedName: ($, { payload }) => $.evolve({ name: (name) => TextField.changed(name, payload) }),
		SubmittedName: ($) => {
			const organization = $.props.session.organization
			const name = $.model.name.text.trim()
			if (
				organization === null ||
				name === "" ||
				$.model.name.text === organization.name ||
				$.model.renaming
			)
				return $.model
			return $.set({ ...$.model, renaming: true }).run(
				RenameOrganization.make({ organizationId: organization.id, name }),
			)
		},
		PressedCancelName: ($) =>
			$.evolve({ name: (name) => TextField.set(name, $.props.session.organization?.name ?? "") }),
		SucceededRename: ($) =>
			$.set({ ...$.model, renaming: false }).run(toast("Organization name updated")),
		FailedRename: ($, { reason }) =>
			$.set({ ...$.model, renaming: false }).run(
				failure(copyOf(reason, { NotFound: organizationNotFound, SlugTaken: slugTaken })),
			),
		PressedLogo: ($) => ($.model.uploadingLogo ? $.model : $.run(PickLogo.make({}))),
		PickedLogo: ($, { image }) => {
			const organization = $.props.session.organization
			if (image === null || organization === null || $.model.uploadingLogo) return $.model
			// The file check runs here too, so a wrong file never shows "Uploading...".
			const invalid = validateUploadFile("avatar", image)
			if (invalid !== null) return $.run(failure(uploadProblemMessage("avatar", invalid)))
			return $.set({ ...$.model, uploadingLogo: true }).run(
				UploadLogo.make({ organizationId: organization.id, image }),
			)
		},
		SucceededUploadLogo: ($) =>
			$.set({ ...$.model, uploadingLogo: false }).run(toast("Organization logo updated")),
		FailedUploadLogo: ($, { reason }) =>
			$.set({ ...$.model, uploadingLogo: false }).run(failure(uploadLogoCopy(reason))),
		ToggledPublic: ($, { checked }) => {
			const organization = $.props.session.organization
			if (organization === null || $.model.savingPublic !== null) return $.model
			return $.set({ ...$.model, savingPublic: checked }).run(
				SetPublicMode.make({ organizationId: organization.id, isPublic: checked }),
			)
		},
		SucceededSetPublic: ($, { isPublic }) =>
			$.set({ ...$.model, savingPublic: null }).run(
				toast(isPublic ? "Public invites enabled" : "Public invites disabled"),
			),
		FailedSetPublic: ($, { reason }) =>
			$.set({ ...$.model, savingPublic: null }).run(
				failure(copyOf(reason, { NotFound: organizationNotFound })),
			),
		PressedCopy: ($, { target, text }) => $.run(CopyLink.make({ target, text })),
		SucceededCopy: ($, { target }) => $.run(toast(COPIED[target].success)),
		FailedCopy: ($, { target }) => $.run(failure({ title: COPIED[target].failure })),
		PressedDelete: ($) =>
			$.props.session.organization === null ? $.model : $.evolve({ deleteOpen: () => true }),
		ChangedConfirmation: ($, { payload }) =>
			$.evolve({ confirmation: (confirmation) => TextField.changed(confirmation, payload) }),
		DismissedDelete: ($) =>
			$.model.deleting
				? $.model
				: $.evolve({ deleteOpen: () => false, confirmation: () => TextField.empty }),
		PressedConfirmDelete: ($) => {
			const organization = $.props.session.organization
			if (organization === null || $.model.deleting || $.model.confirmation.text !== organization.name)
				return $.model
			return $.set({ ...$.model, deleting: true }).run(
				DeleteOrganization.make({ organizationId: organization.id }),
			)
		},
		SucceededDelete: ($) =>
			$.set({ ...$.model, deleting: false, deleteOpen: false, confirmation: TextField.empty }).run(
				Navigate.make({
					href: "/",
					replace: false,
					toast: successToast("Workspace deleted successfully"),
				}),
			),
		// The dialog stays open, so the owner can try again.
		FailedDelete: ($, { reason }) =>
			$.set({ ...$.model, deleting: false }).run(
				failure(
					copyOf(reason, {
						NotFound: {
							title: "Workspace not found",
							description: "This workspace may have already been deleted.",
						},
						NotPermitted: {
							title: "Unauthorized",
							description: "You don't have permission to delete this workspace.",
						},
					}),
				),
			),
		PressedStartExport: ($) => {
			const organization = $.props.session.organization
			if (organization === null || $.model.startingExport) return $.model
			return $.set({ ...$.model, startingExport: true }).run(
				StartExport.make({ organizationId: organization.id }),
			)
		},
		SucceededStartExport: ($) =>
			$.set({ ...$.model, startingExport: false }).run(
				toast("Export started", "It is ready to download here when it finishes."),
			),
		FailedStartExport: ($, { reason }) =>
			$.set({ ...$.model, startingExport: false }).run(failure(copyOf(reason, exportCopy))),
		PressedDownload: ($, { exportId }) => {
			const organization = $.props.session.organization
			if (organization === null || $.model.downloadingExportId !== null) return $.model
			return $.set({ ...$.model, downloadingExportId: exportId }).run(
				GetExportLink.make({ organizationId: organization.id, exportId }),
			)
		},
		// Served as an attachment: the browser saves it and stays on the page.
		SucceededExportLink: ($, { url }) =>
			$.set({ ...$.model, downloadingExportId: null }).run(LoadPage.make({ href: url })),
		FailedExportLink: ($, { reason }) =>
			$.set({ ...$.model, downloadingExportId: null }).run(failure(copyOf(reason, exportCopy))),
	},
	subscriptions: ({ props }) => {
		const organization = props.session.organization
		if (organization === null) return []
		return [
			// `isPublic` is not in the session's organization, so it is read here, with the name.
			Subscription.make("organization", [organization.id], ([id]) =>
				withData((data) =>
					data.liveQueryStream<
						{ readonly name: string; readonly isPublic?: boolean | null },
						GeneralMessage
					>(
						(q) =>
							q
								.from({ org: data.collections.organizationCollection })
								.where(({ org }) => eq(org.id, id))
								.findOne(),
						(rows) =>
							GeneralMessage.UpdatedOrganization({
								name: rows[0]?.name ?? "",
								isPublic: rows[0]?.isPublic ?? false,
							}),
					),
				),
			),
			// Exports sync to owners and admins only.
			isAdmin(props.session)
				? Subscription.make("exports", [organization.id], ([id]) =>
						exportsStream(id, (exports) => GeneralMessage.UpdatedExports({ exports })),
					)
				: null,
		]
	},
	view: (h, model) => {
		const { session } = h.props
		const organization = session.organization
		if (organization === null) return h.stack.key("general")
		const permissionsLoading = session.member === null
		return settingsColumn(
			h,
			"general",
			profileCard(h, model, organization),
			isAdmin(session) || permissionsLoading ? publicInviteCard(h, model) : null,
			isAdmin(session) ? exportCard(h, model, h.props.nowMs) : null,
			session.member?.role === "owner" || permissionsLoading ? dangerCard(h) : null,
			deleteDialog(h, model, organization),
		)
	},
})

/** The page with its Commands; the host provides `ClientData`, `HazelRpc`, `Clipboard` and `ImageUploads`. */
export const GeneralPage = GeneralPageNoDeps.pipe(Component.provide(Layer.mergeAll(generalCommandsLayer)))
