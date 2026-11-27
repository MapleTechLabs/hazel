// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { ChannelId, MessageId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { CreateChannel, CreateChannelMessage, CreateChannelModalNoDeps } from "./CreateChannelModal"
import { DeleteChannel, DeleteChannelMessage, DeleteChannelModalNoDeps } from "./DeleteChannelModal"
import { DeleteMessage, DeleteMessageModalNoDeps } from "./DeleteMessageModal"
import { ModalEvents } from "./feedback"
import { JoinChannel, JoinChannelMessage, JoinChannelModalNoDeps } from "./JoinChannelModal"
import { RenameChannel, RenameChannelMessage, RenameChannelModalNoDeps } from "./RenameChannelModal"
import {
	ada,
	button,
	byProp,
	dialog,
	field,
	organizationId,
	session,
	subscriptionKey,
	typed,
} from "./test-support"

/** The channel modals: create, browse and join, rename (channel or thread), delete, and delete a message. */

const channelId = ChannelId.make("00000004-0000-4000-8000-000000000001")
const otherId = ChannelId.make("00000004-0000-4000-8000-000000000002")
const close = ModalEvents.RequestedClose()

describe("create channel modal", () => {
	const start = () => Scene.start(CreateChannelModalNoDeps, { session })

	test("a short name says why and blocks the submit", () => {
		const s = start().fire(field("Channel name"), "change", typed("ab"))
		expect(s.get(field("Channel name")).props?.["error"]).toBe(
			"Channel name must be at least 3 characters",
		)
		expect(s.get(button("Create channel")).props?.["disabled"]).toBe(true)
	})

	test("a private channel with every member is created, opened, and the modal closes", () => {
		const s = start()
			.fire(field("Channel name"), "change", typed("launch"))
			.fire(byProp("select", "label", "Channel type"), "change", { value: "private" })
			.fire(byProp("toggle", "label", "Add all members to this channel"), "change", { checked: true })
			.fire(button("Create channel"), "press")
			.expectExact(
				CreateChannel.make({
					name: "launch",
					type: "private",
					organizationId,
					currentUserId: ada.id,
					addAllMembers: true,
					orgSlug: "hazel",
				}),
			)
		expect(s.get(button("Creating...")).props?.["disabled"]).toBe(true)
		s.resolve(CreateChannel, CreateChannelMessage.SucceededCreateChannel()).emitted(close)
	})
})

describe("browse channels modal", () => {
	const start = () =>
		Scene.start(JoinChannelModalNoDeps, { session })
			.subscription(
				subscriptionKey("memberChannels", ada.id),
				JoinChannelMessage.UpdatedMemberChannels({ channelIds: [channelId] }),
			)
			.subscription(
				subscriptionKey("channels", organizationId),
				JoinChannelMessage.UpdatedChannels({
					channels: [
						{ id: channelId, name: "general" },
						{ id: otherId, name: "design" },
					],
				}),
			)
	const row = (title: string) => byProp("item", "title", title)

	test("offers only the channels not joined, filtered by the search", () => {
		const s = start().expect(row("design")).toExist().expect(row("general")).toBeAbsent()
		s.fire(byProp("searchField", "placeholder", "Search channels..."), "change", typed("zzz"))
			.expect(byProp("emptyState", "title", "No channels found matching your search"))
			.toExist()
	})

	test("join runs, then the modal closes", () => {
		start()
			.fire(button("Join"), "press")
			.expectExact(JoinChannel.make({ channelId: otherId, userId: ada.id }))
			.resolve(JoinChannel, JoinChannelMessage.SucceededJoinChannel())
			.emitted(close)
	})

	test("with everything joined it says so", () => {
		Scene.start(JoinChannelModalNoDeps, { session })
			.subscription(
				subscriptionKey("memberChannels", ada.id),
				JoinChannelMessage.UpdatedMemberChannels({ channelIds: [channelId] }),
			)
			.subscription(
				subscriptionKey("channels", organizationId),
				JoinChannelMessage.UpdatedChannels({ channels: [{ id: channelId, name: "general" }] }),
			)
			.expect(byProp("emptyState", "title", "You've already joined all available channels"))
			.toExist()
	})
})

describe("rename modal", () => {
	test("the field follows the live name until edited; an unchanged name just closes", () => {
		const s = Scene.start(RenameChannelModalNoDeps, { channelId, kind: "channel" })
			.expect(dialog("Rename channel"))
			.toExist()
			.subscription(
				subscriptionKey("channel", channelId),
				RenameChannelMessage.UpdatedChannel({ name: "general" }),
			)
		expect(s.get(field("Channel name")).props?.["value"]).toMatchObject({ text: "general" })
		s.fire(button("Rename"), "press").emitted(close)
	})

	test("a thread renames with its own copy; the trimmed name is saved", () => {
		const s = Scene.start(RenameChannelModalNoDeps, { channelId, kind: "thread" })
			.subscription(
				subscriptionKey("channel", channelId),
				RenameChannelMessage.UpdatedChannel({ name: "Benchmarks" }),
			)
			.expect(dialog("Rename thread"))
			.toExist()
		const edit = (s.get(field("Thread name")).props?.["value"] as { readonly edit: number }).edit
		s.fire(field("Thread name"), "submit", { value: " Release benchmarks ", rev: 2, edit })
			.expectExact(RenameChannel.make({ channelId, name: "Release benchmarks", kind: "thread" }))
			.resolve(RenameChannel, RenameChannelMessage.SucceededRenameChannel())
			.emitted(close)
	})
})

describe("delete channel modal", () => {
	const start = (routeChannelId: ChannelId | null) =>
		Scene.start(DeleteChannelModalNoDeps, { channelId, channelName: "general", session, routeChannelId })

	test("names the channel and leaves its page for the chat index", () => {
		const s = start(channelId)
		expect(s.get(dialog("Delete channel")).props?.["description"]).toContain("#general")
		s.fire(button("Delete channel"), "press")
			.expectExact(DeleteChannel.make({ channelId, leaveTo: "/hazel/chat" }))
			.resolve(DeleteChannel, DeleteChannelMessage.SucceededDeleteChannel())
			.emitted(close)
	})

	test("from another page it stays where it is; a failure keeps the modal open", () => {
		const s = start(otherId)
			.fire(button("Delete channel"), "press")
			.expectExact(DeleteChannel.make({ channelId, leaveTo: null }))
		expect(s.get(button("Deleting...")).props?.["loading"]).toBe(true)
		s.resolve(DeleteChannel, DeleteChannelMessage.FailedDeleteChannel())
			.expect(button("Delete channel"))
			.toExist()
	})
})

describe("delete message modal", () => {
	const messageId = MessageId.make("00000005-0000-4000-8000-000000000001")

	test("confirming closes at once while the delete runs", () => {
		Scene.start(DeleteMessageModalNoDeps, { messageId })
			.fire(button("Delete message"), "press")
			.emitted(close)
			.expectExact(DeleteMessage.make({ messageId }))
			.resolve(DeleteMessage, Component.noop)
	})

	test("cancel closes without deleting", () => {
		Scene.start(DeleteMessageModalNoDeps, { messageId }).fire(button("Cancel"), "press").emitted(close)
	})
})
