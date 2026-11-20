import { ChannelId, CustomerAccountId, CustomerIssueId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import type { IssueRow } from "../../../customers/issues"
import * as Composer from "../../../composer/composer"
import * as EditorCommands from "../../../composer/editor-commands"
import * as Menu from "../../../ui/menu"
import { PageOutMessage } from "../../out-message"
import * as IssueControl from "../issue-control"
import { ActionMessage, CreateIssueFromMessage } from "../message-actions"
import * as Overlays from "../overlays"
import {
	ada,
	adaMessageId,
	channelId,
	grace,
	graceMessageId,
	loadedModel,
	organizationId,
	updateWithShared,
} from "./fixtures.test-support"
import { Message, type Model } from "./model"
import { factsOf } from "./page"
import { LoadThreadPanelWidth } from "./thread-width"

/** Support issues in chat: the "Create issue" message action and the thread panel's issue control. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const accountId = Schema.decodeSync(CustomerAccountId)(uuid(7))
const issueId = Schema.decodeSync(CustomerIssueId)(uuid(8))
const threadChannelId = Schema.decodeSync(ChannelId)(uuid(9))

const linkedModel = (): Model => ({
	...loadedModel(),
	customer: {
		channelId,
		organizationId: Schema.decodeSync(OrganizationId)(uuid(6)),
		accountId,
		accountName: "Acme",
		accountLogoUrl: null,
		healthStatus: "unknown",
		healthScore: null,
		healthWhy: null,
		lifecycleStage: null,
		planName: null,
		mrrMinor: null,
		currency: null,
		ownerUserId: null,
		seatsUsed: null,
		seatsLimit: null,
		lastActiveDay: null,
		openSignalCount: 0,
		topSignals: [],
		sourceLinks: [],
		updatedAt: new Date(0),
	},
})

const issue: IssueRow = {
	id: issueId,
	accountId,
	sourceChannelId: channelId,
	rootMessageId: graceMessageId,
	threadChannelId,
	joinedMessageIds: [],
	openedByUserId: grace,
	createdByUserId: null,
	title: "Launch window confirmed",
	status: "new",
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

const overlays = (inner: Overlays.Message) => Message.GotOverlaysMessage({ message: inner })
const issueControl = (inner: IssueControl.Message) => Message.GotIssueControlMessage({ message: inner })
const openThread = Message.ClickedThreadPreview({ threadChannelId, messageId: graceMessageId })
/** What opening the panel starts: reading its width and focusing its composer. */
const openedThread = [
	Command.resolve(LoadThreadPanelWidth, Message.LoadedThreadPanelWidth({ width: null })),
	Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),
] as const
/** A pick from a menu, as the system menu reports it. */
const pick = (key: string) => Menu.Message.ChoseFromNativeMenu({ key, entries: [Menu.item(key)] })

describe("the Create issue message action", () => {
	test("offered on top-level messages of a linked channel without an issue", () => {
		expect(factsOf(loadedModel()).canCreateIssue(graceMessageId)).toBe(false)
		const linked = linkedModel()
		expect(factsOf(linked).canCreateIssue(graceMessageId)).toBe(true)
		const withIssue = { ...linked, issueRootIds: [graceMessageId] }
		expect(factsOf(withIssue).canCreateIssue(graceMessageId)).toBe(false)
		expect(factsOf(withIssue).canCreateIssue(adaMessageId)).toBe(true)
		const keys = Overlays.contextMenuEntries(factsOf(linked), graceMessageId, null).flatMap((entry) =>
			entry._tag === "Item" ? [entry.item.key] : [],
		)
		expect(keys).toContain("create-issue")
	})

	test("runs `customers.issue.createFromMessage` and toasts", () => {
		story(
			updateWithShared,
			given(linkedModel()),
			message(
				overlays(
					Overlays.Message.ChoseNativeAction({ messageId: graceMessageId, value: "create-issue" }),
				),
			),
			Command.expectExact(
				CreateIssueFromMessage({ organizationId, channelId, messageId: graceMessageId }),
			),
			Command.resolve(
				CreateIssueFromMessage,
				ActionMessage.SucceededCreateIssue({ messageId: graceMessageId }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Issue created",
						description: "Find it in the support inbox.",
					},
				}),
			),
		)
	})

	test("does nothing in a channel not linked to a customer", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(
				overlays(
					Overlays.Message.ChoseNativeAction({ messageId: graceMessageId, value: "create-issue" }),
				),
			),
			Command.expectNone(),
		)
	})
})

describe("the thread panel's issue control", () => {
	test("shows the issue of the thread's root message and drops another thread's", () => {
		story(
			updateWithShared,
			given(linkedModel()),
			message(openThread),
			...openedThread,
			message(issueControl(IssueControl.Message.UpdatedIssue({ rootMessageId: adaMessageId, issue }))),
			model((current) => expect(current.threadPanel?.issue.hasLoaded).toBe(false)),
			message(
				issueControl(IssueControl.Message.UpdatedIssue({ rootMessageId: graceMessageId, issue })),
			),
			model((current) => {
				expect(current.threadPanel?.issue.hasLoaded).toBe(true)
				expect(current.threadPanel?.issue.issue?.id).toBe(issueId)
			}),
		)
	})

	test("a status or assignee pick runs the optimistic update", () => {
		story(
			updateWithShared,
			given(linkedModel()),
			message(openThread),
			...openedThread,
			message(
				issueControl(IssueControl.Message.UpdatedIssue({ rootMessageId: graceMessageId, issue })),
			),
			message(
				issueControl(
					IssueControl.Message.GotStatusMenuMessage({ message: pick("waiting_on_customer") }),
				),
			),
			Command.expectHas(
				IssueControl.UpdateThreadIssue({
					organizationId,
					issueId,
					actor: ada,
					change: { status: "waiting_on_customer" },
				}),
			),
			Command.resolve(IssueControl.UpdateThreadIssue, IssueControl.Message.SucceededUpdateIssue()),
			message(
				issueControl(
					IssueControl.Message.GotAssignMenuMessage({ message: pick(IssueControl.ASSIGN_ME) }),
				),
			),
			Command.expectHas(
				IssueControl.UpdateThreadIssue({
					organizationId,
					issueId,
					actor: ada,
					change: { assigneeUserId: ada },
				}),
			),
			Command.resolve(IssueControl.UpdateThreadIssue, IssueControl.Message.SucceededUpdateIssue()),
		)
	})

	test("Create issue on a thread without one runs on its root message", () => {
		story(
			updateWithShared,
			given(linkedModel()),
			message(openThread),
			...openedThread,
			message(
				issueControl(
					IssueControl.Message.UpdatedIssue({ rootMessageId: graceMessageId, issue: null }),
				),
			),
			message(issueControl(IssueControl.Message.ClickedCreateIssue())),
			model((current) => expect(current.threadPanel?.issue.isCreating).toBe(true)),
			Command.expectHas(
				CreateIssueFromMessage({ organizationId, channelId, messageId: graceMessageId }),
			),
			Command.resolve(
				CreateIssueFromMessage,
				ActionMessage.FailedCreateIssue({ messageId: graceMessageId, reason: "InvalidRequest" }),
			),
			model((current) => expect(current.threadPanel?.issue.isCreating).toBe(false)),
		)
	})
})

describe("issue root ids", () => {
	test("a late answer for another channel is dropped", () => {
		const other = Schema.decodeSync(ChannelId)(uuid(10))
		const next = updateWithShared(
			linkedModel(),
			Message.UpdatedIssueRoots({ channelId: other, rootMessageIds: [graceMessageId] }),
		)
		expect(next.model.issueRootIds).toEqual([])
		const own = updateWithShared(
			linkedModel(),
			Message.UpdatedIssueRoots({ channelId, rootMessageIds: [graceMessageId] }),
		)
		expect(own.model.issueRootIds).toEqual([graceMessageId])
	})
})
