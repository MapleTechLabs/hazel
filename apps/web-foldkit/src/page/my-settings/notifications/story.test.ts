// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { UserRow } from "../user"
import { ExpireNotificationStatus, SendTestNotification, UpdateUserSettings } from "./command"
import { Message } from "./message"
import { settingsOf } from "./model"
import { init, sharedChanged, update } from "./update"
import { sharedDefaults } from "../../test-shared"

/** Update-loop tests for notification preferences: optimistic user settings and the sound settings. */

const ada = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001")
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
		organizationId: null,
	},
	organization: null,
	member: null,
	nowMs: 0,
	...sharedDefaults,
}
const pageUpdate = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const row = {
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	timezone: null,
	settings: { quietHoursStart: "21:30", showQuietHoursInStatus: false },
}

describe("notification preferences", () => {
	test("the synced quiet hours drive the time fields", () => {
		story(
			pageUpdate,
			given(init(undefined, shared).model),
			message(Message.UpdatedUserRow({ row: Schema.decodeUnknownSync(UserRow)(row) })),
			model((current) => {
				expect(current.quietHoursStart.committed).toBe("21:30:00")
				expect(current.quietHoursEnd.committed).toBe("08:00:00")
			}),
		)
	})

	test("do not disturb is written optimistically with the other settings kept", () => {
		story(
			pageUpdate,
			given(init(undefined, shared).model),
			message(Message.UpdatedUserRow({ row: Schema.decodeUnknownSync(UserRow)(row) })),
			message(Message.ToggledDoNotDisturb({ isSelected: true })),
			model((current) =>
				expect(settingsOf(current)).toEqual({
					quietHoursStart: "21:30",
					showQuietHoursInStatus: false,
					doNotDisturb: true,
				}),
			),
			Command.resolve(UpdateUserSettings, Message.FailedUpdateUserSettings()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Failed to update setting", description: null },
				}),
			),
			model((current) => expect(settingsOf(current)?.doNotDisturb).toBeUndefined()),
		)
	})

	test("turning sounds off asks the root to store them", () => {
		story(
			pageUpdate,
			given(init(undefined, shared).model),
			message(Message.ToggledSounds({ isSelected: false })),
			model((current) => expect(current.volume.isDisabled).toBe(true)),
			expectOutMessage(
				PageOutMessage.RequestedSoundSettings({
					settings: { ...shared.soundSettings, enabled: false },
				}),
			),
		)
	})

	test("the volume slider follows Shared.soundSettings", () => {
		const next = sharedChanged(init(undefined, shared).model, {
			...shared,
			soundSettings: { ...shared.soundSettings, volume: 0.8, enabled: false },
		}).model
		expect(next.volume.values).toEqual([0.8])
		expect(next.volume.isDisabled).toBe(true)
	})
})

describe("user settings writes", () => {
	test("a saved setting stays optimistic until the synced row replaces it", () => {
		story(
			pageUpdate,
			given(init(undefined, shared).model),
			message(Message.UpdatedUserRow({ row: Schema.decodeUnknownSync(UserRow)(row) })),
			message(Message.ToggledShowQuietHours({ isSelected: true })),
			Command.resolve(UpdateUserSettings, Message.SucceededUpdateUserSettings()),
			expectNoOutMessage(),
			model((current) => expect(settingsOf(current)?.showQuietHoursInStatus).toBe(true)),
			message(
				Message.UpdatedUserRow({
					row: Schema.decodeUnknownSync(UserRow)({
						...row,
						settings: { ...row.settings, showQuietHoursInStatus: true },
					}),
				}),
			),
			model((current) => {
				expect(current.optimisticSettings).toBeNull()
				expect(current.settings?.showQuietHoursInStatus).toBe(true)
			}),
		)
	})

	test("without a signed-in user nothing is written", () => {
		const signedOut = { ...shared, currentUser: null }
		story(
			(current: Parameters<typeof update>[0], next: Message) => update(current, next, signedOut),
			given(init(undefined, signedOut).model),
			message(Message.ToggledDoNotDisturb({ isSelected: true })),
			Command.expectNone(),
			model((current) => expect(current.optimisticSettings).toBeNull()),
		)
	})
})

describe("test notification", () => {
	test("a sent notification shows the confirmation, then expires back to idle", () => {
		story(
			pageUpdate,
			given(init(undefined, shared).model),
			message(Message.ClickedTestNotification()),
			Command.expectExact(SendTestNotification({})),
			Command.resolve(SendTestNotification, Message.CompletedTestNotification({ isSent: true })),
			model((current) => expect(current.notificationStatus).toBe("sent")),
			Command.expectExact(ExpireNotificationStatus({})),
			Command.resolve(ExpireNotificationStatus, Message.ExpiredNotificationStatus()),
			model((current) => expect(current.notificationStatus).toBe("idle")),
		)
	})
})
