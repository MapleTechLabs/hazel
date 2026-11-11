import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import { sharedDefaults } from "../../test-shared"
import { ClearChannelNotifications, syncReady, WaitClearNotificationsRetry } from "./clear-notifications"
import {
	ada,
	adaMemberId,
	channelId,
	grace,
	loadedModel,
	shared,
	updateWithShared,
} from "./fixtures.test-support"
import { type Model, Message, type PageReturn } from "./model"
import { switchChannel } from "./page"
import { retryDelayMs } from "./notification-clear"

/** The page's wiring of `notification-clear.ts`: its inputs from page messages, its effects as commands. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const clearCommands = (result: PageReturn) =>
	(result.commands ?? [])
		.filter(
			(command) =>
				command.name === ClearChannelNotifications.name ||
				command.name === WaitClearNotificationsRetry.name,
		)
		.map((command) => [command.name, command.args])

const CLEAR = [ClearChannelNotifications.name, { channelId }]
const otherChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000099")

const members = (notificationCount: number) => [
	{ id: adaMemberId, userId: ada, isHidden: false, createdAtMs: 0, notificationCount },
]

/** Entered with the org loaded, and the entry clear landed. */
const cleared = (): Model =>
	updateWithShared(
		syncReady(loadedModel(), shared).model,
		Message.SucceededClearNotifications({ channelId }),
	).model

describe("entering the channel", () => {
	test("clears once the signed-in org layout has loaded", () => {
		const result = syncReady(loadedModel(), shared)
		expect(clearCommands(result)).toEqual([CLEAR])
		expect(clearCommands(syncReady(result.model, shared))).toEqual([])
	})

	test("waits while auth, the user or the organization is still loading", () => {
		expect(clearCommands(syncReady(loadedModel(), { ...shared, auth: "Loading" }))).toEqual([])
		expect(clearCommands(syncReady(loadedModel(), { ...shared, currentUser: null }))).toEqual([])
		expect(
			clearCommands(syncReady(loadedModel(), { ...sharedDefaults, ...shared, organization: null })),
		).toEqual([])
	})

	test("switching channels starts a new visit, keeping the window's focus", () => {
		const blurred = updateWithShared(cleared(), Message.ChangedWindowFocus({ isFocused: false })).model
		const next = switchChannel(blurred, otherChannelId, {})
		expect(next.notifications.phase._tag).toBe("Owed")
		expect(next.notifications.isFocused).toBe(false)
	})
})

describe("the badge, from the member rows", () => {
	test("a count on the signed-in member is cleared while focused", () => {
		const result = updateWithShared(cleared(), Message.UpdatedMembers({ members: members(1) }))
		expect(clearCommands(result)).toEqual([CLEAR])
	})

	test("another member's count is not ours", () => {
		const others = [{ ...members(3)[0]!, userId: grace }]
		const result = updateWithShared(cleared(), Message.UpdatedMembers({ members: others }))
		expect(clearCommands(result)).toEqual([])
	})

	test("waits for focus, then clears", () => {
		const blurred = updateWithShared(cleared(), Message.ChangedWindowFocus({ isFocused: false })).model
		const counted = updateWithShared(blurred, Message.UpdatedMembers({ members: members(2) }))
		expect(clearCommands(counted)).toEqual([])
		expect(
			clearCommands(updateWithShared(counted.model, Message.ChangedWindowFocus({ isFocused: true }))),
		).toEqual([CLEAR])
	})

	test("the MarkRead hotkey goes through the machine", () => {
		const sending = updateWithShared(cleared(), Message.UpdatedMembers({ members: members(1) })).model
		expect(
			clearCommands(updateWithShared(sending, Message.PressedChannelHotkey({ action: "MarkRead" }))),
		).toEqual([])
		expect(
			clearCommands(updateWithShared(cleared(), Message.PressedChannelHotkey({ action: "MarkRead" }))),
		).toEqual([CLEAR])
	})
})

describe("results", () => {
	test("a failure waits out the backoff, then clears again", () => {
		const sent = syncReady(loadedModel(), shared).model
		const failed = updateWithShared(
			sent,
			Message.FailedClearNotifications({ channelId, reason: "Offline" }),
		)
		expect(clearCommands(failed)).toEqual([
			[WaitClearNotificationsRetry.name, { channelId, delayMs: retryDelayMs(1) }],
		])
		expect(
			clearCommands(
				updateWithShared(failed.model, Message.ElapsedClearNotificationsRetry({ channelId })),
			),
		).toEqual([CLEAR])
	})

	test("results for a channel the page has left are dropped", () => {
		const model = syncReady(loadedModel(), shared).model
		const stale = { ...model, channelId: otherChannelId }
		for (const message of [
			Message.SucceededClearNotifications({ channelId }),
			Message.FailedClearNotifications({ channelId, reason: "Offline" }),
			Message.ElapsedClearNotificationsRetry({ channelId }),
		]) {
			const result = updateWithShared(stale, message)
			expect(result.model.notifications).toEqual(stale.notifications)
			expect(clearCommands(result)).toEqual([])
		}
	})
})
