// @vitest-environment jsdom
import { ChannelId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { shared as memberShared } from "../chat/channel/fixtures.test-support"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import type { ChannelGroups, ChannelSummary, Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The channel browser through its view: loading, tabs with counts, cards and the empty states. */

const admin: Shared = {
	...memberShared,
	member: { id: Schema.decodeSync(OrganizationMemberId)("00000000-0000-4000-8000-000000000099"), role: "admin" },
}

const sceneFor = (shared: Shared) => ({
	update: (model: Model, message: Message) => update(model, message),
	view: Scene.withViewInputs(view, { shared })(),
})

/** A signed-in user without an organization role (`member: null`). */
const config = sceneFor(memberShared)

const channel = (n: number, name: string, type: string): ChannelSummary => ({
	id: Schema.decodeSync(ChannelId)(`00000000-0000-4000-8000-${String(200 + n).padStart(12, "0")}`),
	name,
	type,
	isMuted: false,
	isFavorite: false,
	notificationCount: 0,
	memberCount: 3,
	members: [],
})

const groups: ChannelGroups = {
	publicChannels: [channel(1, "general", "public"), channel(2, "random", "public")],
	privateChannels: [],
	dmChannels: [],
}

describe("chat index scene", () => {
	test("shows a loader until the channels arrive, then the public tab's channels", () => {
		Scene.scene(
			config,
			Scene.given(init().model),
			Scene.expect(Scene.role("heading", { name: "All channels" })).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups })),
			Scene.expect(Scene.role("heading", { name: "All channels" })).toExist(),
			Scene.expect(Scene.text("general")).toExist(),
			Scene.expect(Scene.text("random")).toExist(),
		)
	})

	test("an empty tab offers its action to admins, which asks the root for the legacy modal", () => {
		Scene.scene(
			sceneFor(admin),
			Scene.given(init().model),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups })),
			Scene.pointerDown(Scene.role("tab", { name: /Private/ })),
			Scene.expect(Scene.text("No private channels")).toExist(),
			Scene.click(Scene.role("button", { name: /Create a private channel$/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } })),
		)
	})

	test("without channel.create permission the empty state has no action", () => {
		Scene.scene(
			config,
			Scene.given(init().model),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups })),
			Scene.pointerDown(Scene.role("tab", { name: /Private/ })),
			Scene.expect(Scene.text("No private channels")).toExist(),
			Scene.expect(Scene.role("button", { name: /Create a private channel$/ })).toBeAbsent(),
		)
	})
})
