// @vitest-environment jsdom
import { User } from "@hazel/domain/models"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, pageScene, userId } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { ExpireNotificationStatus, SendTestNotification, UpdateUserSettings } from "./command"
import { UserRow } from "../user"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** The notifications page through its view: DND and status switches, sounds, and the test notification. */

const shared = makeShared()
const dnd = Scene.label("Enable do not disturb")
const row = Schema.decodeUnknownSync(UserRow)({
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	timezone: null,
	settings: { quietHoursStart: "21:30" },
})
const settings = Schema.decodeUnknownSync(User.UserSettingsSchema)
const showQuietHours = Scene.label("Show quiet hours in status")

describe("do not disturb", () => {
	test("the switch flips at once and saves it merged into the synced settings", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			Scene.Subscription.emit(Message.UpdatedUserRow({ row })),
			Scene.expect(dnd).not.toBeChecked(),
			Scene.click(dnd),
			Scene.Command.expectExact(
				UpdateUserSettings({
					userId,
					settings: settings({ quietHoursStart: "21:30", doNotDisturb: true }),
				}),
			),
			Scene.expect(dnd).toBeChecked(),
			Scene.Command.resolve(UpdateUserSettings, Message.SucceededUpdateUserSettings()),
			Scene.expectNoOutMessage(),
			Scene.expect(dnd).toBeChecked(),
		)
	})

	test("a failed save toasts and flips the switch back", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			Scene.expect(showQuietHours).toBeChecked(),
			Scene.click(showQuietHours),
			Scene.expect(showQuietHours).not.toBeChecked(),
			Scene.Command.resolve(UpdateUserSettings, Message.FailedUpdateUserSettings()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Failed to update setting", description: null },
				}),
			),
			Scene.expect(showQuietHours).toBeChecked(),
		)
	})
})

describe("sounds", () => {
	test("turning sounds off asks the root to store them", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			Scene.click(Scene.label("Enable notification sounds")),
			Scene.expectOutMessage(
				PageOutMessage.RequestedSoundSettings({
					settings: { ...shared.soundSettings, enabled: false },
				}),
			),
		)
	})

	test("with sounds off, Test sound is disabled but Test notification is not", () => {
		const muted = makeShared({ soundSettings: { ...shared.soundSettings, enabled: false } })
		Scene.scene(
			pageScene(update, view, muted),
			Scene.given(init(undefined, muted).model),
			Scene.expect(Scene.role("button", { name: "Test sound" })).toBeDisabled(),
			Scene.expect(Scene.role("button", { name: "Test notification" })).toBeEnabled(),
		)
	})

	test("an unavailable test notification explains why, then the note expires", () => {
		const note = Scene.text("Native notifications unavailable (desktop app only)")
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			Scene.click(Scene.role("button", { name: "Test notification" })),
			Scene.Command.expectExact(SendTestNotification),
			Scene.Command.resolve(SendTestNotification, Message.CompletedTestNotification({ isSent: false })),
			Scene.expect(note).toExist(),
			Scene.Command.resolve(ExpireNotificationStatus, Message.ExpiredNotificationStatus({ version: 1 })),
			Scene.expect(note).toBeAbsent(),
		)
	})
})
