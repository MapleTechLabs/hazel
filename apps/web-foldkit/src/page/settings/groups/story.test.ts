import { UserGroupId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToast } from "../../../data/actions"
import { makeShared, organizationId, storyUpdate, uuid } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { CreateGroup, SaveGroup } from "./command"
import { Message } from "./message"
import type { Group } from "./model"
import { init, update } from "./update"

/** Update-loop tests for groups: handles, failures, and closing a group deleted elsewhere. */

const owner = storyUpdate(update, makeShared())
const design: Group = {
	id: Schema.decodeSync(UserGroupId)(uuid(40)),
	handle: "design",
	name: "Design team",
	description: null,
	memberIds: [Schema.decodeSync(UserId)(uuid(201))],
}

describe("create", () => {
	test("a taken handle keeps the form open and says so", () => {
		story(
			owner,
			given(init().model),
			message(Message.ClickedNewGroup()),
			message(Message.ChangedCreateName({ value: "Design" })),
			message(Message.ClickedCreateGroup()),
			Command.expectExact(CreateGroup({ organizationId, handle: "design", name: "Design" })),
			Command.resolve(CreateGroup, Message.FailedCreateGroup({ reason: "HandleTaken", detail: null })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Failed to create group", "Another group already has this handle."),
				}),
			),
			model((current) => {
				expect(current.create?.handle).toBe("design")
				expect(current.isPending).toBe(false)
			}),
		)
	})

	test("a second New group keeps what was typed", () => {
		story(
			owner,
			given(init().model),
			message(Message.ClickedNewGroup()),
			message(Message.ChangedCreateName({ value: "Design" })),
			message(Message.ClickedNewGroup()),
			model((current) => {
				expect(current.create?.name).toBe("Design")
				expect(current.create?.handle).toBe("design")
			}),
		)
	})

	test("nothing is sent without a name and handle", () => {
		story(
			owner,
			given(init().model),
			message(Message.ClickedNewGroup()),
			message(Message.ChangedCreateName({ value: "!!!" })),
			message(Message.ClickedCreateGroup()),
			Command.expectNone(),
		)
	})
})

describe("rename", () => {
	test("Save sends the new name and handle; the server's explanation is shown", () => {
		story(
			owner,
			given({ ...init().model, groups: [design] }),
			message(Message.ClickedGroup({ id: design.id })),
			message(Message.ChangedEditName({ value: "Designers" })),
			message(Message.ChangedEditHandle({ value: "Designers" })),
			message(Message.ClickedSaveGroup()),
			Command.expectExact(
				SaveGroup({ organizationId, id: design.id, handle: "designers", name: "Designers" }),
			),
			Command.resolve(
				SaveGroup,
				Message.FailedSaveGroup({ reason: "Invalid", detail: "@here is taken by a mention" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Failed to save group", "@here is taken by a mention"),
				}),
			),
		)
	})

	test("a group deleted elsewhere closes", () => {
		story(
			owner,
			given({ ...init().model, groups: [design] }),
			message(Message.ClickedGroup({ id: design.id })),
			model((current) => expect(current.edit).not.toBeNull()),
			message(Message.UpdatedGroups({ groups: [] })),
			model((current) => {
				expect(current.selectedId).toBeNull()
				expect(current.edit).toBeNull()
			}),
		)
	})
})
