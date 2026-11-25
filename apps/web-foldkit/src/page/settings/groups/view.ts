import { UserGroup } from "@hazel/domain/models"
import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconPlus, IconProfiles2, IconTrash, IconWarning } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardClassName, cardHeader } from "../../../ui/card"
import { type Column, dataTable } from "../../../ui/data-table"
import {
	dialog,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../../ui/dialog"
import { emptyState } from "../../../ui/empty-state"
import { heading } from "../../../ui/heading"
import { iconTile } from "../../../ui/icon-tile"
import { inputGroup } from "../../../ui/input"
import * as Modal from "../../../ui/modal"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs, Shared } from "../../contract"
import * as ConfirmAction from "../../shared/confirm-action"
import { Message } from "./message"
import type { Form, Group, Model, OrgMember } from "./model"
import { canManage, isFormComplete, selectedGroup } from "./update"

/** The organization's user groups (Discord's mentionable roles): `@handle` mentions everyone in one. */

const MAX_SUGGESTIONS = 8

const membersLabel = (count: number) => `${count} ${count === 1 ? "member" : "members"}`

/**
 * The group's members still in the organization: one who left keeps their group row but is never
 * notified, and the list (from the org's members) does not show them, so they are not counted.
 */
const groupMemberCount = (group: Group, members: Model["members"]) => {
	const current = new Set<string>(members.map((member) => member.userId))
	return group.memberIds.filter((userId) => current.has(userId)).length
}

type FormMessages = Readonly<{
	onName: (value: string) => Message
	onHandle: (value: string) => Message
}>

const formFields = (
	h: HtmlBuilder<Message>,
	idPrefix: string,
	form: Form,
	isDisabled: boolean,
	messages: FormMessages,
): Html =>
	h.div(
		[h.Class("grid gap-3 sm:grid-cols-2")],
		[
			textField(
				h,
				{ id: `${idPrefix}-name`, value: form.name, onInput: messages.onName, isDisabled },
				(parts) => [
					parts.label(["Name"]),
					parts.input({
						placeholder: "Design team",
						attributes: [h.Attribute("maxlength", String(UserGroup.NAME_MAX))],
					}),
				],
			),
			textField(
				h,
				{ id: `${idPrefix}-handle`, value: form.handle, onInput: messages.onHandle, isDisabled },
				(parts) => [
					parts.label(["Handle"]),
					inputGroup(h, { isDisabled }, [
						h.span([h.DataAttribute("slot", "text"), h.Class("text-muted-fg")], ["@"]),
						parts.input({
							placeholder: "design",
							attributes: [h.Attribute("maxlength", String(UserGroup.HANDLE_MAX))],
						}),
					]),
					parts.description(["Lowercase letters, numbers, hyphens, and underscores"]),
				],
			),
		],
	)

const createForm = (h: HtmlBuilder<Message>, model: Model, form: Form): Html =>
	h.div(
		[h.Class("border-border border-b px-4 py-4 md:px-6")],
		[
			h.div(
				[h.Class(cardClassName("flex flex-col gap-3 p-4"))],
				[
					formFields(h, "new-group", form, model.isPending, {
						onName: (value) => Message.ChangedCreateName({ value }),
						onHandle: (value) => Message.ChangedCreateHandle({ value }),
					}),
					h.div(
						[h.Class("flex items-center gap-2 sm:justify-end")],
						[
							button(
								h,
								{
									intent: "secondary",
									size: "sm",
									isDisabled: model.isPending,
									onPress: Message.ClickedCancelCreate(),
								},
								["Cancel"],
							),
							button(
								h,
								{
									intent: "primary",
									size: "sm",
									isDisabled: model.isPending || !isFormComplete(form),
									isPending: model.isPending,
									onPress: Message.ClickedCreateGroup(),
								},
								["Create group"],
							),
						],
					),
				],
			),
		],
	)

const columns = (h: HtmlBuilder<Message>, model: Model, isAdmin: boolean): ReadonlyArray<Column<Group>> => [
	{
		key: "group",
		label: "Group",
		cell: (group) =>
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					h.span([h.Class("truncate font-medium")], [`@${group.handle}`]),
					h.span([h.Class("truncate text-muted-fg text-xs")], [group.name]),
				],
			),
	},
	{
		key: "members",
		label: "Members",
		widthClass: "w-32",
		cell: (group) =>
			badge(h, { intent: "secondary" }, [membersLabel(groupMemberCount(group, model.members))]),
	},
	{
		key: "actions",
		label: "Actions",
		align: "right",
		widthClass: "w-40",
		cell: (group) =>
			h.div(
				[h.Class("flex items-center justify-end gap-1")],
				[
					button(
						h,
						{
							intent: "plain",
							size: "xs",
							className: "max-md:min-h-10",
							onPress: Message.ClickedGroup({ id: group.id }),
							attributes: [
								h.AriaLabel(`${isAdmin ? "Manage" : "View"} @${group.handle}`),
								h.Attribute(
									"aria-expanded",
									model.selectedId === group.id ? "true" : "false",
								),
							],
						},
						[isAdmin ? "Manage" : "View"],
					),
					...(isAdmin
						? [
								button(
									h,
									{
										intent: "danger",
										size: "sq-sm",
										onPress: Message.ClickedDeleteGroup({
											id: group.id,
											handle: group.handle,
										}),
										attributes: [h.AriaLabel(`Delete @${group.handle}`)],
									},
									[IconTrash(h, { attributes: { "data-slot": "icon" } })],
								),
							]
						: []),
				],
			),
	},
]

const memberRow = (h: HtmlBuilder<Message>, member: OrgMember, action: Html | null): Html =>
	h.li(
		[h.Class("flex items-center gap-3 py-2")],
		[
			avatar(h, { src: member.avatarUrl, alt: undefined, seed: member.name, className: "size-8" }),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span([h.Class("truncate font-medium text-sm")], [member.name]),
					h.span([h.Class("truncate text-muted-fg text-xs")], [member.email]),
				],
			),
			...(action === null ? [] : [action]),
		],
	)

const groupPanel = (h: HtmlBuilder<Message>, model: Model, group: Group, isAdmin: boolean): Html => {
	const inGroup = new Set<string>(group.memberIds)
	const members = model.members.filter((member) => inGroup.has(member.userId))
	const search = model.memberSearch.trim().toLowerCase()
	const matching = model.members.filter(
		(member) =>
			search === "" ||
			member.name.toLowerCase().includes(search) ||
			member.email.toLowerCase().includes(search),
	)
	const suggestions = matching.filter((member) => !inGroup.has(member.userId)).slice(0, MAX_SUGGESTIONS)
	return card(h, {}, [
		cardHeader(h, [
			pageHeader(h, {
				title: `@${group.handle}`,
				badges: [badge(h, { intent: "secondary" }, [membersLabel(members.length)])],
				subtitle: group.name,
				actions: [
					button(h, { intent: "secondary", size: "sm", onPress: Message.ClickedCloseGroup() }, [
						"Close",
					]),
				],
			}),
		]),
		h.div(
			[h.Class("flex flex-col gap-6 px-4 pb-6 md:px-6")],
			[
				...(isAdmin && model.edit !== null
					? [
							h.div(
								[h.Class("flex flex-col gap-3")],
								[
									formFields(h, "edit-group", model.edit, model.isPending, {
										onName: (value) => Message.ChangedEditName({ value }),
										onHandle: (value) => Message.ChangedEditHandle({ value }),
									}),
									h.div(
										[h.Class("flex sm:justify-end")],
										[
											button(
												h,
												{
													intent: "primary",
													size: "sm",
													isDisabled:
														model.isPending ||
														!isFormComplete(model.edit) ||
														(model.edit.name.trim() === group.name &&
															model.edit.handle === group.handle),
													onPress: Message.ClickedSaveGroup(),
												},
												["Save"],
											),
										],
									),
								],
							),
						]
					: []),
				h.section(
					[h.AriaLabel("Members")],
					[
						heading(h, { variant: "subsection" }, ["Members"]),
						members.length === 0
							? h.p([h.Class("py-2 text-muted-fg text-sm")], ["No one is in this group yet."])
							: h.ul(
									[h.Class("divide-y divide-border")],
									members.map((member) =>
										memberRow(
											h,
											member,
											isAdmin
												? button(
														h,
														{
															intent: "plain",
															size: "xs",
															isDisabled: model.isPending,
															onPress: Message.ClickedRemoveMember({
																userId: member.userId,
															}),
															attributes: [
																h.AriaLabel(`Remove ${member.name}`),
															],
														},
														["Remove"],
													)
												: null,
										),
									),
								),
					],
				),
				...(isAdmin
					? [
							h.section(
								[h.AriaLabel("Add members")],
								[
									textField(
										h,
										{
											id: "group-member-search",
											value: model.memberSearch,
											onInput: (value) => Message.ChangedMemberSearch({ value }),
										},
										(parts) => [
											parts.label(["Add members"]),
											parts.input({ placeholder: "Search people" }),
										],
									),
									suggestions.length === 0
										? h.p(
												[h.Class("py-2 text-muted-fg text-sm")],
												[
													matching.length === 0
														? "No people match."
														: "Everyone who matches is in the group.",
												],
											)
										: h.ul(
												[h.Class("divide-y divide-border")],
												suggestions.map((member) =>
													memberRow(
														h,
														member,
														button(
															h,
															{
																intent: "secondary",
																size: "xs",
																isDisabled: model.isPending,
																onPress: Message.ClickedAddMember({
																	userId: member.userId,
																}),
																attributes: [
																	h.AriaLabel(`Add ${member.name}`),
																],
															},
															["Add"],
														),
													),
												),
											),
								],
							),
						]
					: []),
			],
		),
	])
}

const innerTitleId = (modalId: string) => `${modalId}-inner-title`

const deleteGroupModal = (h: HtmlBuilder<Message>, model: Model): Html => {
	const id = model.deleteConfirm.modal.id
	const target = Option.getOrNull(ConfirmAction.targetOf(model.deleteConfirm))
	const isDeleting = ConfirmAction.isRunning(model.deleteConfirm)
	return h.submodel({
		slotId: id,
		model: model.deleteConfirm.modal,
		view: Modal.view,
		viewInputs: {
			toContent: (closeAttributes) => [
				dialog(h, { id: Modal.dialogId(id), role: "dialog", labelledBy: innerTitleId(id) }, [
					dialogHeader(h, {}, [
						iconTile(h, { intent: "danger" }, IconWarning(h)),
						dialogTitle(h, { id: innerTitleId(id) }, "Delete group"),
						dialogDescription(h, [
							"Delete ",
							h.strong([], ["@", target?.handle ?? ""]),
							"? Mentions of it in earlier messages stop notifying anyone.",
						]),
					]),
					dialogFooter(h, [
						dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
						button(
							h,
							{
								intent: "danger",
								isPending: isDeleting,
								onPress: Message.ClickedConfirmDelete(),
							},
							[isDeleting ? "Deleting..." : "Delete group"],
						),
					]),
				]),
			],
			size: "md",
		},
		toParentMessage: (message: Modal.Message) =>
			Message.GotDeleteConfirmMessage({ message: ConfirmAction.toModalMessage(message) }),
	})
}

const groupList = (h: HtmlBuilder<Message>, model: Model, isAdmin: boolean): Html =>
	model.groups !== null && model.groups.length === 0
		? emptyState(h, {
				icon: (className) => IconProfiles2(h, { className }),
				title: "No groups yet",
				description: isAdmin
					? "Create a group to mention a whole team at once, like @design."
					: "Owners and admins can create groups to mention a whole team at once.",
				action: isAdmin
					? [
							button(h, { intent: "primary", size: "sm", onPress: Message.ClickedNewGroup() }, [
								"New group",
							]),
						]
					: undefined,
			})
		: dataTable(h, {
				ariaLabel: "Groups",
				id: "user-groups",
				columns: columns(h, model, isAdmin),
				rows: model.groups ?? [],
				rowKey: (group) => group.id,
				isFramed: false,
				loadingRows: model.groups === null ? 3 : undefined,
			})

export const groupsPage = (h: HtmlBuilder<Message>, model: Model, shared: Shared): Html => {
	const isAdmin = canManage(shared)
	const group = selectedGroup(model)
	return pageLayout(h, {}, [
		card(h, {}, [
			cardHeader(h, [
				pageHeader(h, {
					title: "Groups",
					size: "title",
					leading: IconProfiles2(h, { className: "mt-0.5 size-5 text-muted-fg" }),
					badges:
						model.groups === null
							? []
							: [
									badge(h, { intent: "secondary" }, [
										`${model.groups.length}`,
										model.groups.length === 1 ? " group" : " groups",
									]),
								],
					subtitle: "Mention a group with its @handle to notify everyone in it.",
					actions:
						isAdmin && model.create === null
							? [
									button(
										h,
										{
											intent: "secondary",
											size: "md",
											onPress: Message.ClickedNewGroup(),
										},
										[IconPlus(h, { attributes: { "data-slot": "icon" } }), "New group"],
									),
								]
							: [],
				}),
			]),
			...(isAdmin && model.create !== null ? [createForm(h, model, model.create)] : []),
			groupList(h, model, isAdmin),
		]),
		...(group === undefined ? [] : [groupPanel(h, model, group, isAdmin)]),
		deleteGroupModal(h, model),
	])
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	shared.organization === null ? h.empty : groupsPage(h, model, shared),
)
