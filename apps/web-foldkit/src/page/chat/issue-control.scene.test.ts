// @vitest-environment jsdom
import { ChannelId, CustomerAccountId, CustomerIssueId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { type IssueRow, STATUS_LABEL } from "../../customers/issues"
import * as IssueControl from "./issue-control"

/**
 * The thread panel's issue strip for a thread filed as not support (`docs/customers/issues.md`
 * § Triage): it reads as a thread with no issue, and "Create issue" brings it back.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const rootMessageId = Schema.decodeSync(MessageId)(uuid(1))
const author = Schema.decodeSync(UserId)(uuid(2))

const issue: IssueRow = {
	id: Schema.decodeSync(CustomerIssueId)(uuid(3)),
	accountId: Schema.decodeSync(CustomerAccountId)(uuid(4)),
	sourceChannelId: Schema.decodeSync(ChannelId)(uuid(5)),
	rootMessageId,
	threadChannelId: null,
	joinedMessageIds: [],
	openedByUserId: author,
	createdByUserId: null,
	title: "yup",
	status: "waiting_on_us",
	triage: null,
	triagedByUserId: null,
	priority: "none",
	assigneeUserId: null,
	tags: [],
	openedAtMs: 0,
	firstCustomerMessageAtMs: 0,
	lastCustomerMessageAtMs: 0,
	firstTeamReplyAtMs: null,
	lastTeamReplyAtMs: null,
	lastMessageAtMs: 0,
	closedAtMs: null,
	reopenCount: 0,
	messageCount: 1,
}

const context = { organizationId: null, currentUserId: author }

const scene = {
	update: (model: IssueControl.Model, message: IssueControl.Message) => ({
		model: IssueControl.update(model, message, context).model,
		commands: [],
	}),
	view: (model: IssueControl.Model, h: HtmlBuilder<IssueControl.Message>): Html =>
		IssueControl.view(h, {
			model,
			inboxHref: "/customers/inbox",
			currentUserId: author,
			nowMs: 0,
			toMessage: (message) => message,
		}),
}

const loaded = (row: IssueRow | null): IssueControl.Model => ({
	...IssueControl.init(rootMessageId),
	issue: row,
	hasLoaded: true,
})

const filed: IssueRow = { ...issue, status: "closed", triage: "chatter", closedAtMs: 0 }
const restored: IssueRow = { ...filed, status: "waiting_on_us", triage: "support", closedAtMs: null }
const updated = (row: IssueRow) => IssueControl.Message.UpdatedIssue({ rootMessageId, issue: row })

describe("the issue strip of a thread filed as not support", () => {
	test("shows Create issue and none of the issue's chips", () => {
		Scene.scene(
			scene,
			Scene.given(loaded(filed)),
			Scene.expect(Scene.role("button", { name: "Create issue" })).toExist(),
			Scene.expect(Scene.text(STATUS_LABEL.closed)).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Create issue" })),
			Scene.expect(Scene.role("button", { name: "Creating issue..." })).toExist(),
		)
	})

	test("stays pending until the restored issue arrives", () => {
		const started = IssueControl.update(loaded(filed), IssueControl.Message.ClickedCreateIssue(), context)
		expect(started.model.isCreating).toBe(true)
		expect(started.outMessage).toEqual(IssueControl.OutMessage.RequestedCreateIssue())
		// The filed row arriving again is not the answer: the create is still running.
		const echoed = IssueControl.update(started.model, updated(filed), context).model
		expect(echoed.isCreating).toBe(true)
		const back = IssueControl.update(echoed, updated(restored), context).model
		expect(back.isCreating).toBe(false)
		expect(back.issue?.triage).toBe("support")
	})
})
