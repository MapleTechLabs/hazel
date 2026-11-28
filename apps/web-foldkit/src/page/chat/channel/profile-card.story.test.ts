import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import { AppRoute } from "../../../route"
import { PageOutMessage } from "../../out-message"
import { ActionMessage, CopyText } from "../message-actions"
import { ada, channelId, grace, loadedModel, organizationId, updateWithShared } from "./fixtures.test-support"
import { listRequests } from "./list-requests"
import { Message } from "./model"
import { FindUserDm } from "./user-dm"
import { RequestComposer } from "./write"

/** The shared message list's profile card: its requests, as the channel page carries them out. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const dmId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000009001")

describe("the profile card's requests", () => {
	test("each request becomes its page message", () => {
		expect(
			listRequests({ _tag: "MessageUser", userId: grace, viewerId: ada, name: "Grace Hopper" }),
		).toEqual([Message.ClickedMessageUser({ userId: grace, viewerId: ada, name: "Grace Hopper" })])
		expect(listRequests({ _tag: "ViewProfile", userId: grace })).toEqual([
			Message.ClickedViewProfile({ userId: grace }),
		])
		expect(listRequests({ _tag: "MentionUser", userId: grace })).toEqual([
			Message.ClickedMentionUser({ userId: grace }),
		])
		expect(listRequests({ _tag: "CopyProfileField", field: "email", text: "grace@hazel.test" })).toEqual([
			Message.ClickedCopyProfileField({ field: "email", text: "grace@hazel.test" }),
		])
	})
})

describe("Message", () => {
	test("an existing DM opens", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedMessageUser({ userId: grace, viewerId: ada, name: "Grace Hopper" })),
			Command.expectExact(
				FindUserDm({
					fromChannelId: channelId,
					organizationId,
					viewerId: ada,
					userId: grace,
					name: "Grace Hopper",
				}),
			),
			Command.resolve(
				FindUserDm,
				Message.FoundUserDm({
					fromChannelId: channelId,
					organizationId,
					userId: grace,
					name: "Grace Hopper",
					channelId: dmId,
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: AppRoute.ChatChannel({ orgSlug: "hazel", channelId: dmId }),
					replace: false,
				}),
			),
		)
	})

	test("with no DM yet, the app creates one", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedMessageUser({ userId: grace, viewerId: ada, name: "Grace Hopper" })),
			Command.resolve(
				FindUserDm,
				Message.FoundUserDm({
					fromChannelId: channelId,
					organizationId,
					userId: grace,
					name: "Grace Hopper",
					channelId: null,
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedDmCreation({
					organizationId,
					orgSlug: "hazel",
					userId: grace,
					name: "Grace Hopper",
				}),
			),
		)
	})

	test("an answer for a channel the user has left is dropped", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(
				Message.FoundUserDm({
					fromChannelId: dmId,
					organizationId,
					userId: grace,
					name: "Grace Hopper",
					channelId: null,
				}),
			),
			Command.expectNone(),
			expectNoOutMessage(),
		)
	})

	test("before the channel loads, nothing is looked up", () => {
		story(
			updateWithShared,
			given({ ...loadedModel(), channel: null }),
			message(Message.ClickedMessageUser({ userId: grace, viewerId: ada, name: "Grace Hopper" })),
			Command.expectNone(),
			expectNoOutMessage(),
		)
	})
})

describe("the menu", () => {
	test("View profile opens the person's profile page", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedViewProfile({ userId: grace })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: AppRoute.Profile({ orgSlug: "hazel", userId: grace }),
					replace: false,
				}),
			),
		)
	})

	test("Mention asks the focused composer for the person's mention", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedMentionUser({ userId: grace })),
			Command.expectExact(
				RequestComposer({ channelId, request: { _tag: "InsertMention", userId: grace } }),
			),
			Command.resolve(RequestComposer, Message.CompletedRequestComposer()),
		)
	})

	test("Copy email and Copy user ID copy, then say which", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedCopyProfileField({ field: "email", text: "grace@hazel.test" })),
			Command.expectExact(CopyText({ text: "grace@hazel.test", content: "Email" })),
			Command.resolve(CopyText, ActionMessage.SucceededCopyText({ content: "Email" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Email copied",
						description: "The email has been copied to your clipboard.",
					},
				}),
			),
		)
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedCopyProfileField({ field: "userId", text: grace })),
			Command.expectExact(CopyText({ text: grace, content: "UserId" })),
			Command.resolve(CopyText, ActionMessage.SucceededCopyText({ content: "UserId" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "User ID copied",
						description: "The user ID has been copied to your clipboard.",
					},
				}),
			),
		)
	})
})
