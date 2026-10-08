// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { channelId, makeShared, organizationId, pageScene, userId, uuid } from "../../test/pages-fixtures"
import { PageOutMessage } from "../out-message"
import { AutoFocusSearch } from "./commands"
import { Message } from "./message"
import type { DirectoryMember, DmRow } from "./model"
import { init, update } from "./update"
import { view } from "./view"
import * as Menu from "../../ui/menu"
import { FocusTriggerOnPress } from "../../ui/menu-view"

/** The org home member directory through its view. */

const shared = makeShared()
const grace = Schema.decodeSync(UserId)(uuid(40))
const member = (id: UserId, firstName: string, lastName: string, role: DirectoryMember["role"]): DirectoryMember => ({
	id,
	firstName,
	lastName,
	email: `${firstName.toLowerCase()}@hazel.test`,
	avatarUrl: null,
	role,
	presenceStatus: null,
})
const members = [member(userId, "Ada", "Lovelace", "owner"), member(grace, "Grace", "Hopper", "admin")]
const dmWithGrace: ReadonlyArray<DmRow> = [userId, grace].map((memberId) => ({
	channel: { id: channelId, type: "single", organizationId },
	member: { userId: memberId },
}))
const search = Scene.placeholder("Search members...")
const focused = Scene.Mount.resolve(AutoFocusSearch, Message.CompletedFocusSearch())
const loadedMembers = [
	Scene.Subscription.emit(Message.UpdatedMembers({ members })),
	Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
]
// The Message button is icon-only with no accessible name, so it is reached by CSS.
const messageButton = Scene.selector("button:not([aria-label])")

describe("member directory", () => {
	test("shows a loader until the members arrive, then lists them", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			focused,
			Scene.expect(Scene.role("progressbar")).toExist(),
			...loadedMembers,
			Scene.expect(Scene.role("progressbar")).toBeAbsent(),
			Scene.expect(Scene.text("ada@hazel.test")).toExist(),
			Scene.expect(Scene.text("grace@hazel.test")).toExist(),
			// The signed-in user's own row has no actions.
			Scene.expectAll(Scene.all.label("Member actions")).toHaveCount(1),
		)
	})

	test("search filters by name or email and explains an empty result", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			focused,
			...loadedMembers,
			Scene.type(search, "HOPPER"),
			Scene.expect(Scene.text("ada@hazel.test")).toBeAbsent(),
			Scene.expect(Scene.text("grace@hazel.test")).toExist(),
			Scene.type(search, "nobody"),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.expect(Scene.text("No members found matching your search")).toExist(),
		)
	})

	test("an organization with no members says so", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			focused,
			Scene.Subscription.emit(Message.UpdatedMembers({ members: [] })),
			Scene.expect(Scene.text("No members in this organization")).toExist(),
		)
	})

	test("Message opens the existing DM with that member", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			focused,
			...loadedMembers,
			Scene.Subscription.emit(Message.UpdatedDmChannels({ rows: dmWithGrace })),
			Scene.click(messageButton),
			Scene.Command.expectNone(),
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: `/hazel/chat/${channelId}`, replace: false })),
		)
	})

	test("Message pressed before the DM rows load opens the DM once they arrive", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			focused,
			...loadedMembers,
			Scene.click(messageButton),
			Scene.expectNoOutMessage(),
			Scene.Subscription.emit(Message.UpdatedDmChannels({ rows: dmWithGrace })),
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: `/hazel/chat/${channelId}`, replace: false })),
		)
	})

	// A11y bug: the icon-only Message button has no accessible name (legacy had none either).
	test.fails("the Message button is named", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			focused,
			...loadedMembers,
			Scene.expect(Scene.role("button", { name: /Message/ })).toExist(),
		)
	})
})
