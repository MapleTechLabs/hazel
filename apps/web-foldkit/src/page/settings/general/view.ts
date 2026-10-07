import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCopy, IconEdit, IconOffice, IconShare, IconWarning } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { button } from "../../../ui/button"
import { card, cardBody, cardHeader } from "../../../ui/card"
import * as Field from "../../../ui/field"
import { switchControl } from "../../../ui/switch"
import { textField } from "../../../ui/text-field"
import type { Organization } from "../../../session"
import type { PageViewInputs, Shared } from "../../contract"
import { deleteWorkspaceModal } from "./delete-workspace"
import { Message } from "./message"
import type { Model } from "./model"
import { isAdminOf, LOGO_INPUT_ID } from "./update"

/** Port of `routes/_app/$orgSlug/settings/index.tsx`. */

const getInitials = (orgName: string) => {
	const words = orgName.trim().split(/\s+/)
	if (words.length >= 2) {
		return `${words[0]?.charAt(0) ?? ""}${words[1]?.charAt(0) ?? ""}`.toUpperCase()
	}
	return orgName.slice(0, 2).toUpperCase()
}

const sectionHeader = (
	h: HtmlBuilder<Message>,
	options: { readonly icon: Html; readonly title: string; readonly titleClass?: string; readonly text: string },
): Html =>
	h.div(
		[h.Class("flex flex-col gap-0.5")],
		[
			h.div(
				[h.Class("flex items-center gap-2")],
				[options.icon, h.h2([h.Class(`font-semibold ${options.titleClass ?? "text-fg"} text-lg`)], [options.title])],
			),
			h.p([h.Class("text-muted-fg text-sm")], [options.text]),
		],
	)

/** The read-only URL box with its Copy button. */
const copyRow = (h: HtmlBuilder<Message>, url: string, successTitle: string, failureTitle: string): Html =>
	h.div(
		[h.Class("flex items-center gap-2")],
		[
			h.div(
				[h.Class("flex-1 rounded-lg border border-border bg-bg-muted/30 px-3 py-2")],
				[h.code([h.Class("break-all text-fg text-sm")], [url])],
			),
			button(
				h,
				{
					intent: "secondary",
					size: "md",
					onPress: Message.ClickedCopy({ text: url, successTitle, failureTitle }),
				},
				[IconCopy(h, { attributes: { "data-slot": "icon" } }), "Copy"],
			),
		],
	)

const profileCard = (h: HtmlBuilder<Message>, model: Model, shared: Shared, organization: Organization) => {
	const isAdmin = isAdminOf(shared)
	const isPermissionsLoading = shared.member === null
	const isLogoDisabled = model.isUploading || isPermissionsLoading || !isAdmin
	const isNameDisabled = model.isSavingName || isPermissionsLoading || !isAdmin
	const workspaceUrl = `${model.origin}/${model.orgSlug}`
	return card(h, {}, [
		cardHeader(h, [
			sectionHeader(h, {
				icon: IconOffice(h, { className: "size-5 text-muted-fg" }),
				title: "Organization Profile",
				text: "Manage your organization's name and appearance.",
			}),
		]),
		cardBody(h, [
			h.div(
				[h.Class("flex flex-col gap-6")],
				[
					h.div(
						[h.Class("flex flex-col gap-2")],
						[
							Field.label(h, {}, ["Organization Logo"]),
							h.div(
								[h.Class("flex items-center gap-4")],
								[
									h.button(
										[
											h.Class(
												"group relative cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
											),
											h.Type("button"),
											...(isLogoDisabled ? [h.Disabled(true)] : [h.OnClick(Message.ClickedLogo())]),
										],
										[
											avatar(h, {
												src: organization.logoUrl,
												initials: getInitials(organization.name),
												size: "4xl",
											}),
											...(isAdmin
												? [
														h.div(
															[
																h.Class(
																	"absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100",
																),
															],
															[IconEdit(h, { className: "size-6 text-white" })],
														),
													]
												: []),
										],
									),
									h.input([
										h.Id(LOGO_INPUT_ID),
										h.Type("file"),
										h.Attribute("accept", "image/jpeg,image/png,image/webp"),
										h.Class("hidden"),
										h.Attribute("style", ""),
										...(isLogoDisabled ? [h.Disabled(true)] : []),
										h.OnFileChange((files) => Message.SelectedLogo({ files })),
									]),
									h.div(
										[h.Class("flex flex-col gap-1")],
										[
											h.p(
												[h.Class("font-medium text-fg text-sm")],
												[model.isUploading ? "Uploading..." : "Click to upload"],
											),
											h.p([h.Class("text-muted-fg text-xs")], ["JPG, PNG or WebP. Max 5MB."]),
										],
									),
								],
							),
						],
					),
					textField(
						h,
						{
							id: "organization-name",
							value: model.name,
							onInput: (value) => Message.ChangedName({ value }),
							className: "max-w-md",
						},
						(parts) => [
							parts.label(["Organization Name"]),
							parts.input({
								placeholder: "Enter organization name",
								attributes: [
									...(isNameDisabled ? [h.Disabled(true), h.DataAttribute("disabled", "true")] : []),
									h.OnBlur(Message.SubmittedName()),
									h.OnKeyDownPreventDefault((key) =>
										key === "Enter" ? Option.some(Message.SubmittedName()) : Option.none(),
									),
								],
							}),
							parts.description(["This is the display name for your organization."]),
						],
					),
					...(isAdmin && model.name !== organization.name && model.name.trim()
						? [
								h.div(
									[h.Class("flex items-center gap-2")],
									[
										button(
											h,
											{
												intent: "primary",
												size: "sm",
												isDisabled: model.isSavingName,
												onPress: Message.SubmittedName(),
											},
											[model.isSavingName ? "Saving..." : "Save Changes"],
										),
										button(
											h,
											{
												intent: "secondary",
												size: "sm",
												isDisabled: model.isSavingName,
												onPress: Message.ClickedCancelName(),
											},
											["Cancel"],
										),
									],
								),
							]
						: []),
					h.div(
						[h.Class("flex flex-col gap-2")],
						[
							Field.label(h, {}, ["Workspace URL"]),
							copyRow(h, workspaceUrl, "Workspace URL copied to clipboard", "Failed to copy URL"),
							Field.description(h, {}, ["This is your workspace's unique URL. Share it with your team."]),
						],
					),
				],
			),
		]),
	])
}

const publicInviteCard = (h: HtmlBuilder<Message>, model: Model, shared: Shared) => {
	const isPermissionsLoading = shared.member === null
	const publicInviteUrl = `${model.origin}/join/${model.orgSlug}`
	return card(h, {}, [
		cardHeader(h, [
			sectionHeader(h, {
				icon: IconShare(h, { className: "size-5 text-muted-fg" }),
				title: "Public Invite Link",
				text: "Allow anyone with the link to join your workspace.",
			}),
		]),
		cardBody(h, [
			h.div(
				[h.Class("flex flex-col gap-4")],
				[
					switchControl(
						h,
						{
							id: "public-invite-switch",
							isSelected: model.isPublic,
							isDisabled: model.isTogglingPublic || isPermissionsLoading || !isAdminOf(shared),
							onChange: (isPublic) => Message.ToggledPublicMode({ isPublic }),
						},
						"Enable public invite link",
					),
					...(model.isPublic
						? [
								h.div(
									[h.Class("flex flex-col gap-2")],
									[
										h.p(
											[h.Class("text-muted-fg text-sm")],
											["Anyone with this link can join your workspace as a member."],
										),
										copyRow(h, publicInviteUrl, "Invite link copied to clipboard", "Failed to copy link"),
									],
								),
							]
						: []),
				],
			),
		]),
	])
}

const dangerZoneCard = (h: HtmlBuilder<Message>, shared: Shared) =>
	card(h, { variant: "danger" }, [
		cardHeader(
			h,
			[
				sectionHeader(h, {
					icon: IconWarning(h, { className: "size-5 text-danger" }),
					title: "Danger Zone",
					titleClass: "text-danger",
					text: "Irreversible and destructive actions for this workspace.",
				}),
			],
			"border-danger/20 bg-danger/5",
		),
		cardBody(h, [
			h.div(
				[h.Class("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between")],
				[
					h.div(
						[h.Class("flex flex-col gap-1")],
						[
							h.p([h.Class("font-medium text-fg text-sm")], ["Delete this workspace"]),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								[
									"Once deleted, all data including channels, messages, and members will be permanently removed.",
								],
							),
						],
					),
					button(
						h,
						{
							intent: "danger",
							size: "md",
							isDisabled: shared.member === null || shared.member.role !== "owner",
							onPress: Message.ClickedDeleteWorkspace(),
						},
						["Delete workspace"],
					),
				],
			),
		]),
	])

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const organization = shared.organization
	if (organization === null) return h.empty
	const isPermissionsLoading = shared.member === null
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			profileCard(h, model, shared, organization),
			...(isAdminOf(shared) || isPermissionsLoading ? [publicInviteCard(h, model, shared)] : []),
			...(shared.member?.role === "owner" || isPermissionsLoading ? [dangerZoneCard(h, shared)] : []),
			deleteWorkspaceModal(h, model, organization),
		],
	)
})
