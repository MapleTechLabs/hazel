// @vitest-environment jsdom
import { ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import { DismissSuggestion, SuggestionMessage } from "../../../customers/suggestions"
import { successToast } from "../../../data/actions"
import { CONTACT_SUGGESTION, suggestionFor } from "../../../lab/fixtures/customers-suggestions"
import { channelId, makeShared, organizationId, pageScene, uuid } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { AcceptInvite, FindJoinedChannel, init, ListIncomingInvites, sharedChanged, update } from "./update"
import { view } from "./view"

/** A channel another organization shared: once accepted, who it looks like (members only). */

const shared = makeShared()
const inviteId = Schema.decodeSync(ConnectInviteId)(uuid(70))
const conversationId = Schema.decodeSync(ConnectConversationId)(uuid(71))
const invite = {
	id: inviteId,
	hostOrganizationId: organizationId,
	status: "pending",
	createdAtMs: 0,
}
const listed = update(
	init(undefined, shared).model,
	Message.SucceededListInvites({ organizationId, version: 1, invites: [invite] }),
	shared,
).model
const kestrel = suggestionFor(channelId, CONTACT_SUGGESTION)
const accepted = Message.SucceededAccept({ inviteId, conversationId, transactionId: "org:1:2" })

describe("connect invitations: suggested customer", () => {
	test("accepting toasts at once, then finds the new channel and offers to link it", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(listed),
			Scene.click(Scene.role("button", { name: "Accept" })),
			Scene.Command.resolve(AcceptInvite, accepted),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Channel connected") }),
			),
			Scene.Command.resolve(
				ListIncomingInvites,
				Message.SucceededListInvites({ organizationId, version: 2, invites: [] }),
			),
			Scene.Command.expectExact(
				FindJoinedChannel({ conversationId, organizationId, transactionId: "org:1:2" }),
			),
			Scene.Command.resolve(FindJoinedChannel, Message.FoundJoinedChannel({ channelId })),
			Scene.Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.SucceededFetch({ channelId, items: [kestrel] }),
			),
			// The guest channel is "shared-channel" until the host's snapshot names it.
			Scene.expect(Scene.role("status")).toContainText("The shared channel looks like Kestrel Systems"),
			Scene.expect(Scene.text("1 of 5 external members is a Kestrel Systems contact")).toExist(),
			Scene.click(Scene.role("button", { name: "Dismiss" })),
			Scene.expect(Scene.role("status")).toBeAbsent(),
			Scene.Command.resolve(
				DismissSuggestion,
				SuggestionMessage.SucceededDismiss({ suggestion: kestrel }),
			),
			Scene.Command.resolve(
				SuggestionPrompt.FetchChannelSuggestion,
				SuggestionPrompt.Message.SucceededFetch({ channelId, items: [] }),
			),
			Scene.expect(Scene.role("status")).toBeAbsent(),
		)
	})

	test("nobody outside the org looks; a channel not synced in time asks nothing", () => {
		const names = (result: ReturnType<typeof update>) =>
			result.commands?.map((command) => command.name) ?? []
		expect(names(update(listed, accepted, makeShared({ member: null })))).not.toContain(
			"FindJoinedChannel",
		)
		expect(names(update(listed, accepted, shared))).toContain("FindJoinedChannel")
		expect(names(update(listed, Message.FoundJoinedChannel({ channelId: null }), shared))).toEqual([])
		expect(
			names(update(listed, Message.FoundJoinedChannel({ channelId }), makeShared({ member: null }))),
		).toEqual([])
	})
})

describe("connect invitations: switching organization", () => {
	test("the previous organization's prompt does not survive the switch", () => {
		const prompting = { ...listed, suggestion: { channelId, items: [kestrel], status: "Ready" as const } }
		const other = makeShared({
			organization: { ...shared.organization!, id: Schema.decodeSync(OrganizationId)(uuid(72)) },
		})
		expect(sharedChanged(prompting, other).model.suggestion).toEqual(SuggestionPrompt.init())
	})
})

describe("connect invitations: accepted before membership loads", () => {
	test("the joined channel is found and asked about once membership arrives", () => {
		const loading = makeShared({ member: null })
		const accepting = update(listed, Message.ClickedAccept({ inviteId }), loading).model
		const done = update(accepting, accepted, loading)
		expect((done.commands ?? []).map((command) => command.name)).not.toContain("FindJoinedChannel")
		expect(done.model.pendingJoin).toEqual({ conversationId, transactionId: "org:1:2" })
		const ready = sharedChanged(done.model, shared)
		expect(ready.commands?.map((command) => command.name)).toContain("FindJoinedChannel")
		expect(ready.model.pendingJoin).toBeNull()
	})
})
