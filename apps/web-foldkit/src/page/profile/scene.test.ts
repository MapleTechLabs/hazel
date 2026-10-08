// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, pageScene, userId, uuid } from "../../test/pages-fixtures"
import { Message } from "./message"
import type { ProfileUser } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/profile/$userId` through its view, fed by the user live query. */

const NOW = 1_000_000
const shared = makeShared({ nowMs: NOW })
const graceId = Schema.decodeSync(UserId)(uuid(30))
const grace: ProfileUser = {
	firstName: "Grace",
	lastName: "Hopper",
	email: "grace@hazel.test",
	avatarUrl: null,
	presenceStatus: "dnd",
	presenceLastSeenMs: NOW - 10_000,
}

describe("profile page", () => {
	test("another member's profile shows their name, live status and read-only email", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(graceId).model),
			Scene.Subscription.emit(Message.UpdatedProfileUser({ user: grace })),
			Scene.expect(Scene.text("Grace Hopper")).toExist(),
			Scene.expect(Scene.text("View Grace's profile information.")).toExist(),
			Scene.expect(Scene.text("Do Not Disturb")).toExist(),
			Scene.expect(Scene.role("link", { name: /Edit Profile/ })).toBeAbsent(),
			// The email input has no label (the "Email address" heading is not associated), so it is found by value.
			Scene.expect(Scene.displayValue("grace@hazel.test")).toBeDisabled(),
		)
	})

	test("a stale presence reads as offline", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(graceId).model),
			Scene.Subscription.emit(Message.UpdatedProfileUser({ user: { ...grace, presenceLastSeenMs: NOW - 60_000 } })),
			Scene.expect(Scene.text("Offline")).toExist(),
			Scene.expect(Scene.text("Do Not Disturb")).toBeAbsent(),
		)
	})

	test("your own profile links to the profile settings", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(userId).model),
			Scene.Subscription.emit(Message.UpdatedProfileUser({ user: { ...grace, firstName: "Ada", lastName: "Lovelace" } })),
			Scene.expect(Scene.text("View your profile information.")).toExist(),
			Scene.expect(Scene.role("link", { name: /Edit Profile/ })).toHaveAttr("href", "/hazel/my-settings/profile"),
		)
	})

	test("a user who disappears from the query shows not found", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ userId: graceId, user: grace }),
			Scene.Subscription.emit(Message.UpdatedProfileUser({ user: null })),
			Scene.expect(Scene.text("User not found")).toExist(),
			Scene.expect(Scene.text("Grace Hopper")).toBeAbsent(),
		)
	})
})
