// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Phase 1 exit screen: workspace settings, General (`web-foldkit/src/page/settings/general/view.ts`)
 * in `hazel`: framed cards with a governed header (`SettingsHeader`), a controlled name field that
 * saves when dirty, a toggle, export status and the danger zone's confirm dialog. Not rendered yet.
 */
import { UiSchema } from "@effect/ui"
import { SettingsHeader } from "@hazel/ui/custom/SettingsHeader"
import { type BadgeTone, Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"

export const ExportStatus = Schema.Literals(["none", "queued", "exporting", "ready", "failed", "expired"])
export type ExportStatus = typeof ExportStatus.Type

export const SettingsMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	PressedSave: {},
	PressedCancel: {},
	PressedUploadLogo: {},
	PressedCopyUrl: {},
	ToggledPublicInvite: { checked: Schema.Boolean },
	PressedExport: {},
	PressedDownload: {},
	PressedDelete: {},
	ChangedConfirm: { payload: TextField.ChangePayload },
	DismissedDelete: {},
	ConfirmedDelete: {},
})
export type SettingsMessage = typeof SettingsMessage.Type

const exportBadge = (status: ExportStatus): { readonly label: string; readonly tone: BadgeTone } | null =>
	Match.value(status).pipe(
		Match.when("none", () => null),
		Match.when("queued", () => ({ label: "Queued", tone: "neutral" as const })),
		Match.when("exporting", () => ({ label: "Exporting", tone: "info" as const })),
		Match.when("ready", () => ({ label: "Ready", tone: "success" as const })),
		Match.when("failed", () => ({ label: "Failed", tone: "danger" as const })),
		Match.when("expired", () => ({ label: "Expired", tone: "neutral" as const })),
		Match.exhaustive,
	)

export const GeneralSettings = Hazel.component({
	name: "GeneralSettings",
	props: Schema.Struct({ workspaceUrl: Schema.String, isOwner: Schema.Boolean }),
	model: Schema.Struct({
		savedName: Schema.String,
		name: TextField.State,
		saving: Schema.Boolean,
		logoName: Schema.String,
		publicInvite: Schema.Boolean,
		exportStatus: ExportStatus,
		confirmingDelete: Schema.Boolean,
		confirm: TextField.State,
	}),
	message: SettingsMessage,
}).make({
	init: () => ({
		savedName: "",
		name: TextField.empty,
		saving: false,
		logoName: "",
		publicInvite: false,
		exportStatus: "none",
		confirmingDelete: false,
		confirm: TextField.empty,
	}),
	update: {
		ChangedName: ($, { payload }) => $.evolve({ name: (name) => TextField.changed(name, payload) }),
		PressedSave: ($) => $.evolve({ saving: () => true }),
		PressedCancel: ($) => $.evolve({ name: (name) => TextField.set(name, $.model.savedName) }),
		PressedUploadLogo: ($) => $.model,
		PressedCopyUrl: ($) => $.model,
		ToggledPublicInvite: ($, { checked }) => $.evolve({ publicInvite: () => checked }),
		PressedExport: ($) => $.evolve({ exportStatus: () => "queued" as const }),
		PressedDownload: ($) => $.model,
		PressedDelete: ($) => $.evolve({ confirmingDelete: () => true }),
		ChangedConfirm: ($, { payload }) =>
			$.evolve({ confirm: (confirm) => TextField.changed(confirm, payload) }),
		DismissedDelete: ($) => $.evolve({ confirmingDelete: () => false, confirm: () => TextField.empty }),
		ConfirmedDelete: ($) => $.evolve({ confirmingDelete: () => false }),
	},
	view: (h, model) => {
		const dirty = model.name.text !== model.savedName
		const badge = exportBadge(model.exportStatus)
		return h.screen.title("General").children(
			h.frame.children(
				h.custom(SettingsHeader, {
					icon: "office",
					title: "Organization profile",
					subtitle: "How your workspace appears to members.",
				}),
				h.stack
					.axis("horizontal")
					.align("center")
					.children(
						// HAZEL-GAP(avatar-large): the logo is a large avatar that is itself the upload button.
						h.avatar.name(model.logoName),
						h.stack
							.density("compact")
							.children(
								h.button
									.label("Upload logo")
									.variant("outline")
									.size("small")
									.on("press", SettingsMessage.PressedUploadLogo()),
								h.text.role("caption").tone("muted").children("JPG, PNG or WebP. Max 5MB."),
							),
					),
				h.textField
					.label("Organization name")
					.description("Shown in the sidebar and in invitations.")
					.value(model.name)
					.on("change", (payload) => SettingsMessage.ChangedName({ payload }))
					.on("submit", () => SettingsMessage.PressedSave()),
				dirty
					? h.stack.axis("horizontal").children(
							h.button
								.label(model.saving ? "Saving..." : "Save changes")
								.size("small")
								.loading(model.saving)
								.on("press", SettingsMessage.PressedSave()),
							h.button
								.label("Cancel")
								.variant("secondary")
								.size("small")
								.on("press", SettingsMessage.PressedCancel()),
						)
					: null,
				h.stack
					.axis("horizontal")
					.align("end")
					.children(
						// HAZEL-GAP(field-monospace): the URL reads as code (`code` text role inside a field).
						h.textField
							.label("Workspace URL")
							.readOnly()
							.value({ text: h.props.workspaceUrl, rev: 0, edit: 0 }),
						// HAZEL-GAP(clipboard): copying is a platform service (lane F), not a view concern.
						h.button
							.label("Copy")
							.icon("copy")
							.variant("secondary")
							.on("press", SettingsMessage.PressedCopyUrl()),
					),
			),
			h.frame.children(
				h.custom(SettingsHeader, {
					icon: "share",
					title: "Public invite",
					subtitle: "Anyone with the link can join.",
				}),
				h.toggle
					.label("Enable public invite link")
					.checked(model.publicInvite)
					.on("change", ({ checked }) => SettingsMessage.ToggledPublicInvite({ checked })),
			),
			h.frame.children(
				h.custom(SettingsHeader, {
					icon: "download",
					title: "Export data",
					subtitle: "A copy of your workspace's messages and files.",
				}),
				h.stack
					.axis("horizontal")
					.align("center")
					.children(
						badge === null ? null : h.badge.label(badge.label).tone(badge.tone).style("quiet"),
						// HAZEL-GAP(progress): an export in progress shows a progress bar; no primitive draws one.
						h.spacer,
						model.exportStatus === "ready"
							? h.button
									.label("Download")
									.icon("download")
									.variant("outline")
									.on("press", SettingsMessage.PressedDownload())
							: h.button
									.label("Export")
									.variant("secondary")
									.disabled(
										model.exportStatus === "queued" || model.exportStatus === "exporting",
									)
									.on("press", SettingsMessage.PressedExport()),
					),
			),
			h.props.isOwner
				? // HAZEL-GAP(frame-danger): the danger zone's card has a tinted header; `frame` has no danger surface.
					h.frame.children(
						h.custom(SettingsHeader, {
							icon: "warning",
							title: "Danger zone",
							subtitle: "Deleting a workspace cannot be undone.",
						}),
						h.button
							.label("Delete workspace")
							.variant("danger")
							.on("press", SettingsMessage.PressedDelete()),
					)
				: null,
			h.dialog
				.open(model.confirmingDelete)
				.destructive()
				.title("Delete workspace")
				.description("Type the workspace name to confirm.")
				.on("dismiss", SettingsMessage.DismissedDelete())
				.children(
					h.textField
						.label("Workspace name")
						.value(model.confirm)
						.on("change", (payload) => SettingsMessage.ChangedConfirm({ payload })),
				)
				.actions(
					h.button
						.label("Cancel")
						.variant("outline")
						.on("press", SettingsMessage.DismissedDelete()),
					h.button
						.label("Delete")
						.variant("danger")
						.disabled(model.confirm.text !== model.savedName)
						.on("press", SettingsMessage.ConfirmedDelete()),
				),
		)
	},
})
