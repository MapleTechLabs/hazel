// @vitest-environment jsdom
import { User } from "@hazel/domain/models"
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
import * as Slider from "../../../ui/slider"
import { init, update } from "./update"
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
			given(init().model),
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
			given(init().model),
			message(Message.UpdatedUserRow({ row: Schema.decodeUnknownSync(UserRow)(row) })),
			message(Message.ToggledDoNotDisturb({ isSelected: true })),
			model((current) =>
				expect(settingsOf(current)).toEqual({
					quietHoursStart: "21:30",
					showQuietHoursInStatus: false,
					doNotDisturb: true,
				}),
			),
			Command.resolve(UpdateUserSettings, Message.FailedUpdateUserSettings({ reason: "UserNotFound" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to update setting",
						description: "Please sign in again.",
					},
				}),
			),
			model((current) => expect(settingsOf(current)?.doNotDisturb).toBeUndefined()),
		)
	})

	test("turning sounds off asks the root to store them", () => {
		story(
			pageUpdate,
			given(init().model),
			message(Message.ToggledSounds({ isSelected: false })),
			expectOutMessage(
				PageOutMessage.RequestedSoundSettings({
					settings: { ...shared.soundSettings, enabled: false },
				}),
			),
		)
	})

	test("the volume slider reports a step from Shared.soundSettings and the root stores it", () => {
		story(
			pageUpdate,
			given(init().model),
			message(
				Message.GotVolumeMessage({
					message: Slider.Message.PressedKeyboardNavigation({
						direction: "StepIncrement",
						value: shared.soundSettings.volume,
					}),
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedSoundSettings({
					settings: {
						...shared.soundSettings,
						volume: Slider.snapAndClamp(shared.soundSettings.volume + 0.1, 0, 1, 0.1),
					},
				}),
			),
		)
	})
})

describe("user settings writes", () => {
	test("a saved setting stays optimistic until the synced row replaces it", () => {
		story(
			pageUpdate,
			given(init().model),
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

	const synced = () =>
		pageUpdate(init().model, Message.UpdatedUserRow({ row: Schema.decodeUnknownSync(UserRow)(row) }))
			.model
	const settingsWith = (patch: object) =>
		Schema.decodeUnknownSync(User.UserSettingsSchema)({ ...row.settings, ...patch })
	const writeOf = (result: ReturnType<typeof pageUpdate>) =>
		result.commands?.map((command) => ({ name: command.name, args: command.args }))

	test("a change while a write runs is queued, then sent as one newer snapshot", () => {
		const both = settingsWith({ showQuietHoursInStatus: true, doNotDisturb: true })
		const first = pageUpdate(synced(), Message.ToggledDoNotDisturb({ isSelected: true }))
		expect(writeOf(first)).toEqual([
			{
				name: UpdateUserSettings.name,
				args: { userId: ada, settings: settingsWith({ doNotDisturb: true }) },
			},
		])
		const queued = pageUpdate(first.model, Message.ToggledShowQuietHours({ isSelected: true }))
		expect(queued.commands ?? []).toEqual([])
		expect(queued.model.settingsWrite).toBe("WritingWithQueued")
		// The first write's echo arrives while the second change is still unsent.
		const echoed = pageUpdate(
			queued.model,
			Message.UpdatedUserRow({
				row: Schema.decodeUnknownSync(UserRow)({
					...row,
					settings: settingsWith({ doNotDisturb: true }),
				}),
			}),
		)
		expect(settingsOf(echoed.model)).toEqual(both)
		const second = pageUpdate(echoed.model, Message.SucceededUpdateUserSettings())
		expect(writeOf(second)).toEqual([
			{ name: UpdateUserSettings.name, args: { userId: ada, settings: both } },
		])
		const done = pageUpdate(second.model, Message.SucceededUpdateUserSettings()).model
		expect(done.settingsWrite).toBe("Idle")
		expect(done.optimisticSettings).toBeNull()
		expect(done.settings).toEqual(both)
	})

	test("an older write failing still sends the newer queued snapshot", () => {
		const first = pageUpdate(synced(), Message.ToggledDoNotDisturb({ isSelected: true })).model
		const queued = pageUpdate(first, Message.ToggledDoNotDisturb({ isSelected: false })).model
		const failed = pageUpdate(queued, Message.FailedUpdateUserSettings({ reason: "Unexpected" }))
		expect(failed.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: {
					intent: "error",
					title: "Failed to update setting",
					description: "Please try again.",
				},
			}),
		)
		expect(writeOf(failed)).toEqual([
			{
				name: UpdateUserSettings.name,
				args: { userId: ada, settings: settingsWith({ doNotDisturb: false }) },
			},
		])
		expect(settingsOf(failed.model)?.doNotDisturb).toBe(false)
		expect(pageUpdate(failed.model, Message.SucceededUpdateUserSettings()).model.settingsWrite).toBe(
			"Idle",
		)
	})

	test("without a signed-in user nothing is written", () => {
		const signedOut = { ...shared, currentUser: null }
		story(
			(current: Parameters<typeof update>[0], next: Message) => update(current, next, signedOut),
			given(init().model),
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
			given(init().model),
			message(Message.ClickedTestNotification()),
			Command.expectExact(SendTestNotification()),
			Command.resolve(SendTestNotification, Message.SucceededSendTestNotification()),
			model((current) => expect(current.notificationStatus).toBe("sent")),
			Command.expectExact(ExpireNotificationStatus({ version: 1 })),
			Command.resolve(ExpireNotificationStatus, Message.ExpiredNotificationStatus({ version: 1 })),
			model((current) => expect(current.notificationStatus).toBe("idle")),
		)
	})

	test("an older expiry timer leaves a newer result showing", () => {
		const first = pageUpdate(init().model, Message.SucceededSendTestNotification()).model
		const second = pageUpdate(first, Message.FailedSendTestNotification({ reason: "SendFailed" })).model
		const expiredFirst = pageUpdate(second, Message.ExpiredNotificationStatus({ version: 1 })).model
		expect(expiredFirst.notificationStatus).toBe("unavailable")
		expect(
			pageUpdate(expiredFirst, Message.ExpiredNotificationStatus({ version: 2 })).model
				.notificationStatus,
		).toBe("idle")
	})
})
