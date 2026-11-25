// @vitest-environment jsdom
import { UserGroupId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { successToast } from "../../../data/actions"
import {
	makeShared,
	memberWithRole,
	organizationId,
	pageScene,
	portalModalMounted,
	uuid,
} from "../../../test/pages-fixtures"
import * as Modal from "../../../ui/modal"
import { PageOutMessage } from "../../out-message"
import { AddGroupMember, CreateGroup, DeleteGroup, RemoveGroupMember } from "./command"
import { Message } from "./message"
import type { Group, OrgMember } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** Groups through the view: create, manage members, delete; read-only for members. */

const owner = makeShared()
const member = makeShared({ member: memberWithRole("member") })
const person = (n: number, name: string): OrgMember => ({
	userId: Schema.decodeSync(UserId)(uuid(200 + n)),
	name,
	email: `${name.split(" ")[0]!.toLowerCase()}@hazel.test`,
	avatarUrl: null,
})
const ada = person(1, "Ada Lovelace")
const grace = person(2, "Grace Hopper")
const design: Group = {
	id: Schema.decodeSync(UserGroupId)(uuid(40)),
	handle: "design",
	name: "Design team",
	description: null,
	memberIds: [ada.userId],
}
const withGroups = (groups: ReadonlyArray<Group>) => ({ ...init().model, groups, members: [ada, grace] })

const newGroup = Scene.role("button", { name: "New group" })
const row = Scene.first(Scene.filter(Scene.all.role("row"), { hasText: "@design" }))
const deleteDialog = Scene.role("dialog", { name: "Delete group" })

describe("list", () => {
	test("the skeleton gives way to the empty state; only admins may create", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init().model),
			Scene.expect(Scene.text("No groups yet")).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedGroups({ groups: [] })),
			Scene.expect(Scene.text("No groups yet")).toExist(),
			Scene.expectAll(Scene.all.role("button", { name: "New group" })).toHaveCount(2),
		)
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(withGroups([])),
			Scene.expect(newGroup).toBeAbsent(),
		)
	})

	test("rows show the handle, name and size", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withGroups([design])),
			Scene.expect(Scene.within(row, Scene.text("Design team"))).toExist(),
			Scene.expect(Scene.within(row, Scene.text("1 member"))).toExist(),
		)
	})
})

describe("create", () => {
	test("the handle follows the name until typed; Create sends it, then the group opens", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withGroups([])),
			Scene.click(Scene.first(Scene.all.role("button", { name: "New group" }))),
			Scene.type(Scene.label("Name"), "Design Team"),
			Scene.expect(Scene.label("Handle")).toHaveValue("design-team"),
			Scene.type(Scene.label("Handle"), "Design!"),
			Scene.expect(Scene.label("Handle")).toHaveValue("design"),
			Scene.click(Scene.role("button", { name: "Create group" })),
			Scene.Command.expectExact(CreateGroup({ organizationId, handle: "design", name: "Design Team" })),
			Scene.Command.resolve(
				CreateGroup,
				Message.SucceededCreateGroup({ id: design.id, handle: "design", name: "Design Team" }),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("@design created") })),
			Scene.Subscription.emit(Message.UpdatedGroups({ groups: [{ ...design, memberIds: [] }] })),
			Scene.expect(Scene.text("No one is in this group yet.")).toExist(),
			// The new group opens ready to rename, without closing it first.
			Scene.expect(Scene.label("Name")).toHaveValue("Design Team"),
			Scene.type(Scene.label("Handle"), "designers"),
			Scene.expect(Scene.label("Handle")).toHaveValue("designers"),
		)
	})
})

describe("members", () => {
	test("an admin adds and removes members", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withGroups([design])),
			Scene.click(Scene.role("button", { name: "Manage @design" })),
			Scene.click(Scene.role("button", { name: "Add Grace Hopper" })),
			Scene.Command.expectExact(
				AddGroupMember({ organizationId, groupId: design.id, userId: grace.userId }),
			),
			Scene.Command.resolve(AddGroupMember, Message.SucceededChangeMembers()),
			Scene.click(Scene.role("button", { name: "Remove Ada Lovelace" })),
			Scene.Command.expectExact(
				RemoveGroupMember({ organizationId, groupId: design.id, userId: ada.userId }),
			),
			Scene.Command.resolve(RemoveGroupMember, Message.SucceededChangeMembers()),
		)
	})

	test("Add members tells a search that matches nobody from one whose matches are all in", () => {
		const search = Scene.role("textbox", { name: "Add members" })
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withGroups([design])),
			Scene.click(Scene.role("button", { name: "Manage @design" })),
			Scene.type(search, "zzz"),
			Scene.expect(Scene.text("No people match.")).toExist(),
			Scene.type(search, "ada"),
			Scene.expect(Scene.text("Everyone who matches is in the group.")).toExist(),
		)
	})

	test("a member sees who is in a group, read-only", () => {
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(withGroups([design])),
			Scene.expect(Scene.role("button", { name: "Delete @design" })).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "View @design" })),
			Scene.expect(Scene.text("Ada Lovelace")).toExist(),
			Scene.expect(Scene.role("button", { name: "Remove Ada Lovelace" })).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Add Grace Hopper" })).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Save" })).toBeAbsent(),
		)
	})
})

describe("delete", () => {
	test("confirming the dialog deletes the group and toasts", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withGroups([design])),
			Scene.click(Scene.role("button", { name: "Delete @design" })),
			portalModalMounted,
			Scene.click(Scene.role("button", { name: "Delete group" })),
			Scene.Command.expectExact(DeleteGroup({ organizationId, id: design.id, handle: "design" })),
			Scene.Command.resolve(DeleteGroup, Message.SucceededDeleteGroup({ handle: "design" })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("@design deleted") })),
			Scene.expect(deleteDialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
		)
	})
})
