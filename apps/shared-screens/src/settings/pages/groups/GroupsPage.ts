// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/groups` (the deleted `web-foldkit/src/page/settings/groups`): the organization's
 * user groups, mentioned as `@handle`. Owners and admins create, rename and delete them and pick who
 * is in each; everyone else sees them read-only.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { UserGroup } from "@hazel/domain/models"
import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Option, Schema } from "effect"
import { ShowToast } from "../../../app/requests"
import { Session } from "../../../app/session"
import * as Confirm from "../../../components/ConfirmAction"
import { CommonReason, copyOf, errorToast, reasonOf, successToast } from "../../../modals/feedback"
import { cardHeader, settingsCard, settingsColumn } from "../settings-card"
import { type Group, groupsStream, membersStream, type OrgMember } from "./data"

const MAX_SUGGESTIONS = 8

export const GroupRow = Schema.Struct({
	id: UserGroupId,
	handle: Schema.String,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	memberIds: Schema.Array(UserId),
})

export const MemberRow = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

/** The name and handle being typed; the handle follows the name until it is typed itself. */
export const Form = Schema.Struct({
	name: TextField.State,
	handle: TextField.State,
	isHandleEdited: Schema.Boolean,
})
export type Form = typeof Form.Type

/** Why a write failed: the handle is taken, the server refused a field (`detail`), or a shared reason. */
export const Failure = Schema.Union([Schema.Literals(["HandleTaken", "Invalid", "NotFound"]), CommonReason])
export type Failure = typeof Failure.Type

export const DeleteTarget = Schema.Struct({ id: UserGroupId, handle: Schema.String })
export type DeleteTarget = typeof DeleteTarget.Type

const failed = { reason: Failure, detail: Schema.NullOr(Schema.String) }

export const GroupsMessage = UiSchema.TaggedEnum({
	UpdatedGroups: { groups: Schema.Array(GroupRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	PressedNewGroup: {},
	ChangedCreateName: { payload: TextField.ChangePayload },
	ChangedCreateHandle: { payload: TextField.ChangePayload },
	PressedCancelCreate: {},
	PressedCreateGroup: {},
	SucceededCreateGroup: { id: UserGroupId, handle: Schema.String, name: Schema.String },
	FailedCreateGroup: failed,
	PressedGroup: { id: UserGroupId },
	PressedCloseGroup: {},
	ChangedEditName: { payload: TextField.ChangePayload },
	ChangedEditHandle: { payload: TextField.ChangePayload },
	PressedSaveGroup: {},
	SucceededSaveGroup: { handle: Schema.String },
	FailedSaveGroup: failed,
	ChangedMemberSearch: { payload: TextField.ChangePayload },
	PressedAddMember: { userId: UserId },
	PressedRemoveMember: { userId: UserId },
	SucceededChangeMembers: {},
	FailedChangeMembers: failed,
	PressedDeleteGroup: { id: UserGroupId, handle: Schema.String },
	PressedConfirmDelete: {},
	CancelledDelete: {},
	SucceededDeleteGroup: { handle: Schema.String },
	FailedDeleteGroup: failed,
})
export type GroupsMessage = typeof GroupsMessage.Type

export const GroupsProps = Schema.Struct({ session: Session })
export type GroupsProps = typeof GroupsProps.Type

export const GroupsModel = Schema.Struct({
	/** `null` until the live query answers (the table draws skeleton rows). */
	groups: Schema.NullOr(Schema.Array(GroupRow)),
	members: Schema.Array(MemberRow),
	create: Schema.NullOr(Form),
	/** The group whose members are shown, and its rename form (owners and admins). */
	selectedId: Schema.NullOr(UserGroupId),
	edit: Schema.NullOr(Form),
	memberSearch: TextField.State,
	/** A create, save or member change is running. */
	isPending: Schema.Boolean,
	deleteConfirm: Confirm.ConfirmState(DeleteTarget),
})
export type GroupsModel = typeof GroupsModel.Type

// COMMANDS

/** Runs a `userGroup.*` call, settling every failure into `failed(reason, detail)`. */
const settle = <A, E>(
	effect: Effect.Effect<A, E>,
	done: (value: A) => GroupsMessage,
	failedWith: (reason: Failure, detail: string | null) => GroupsMessage,
): Effect.Effect<GroupsMessage> =>
	effect.pipe(
		Effect.map(done),
		Effect.catchCause((cause) => {
			const error = Option.getOrUndefined(Cause.findErrorOption(cause)) as
				| { readonly _tag?: string; readonly message?: string }
				| undefined
			if (error?._tag === "UserGroupHandleTakenError")
				return Effect.succeed(failedWith("HandleTaken", null))
			if (error?._tag === "UserGroupInvalidError")
				return Effect.succeed(failedWith("Invalid", error.message ?? null))
			if (error?._tag === "UserGroupNotFoundError") return Effect.succeed(failedWith("NotFound", null))
			// BOUNDARY: every other failure reads as its common reason.
			return Effect.logWarning("user group write failed", cause).pipe(
				Effect.as(failedWith(reasonOf(error), null)),
			)
		}),
	)

export class CreateGroup extends Command.Service<CreateGroup>()("hazel/settings/groups/Create", {
	args: { organizationId: OrganizationId, handle: Schema.String, name: Schema.String },
	success: GroupsMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) => (args) =>
				settle(
					rpc("userGroup.create", args),
					(result) =>
						GroupsMessage.SucceededCreateGroup({
							id: result.data.id,
							handle: result.data.handle,
							name: result.data.name,
						}),
					(reason, detail) => GroupsMessage.FailedCreateGroup({ reason, detail }),
				),
		),
	)
}

export class SaveGroup extends Command.Service<SaveGroup>()("hazel/settings/groups/Save", {
	args: { organizationId: OrganizationId, id: UserGroupId, handle: Schema.String, name: Schema.String },
	success: GroupsMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) => (args) =>
				settle(
					rpc("userGroup.update", args),
					(result) => GroupsMessage.SucceededSaveGroup({ handle: result.data.handle }),
					(reason, detail) => GroupsMessage.FailedSaveGroup({ reason, detail }),
				),
		),
	)
}

export class ChangeGroupMember extends Command.Service<ChangeGroupMember>()(
	"hazel/settings/groups/ChangeMember",
	{
		args: {
			organizationId: OrganizationId,
			groupId: UserGroupId,
			userId: UserId,
			change: Schema.Literals(["add", "remove"]),
		},
		success: GroupsMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, groupId, userId, change }) =>
					settle(
						change === "add"
							? rpc("userGroup.addMembers", { organizationId, groupId, userIds: [userId] })
							: rpc("userGroup.removeMember", { organizationId, groupId, userId }),
						() => GroupsMessage.SucceededChangeMembers(),
						(reason, detail) => GroupsMessage.FailedChangeMembers({ reason, detail }),
					),
		),
	)
}

export class DeleteGroup extends Command.Service<DeleteGroup>()("hazel/settings/groups/Delete", {
	args: { organizationId: OrganizationId, id: UserGroupId, handle: Schema.String },
	success: GroupsMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ organizationId, id, handle }) =>
					settle(
						rpc("userGroup.delete", { organizationId, id }),
						() => GroupsMessage.SucceededDeleteGroup({ handle }),
						(reason, detail) => GroupsMessage.FailedDeleteGroup({ reason, detail }),
					),
		),
	)
}

// MODEL HELPERS

/** Owners and admins manage groups. */
export const canManage = (session: Session) =>
	session.member !== null && canPerform(RPC_SCOPE_MAP, session.member.role, "userGroup.create")

const emptyForm: Form = { name: TextField.empty, handle: TextField.empty, isHandleEdited: false }

const formOf = (group: { readonly name: string; readonly handle: string }): Form => ({
	name: TextField.set(TextField.empty, group.name),
	handle: TextField.set(TextField.empty, group.handle),
	isHandleEdited: true,
})

/** The name typed (at most `NAME_MAX`): the handle follows it until the handle itself is typed. */
const withName = (form: Form, payload: TextField.ChangePayload): Form => {
	const typed = TextField.changed(form.name, payload)
	const name =
		typed.text.length > UserGroup.NAME_MAX
			? TextField.set(typed, typed.text.slice(0, UserGroup.NAME_MAX))
			: typed
	return {
		...form,
		name,
		handle: form.isHandleEdited ? form.handle : TextField.set(form.handle, UserGroup.toHandle(name.text)),
	}
}

/** The handle typed, normalised as the server stores it. */
const withHandle = (form: Form, payload: TextField.ChangePayload): Form => {
	const typed = TextField.changed(form.handle, payload)
	const handle = UserGroup.toHandle(typed.text)
	return {
		...form,
		handle: handle === typed.text ? typed : TextField.set(typed, handle),
		isHandleEdited: true,
	}
}

export const isFormComplete = (form: Form) => form.name.text.trim() !== "" && form.handle.text !== ""

export const selectedGroup = (model: GroupsModel): Group | undefined =>
	model.selectedId === null ? undefined : model.groups?.find((group) => group.id === model.selectedId)

const select = (model: GroupsModel, id: UserGroupId | null): GroupsModel => {
	const group = id === null ? undefined : model.groups?.find((candidate) => candidate.id === id)
	return {
		...model,
		selectedId: group?.id ?? null,
		edit: group === undefined ? null : formOf(group),
		memberSearch: TextField.empty,
	}
}

const failureCopy = (title: string, reason: Failure, detail: string | null) =>
	copyOf(reason, {
		HandleTaken: { title, description: "Another group already has this handle." },
		Invalid: { title, description: detail ?? "Check the name and handle." },
		NotFound: { title, description: "The group no longer exists." },
	})

const membersLabel = (count: number) => `${count} ${count === 1 ? "member" : "members"}`

// VIEW

const GroupsDef = Hazel.component({
	name: "GroupsPage",
	props: GroupsProps,
	model: GroupsModel,
	message: GroupsMessage,
	// After Back, a write that was in flight is not running any more.
	restore: (model) => ({
		...model,
		isPending: false,
		deleteConfirm: model.deleteConfirm._tag === "Running" ? Confirm.closed : model.deleteConfirm,
	}),
})

type H = Parameters<Parameters<typeof GroupsDef.make>[0]["view"]>[0]

interface FormMessages {
	readonly name: (payload: TextField.ChangePayload) => GroupsMessage
	readonly handle: (payload: TextField.ChangePayload) => GroupsMessage
}

const formFields = (h: H, key: string, form: Form, disabled: boolean, on: FormMessages) =>
	h.grid
		.key(key)
		.columns("2")
		.density("cozy")
		.children(
			h.textField
				.key("name")
				.label("Name")
				.placeholder("Design team")
				.value(form.name)
				.disabled(disabled)
				.on("change", on.name),
			h.textField
				.key("handle")
				.label("Handle")
				.placeholder("design")
				.prefix("@")
				.description(
					"Lowercase letters, numbers, hyphens, and underscores; not channel, here or everyone",
				)
				.value(form.handle)
				.disabled(disabled)
				.on("change", on.handle),
		)

const createForm = (h: H, model: GroupsModel, form: Form) =>
	// HAZEL-GAP(p4-settings-card-band): today's form is a bordered card (`p-4`) inside a `px-4 py-4 md:px-6` band over the table; the band is the frame's own `card`.
	h.stack
		.key("create")
		.inset("page")
		.children(
			h.frame.children(
				formFields(h, "create-fields", form, model.isPending, {
					name: (payload) => GroupsMessage.ChangedCreateName({ payload }),
					handle: (payload) => GroupsMessage.ChangedCreateHandle({ payload }),
				}),
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.children(
						h.spacer,
						h.button
							.key("cancel")
							.label("Cancel")
							.variant("secondary")
							.size("small")
							.disabled(model.isPending)
							.on("press", GroupsMessage.PressedCancelCreate()),
						h.button
							.key("create")
							.label("Create group")
							.size("small")
							.loading(model.isPending)
							.disabled(model.isPending || !isFormComplete(form))
							.on("press", GroupsMessage.PressedCreateGroup()),
					),
			),
		)

// HAZEL-GAP(p4-table-column-widths): today's Actions column is `w-40`; `wide` is w-44.
const COLUMNS = [
	{ key: "group", label: "Group", width: "fill" },
	{ key: "members", label: "Members", width: "regular" },
	{ key: "actions", label: "Actions", align: "end", width: "wide" },
] as const

const groupRow = (h: H, model: GroupsModel, group: Group, isAdmin: boolean) =>
	h.tableRow.key(group.id).children(
		h.tableCell
			.column("group")
			.children(
				h.stack
					.density("none")
					.children(
						h.text.strong().truncate().children(`@${group.handle}`),
						h.text.role("caption").tone("muted").truncate().children(group.name),
					),
			),
		h.tableCell.column("members").children(h.badge.label(membersLabel(group.memberIds.length))),
		h.tableCell.column("actions").children(
			h.stack
				.axis("horizontal")
				.align("center")
				.density("tight")
				.children(
					h.spacer,
					// HAZEL-GAP(p4-button-aria): today's Manage button names its group (`Manage @design`) and reports `aria-expanded`.
					h.button
						.key("manage")
						.label(isAdmin ? "Manage" : "View")
						.variant("ghost")
						.size("xsmall")
						.selected(model.selectedId === group.id)
						.on("press", GroupsMessage.PressedGroup({ id: group.id })),
					isAdmin
						? h.button
								.key("delete")
								.label(`Delete @${group.handle}`)
								.icon("trash")
								.iconOnly()
								.variant("danger")
								.size("small")
								.on(
									"press",
									GroupsMessage.PressedDeleteGroup({ id: group.id, handle: group.handle }),
								)
						: null,
				),
		),
	)

const groupList = (h: H, model: GroupsModel, isAdmin: boolean) =>
	model.groups !== null && model.groups.length === 0
		? h.emptyState
				.key("empty")
				.icon("profiles")
				.title("No groups yet")
				.description(
					isAdmin
						? "Create a group to mention a whole team at once, like @design."
						: "Owners and admins can create groups to mention a whole team at once.",
				)
				.action(
					isAdmin
						? h.button
								.label("New group")
								.size("small")
								.on("press", GroupsMessage.PressedNewGroup())
						: undefined,
				)
		: h.table
				.key("groups")
				.label("Groups")
				.columns(COLUMNS)
				.loading(model.groups === null)
				.loadingRows(3)
				.children(...(model.groups ?? []).map((group) => groupRow(h, model, group, isAdmin)))

const memberItem = (h: H, member: OrgMember, action: ReturnType<H["button"]["label"]> | null) =>
	h.item
		.key(member.userId)
		.title(member.name)
		.subtitle(member.email)
		.leading(
			h.avatar
				.name(member.name)
				.src(member.avatarUrl ?? undefined)
				.size("medium"),
		)
		.trailing(action)

const groupPanel = (h: H, model: GroupsModel, group: Group, isAdmin: boolean) => {
	const inGroup = new Set<string>(group.memberIds)
	const members = model.members.filter((member) => inGroup.has(member.userId))
	const search = model.memberSearch.text.trim().toLowerCase()
	const matching = model.members.filter(
		(member) =>
			search === "" ||
			member.name.toLowerCase().includes(search) ||
			member.email.toLowerCase().includes(search),
	)
	const suggestions = matching.filter((member) => !inGroup.has(member.userId)).slice(0, MAX_SUGGESTIONS)
	const edit = model.edit
	return settingsCard(
		h,
		"group-panel",
		cardHeader(h, {
			title: `@${group.handle}`,
			subtitle: group.name,
			badge: membersLabel(members.length),
			actions: [
				h.button
					.key("close")
					.label("Close")
					.variant("secondary")
					.size("small")
					.on("press", GroupsMessage.PressedCloseGroup()),
			],
		}),
		// HAZEL-GAP(p4-settings-card-band): today's panel body is `px-4 pb-6 md:px-6` with no hairline under the header.
		h.stack
			.key("body")
			.inset("page")
			.density("relaxed")
			.children(
				isAdmin && edit !== null
					? h.stack
							.key("edit")
							.density("cozy")
							.children(
								formFields(h, "edit-fields", edit, model.isPending, {
									name: (payload) => GroupsMessage.ChangedEditName({ payload }),
									handle: (payload) => GroupsMessage.ChangedEditHandle({ payload }),
								}),
								h.stack.axis("horizontal").children(
									h.spacer,
									h.button
										.key("save")
										.label("Save")
										.size("small")
										.disabled(
											model.isPending ||
												!isFormComplete(edit) ||
												(edit.name.text.trim() === group.name &&
													edit.handle.text === group.handle),
										)
										.on("press", GroupsMessage.PressedSaveGroup()),
								),
							)
					: null,
				h.section
					.key("members")
					.title("Members")
					.style("list")
					.children(
						...(members.length === 0
							? [h.text.key("none").tone("muted").children("No one is in this group yet.")]
							: members.map((member) =>
									memberItem(
										h,
										member,
										isAdmin
											? h.button
													.label("Remove")
													.variant("ghost")
													.size("xsmall")
													.disabled(model.isPending)
													.on(
														"press",
														GroupsMessage.PressedRemoveMember({
															userId: member.userId,
														}),
													)
											: null,
									),
								)),
					),
				isAdmin
					? h.stack
							.key("add")
							.density("compact")
							.children(
								h.textField
									.key("search")
									.label("Add members")
									.placeholder("Search people")
									.value(model.memberSearch)
									.on("change", (payload) =>
										GroupsMessage.ChangedMemberSearch({ payload }),
									),
								suggestions.length === 0
									? h.text
											.key("no-suggestions")
											.tone("muted")
											.children(
												matching.length === 0
													? "No people match."
													: "Everyone who matches is in the group.",
											)
									: h.section
											.key("suggestions")
											.style("list")
											.children(
												...suggestions.map((member) =>
													memberItem(
														h,
														member,
														h.button
															.label("Add")
															.variant("secondary")
															.size("xsmall")
															.disabled(model.isPending)
															.on(
																"press",
																GroupsMessage.PressedAddMember({
																	userId: member.userId,
																}),
															),
													),
												),
											),
							)
					: null,
			),
	)
}

/** Add or remove `userId` in the open group, one change at a time; null when nothing can run. */
const memberChange = (model: GroupsModel, session: Session, change: "add" | "remove", userId: UserId) => {
	const group = selectedGroup(model)
	const organization = session.organization
	if (group === undefined || organization === null || model.isPending) return null
	return ChangeGroupMember.make({ organizationId: organization.id, groupId: group.id, userId, change })
}

const toast = (title: string, reason: Failure, detail: string | null) =>
	ShowToast.make({ toast: errorToast(failureCopy(title, reason, detail)) })

export const GroupsPageNoDeps = GroupsDef.make({
	init: () => ({
		groups: null,
		members: [],
		create: null,
		selectedId: null,
		edit: null,
		memberSearch: TextField.empty,
		isPending: false,
		deleteConfirm: Confirm.closed,
	}),
	update: {
		UpdatedGroups: ($, { groups }) => {
			const next = { ...$.model, groups }
			// The open group was deleted (here or elsewhere): close it.
			return $.set(
				next.selectedId !== null && !groups.some((group) => group.id === next.selectedId)
					? select(next, null)
					: next,
			)
		},
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		// An open form stays as typed: the header's and the empty state's buttons both open it.
		PressedNewGroup: ($) => $.evolve({ create: (form) => form ?? emptyForm }),
		ChangedCreateName: ($, { payload }) =>
			$.evolve({ create: (form) => (form === null ? null : withName(form, payload)) }),
		ChangedCreateHandle: ($, { payload }) =>
			$.evolve({ create: (form) => (form === null ? null : withHandle(form, payload)) }),
		PressedCancelCreate: ($) => $.evolve({ create: () => null }),
		PressedCreateGroup: ($) => {
			const form = $.model.create
			const organization = $.props.session.organization
			if (form === null || !isFormComplete(form) || organization === null || $.model.isPending)
				return $.model
			return $.evolve({ isPending: () => true }).run(
				CreateGroup.make({
					organizationId: organization.id,
					handle: form.handle.text,
					name: form.name.text.trim(),
				}),
			)
		},
		// Open the new group to add its members, with its rename form.
		SucceededCreateGroup: ($, { id, handle, name }) =>
			$.set({
				...$.model,
				isPending: false,
				create: null,
				selectedId: id,
				edit: formOf({ name, handle }),
				memberSearch: TextField.empty,
			}).run(ShowToast.make({ toast: successToast(`@${handle} created`) })),
		FailedCreateGroup: ($, { reason, detail }) =>
			$.evolve({ isPending: () => false }).run(toast("Failed to create group", reason, detail)),
		PressedGroup: ($, { id }) => $.set(select($.model, $.model.selectedId === id ? null : id)),
		PressedCloseGroup: ($) => $.set(select($.model, null)),
		ChangedEditName: ($, { payload }) =>
			$.evolve({
				edit: (form) =>
					form === null ? null : { ...form, name: TextField.changed(form.name, payload) },
			}),
		ChangedEditHandle: ($, { payload }) =>
			$.evolve({ edit: (form) => (form === null ? null : withHandle(form, payload)) }),
		PressedSaveGroup: ($) => {
			const group = selectedGroup($.model)
			const form = $.model.edit
			const organization = $.props.session.organization
			if (group === undefined || form === null || organization === null || $.model.isPending)
				return $.model
			if (!isFormComplete(form)) return $.model
			return $.evolve({ isPending: () => true }).run(
				SaveGroup.make({
					organizationId: organization.id,
					id: group.id,
					handle: form.handle.text,
					name: form.name.text.trim(),
				}),
			)
		},
		SucceededSaveGroup: ($, { handle }) =>
			$.evolve({ isPending: () => false }).run(
				ShowToast.make({ toast: successToast(`@${handle} saved`) }),
			),
		FailedSaveGroup: ($, { reason, detail }) =>
			$.evolve({ isPending: () => false }).run(toast("Failed to save group", reason, detail)),
		ChangedMemberSearch: ($, { payload }) =>
			$.evolve({ memberSearch: (search) => TextField.changed(search, payload) }),
		PressedAddMember: ($, { userId }) => {
			const change = memberChange($.model, $.props.session, "add", userId)
			return change === null ? $.model : $.evolve({ isPending: () => true }).run(change)
		},
		PressedRemoveMember: ($, { userId }) => {
			const change = memberChange($.model, $.props.session, "remove", userId)
			return change === null ? $.model : $.evolve({ isPending: () => true }).run(change)
		},
		SucceededChangeMembers: ($) => $.evolve({ isPending: () => false }),
		FailedChangeMembers: ($, { reason, detail }) =>
			$.evolve({ isPending: () => false }).run(toast("Failed to change members", reason, detail)),
		PressedDeleteGroup: ($, { id, handle }) =>
			$.evolve({ deleteConfirm: (state) => Confirm.ask(state, { id, handle }) }),
		CancelledDelete: ($) => $.evolve({ deleteConfirm: Confirm.cancel }),
		PressedConfirmDelete: ($) => {
			const organization = $.props.session.organization
			const confirmed = Confirm.confirm($.model.deleteConfirm)
			if (organization === null || confirmed === undefined) return $.model
			const [deleteConfirm, target] = confirmed
			return $.evolve({ deleteConfirm: () => deleteConfirm }).run(
				DeleteGroup.make({ organizationId: organization.id, id: target.id, handle: target.handle }),
			)
		},
		SucceededDeleteGroup: ($, { handle }) =>
			$.evolve({ deleteConfirm: () => Confirm.closed }).run(
				ShowToast.make({ toast: successToast(`@${handle} deleted`) }),
			),
		FailedDeleteGroup: ($, { reason, detail }) =>
			$.evolve({ deleteConfirm: Confirm.failed }).run(toast("Failed to delete group", reason, detail)),
	},
	subscriptions: ({ props }) => {
		const organization = props.session.organization
		if (organization === null) return []
		return [
			Subscription.make("groups", [organization.id], ([id]) =>
				groupsStream(OrganizationId.make(id), (groups) => GroupsMessage.UpdatedGroups({ groups })),
			),
			Subscription.make("members", [organization.id], ([id]) =>
				membersStream(OrganizationId.make(id), (members) =>
					GroupsMessage.UpdatedMembers({ members }),
				),
			),
		]
	},
	view: (h, model) => {
		const { session } = h.props
		if (session.organization === null) return h.stack.key("groups-page")
		const isAdmin = canManage(session)
		const group = selectedGroup(model)
		const count = model.groups?.length
		return settingsColumn(
			h,
			"groups-page",
			settingsCard(
				h,
				"groups-card",
				cardHeader(h, {
					icon: "profiles",
					title: "Groups",
					subtitle: "Mention a group with its @handle to notify everyone in it.",
					badge: count === undefined ? undefined : `${count} ${count === 1 ? "group" : "groups"}`,
					actions:
						isAdmin && model.create === null
							? [
									h.button
										.key("new-group")
										.label("New group")
										.icon("plus")
										.variant("secondary")
										.on("press", GroupsMessage.PressedNewGroup()),
								]
							: [],
				}),
				h.divider.key("header-rule"),
				isAdmin && model.create !== null ? createForm(h, model, model.create) : null,
				isAdmin && model.create !== null ? h.divider.key("create-rule") : null,
				groupList(h, model, isAdmin),
			),
			group === undefined ? null : groupPanel(h, model, group, isAdmin),
			// HAZEL-GAP(p4-dialog-description-strong): today's description sets `@handle` in bold.
			Confirm.confirmDialog(h, model.deleteConfirm, {
				key: "delete-group",
				title: "Delete group",
				description: `Delete @${Confirm.targetOf(model.deleteConfirm)?.handle ?? ""}? Mentions of it in earlier messages stop notifying anyone.`,
				confirmLabel: "Delete group",
				runningLabel: "Deleting...",
				confirmed: GroupsMessage.PressedConfirmDelete(),
				cancelled: GroupsMessage.CancelledDelete(),
			}),
		)
	},
})

/** The page with its writes, on the host's `HazelRpc`. */
export const GroupsPage = GroupsPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(CreateGroup.layer, SaveGroup.layer, ChangeGroupMember.layer, DeleteGroup.layer),
	),
)
