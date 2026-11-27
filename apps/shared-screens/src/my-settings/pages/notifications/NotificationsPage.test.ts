// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import type { User } from "@hazel/domain/models"
import { ChannelId, ChannelMemberId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { SetSoundSettings, ShowToast, type SoundSettings } from "../../../app/requests"
import { ada, button, byProp, organizationId, session, subscriptionKey } from "../../../modals/test-support"
import { applied, DEFAULTS, muteSegmentsOf, type Override, summaryOf } from "./data"
import {
	ExpireNotificationStatus,
	NotificationsMessage as M,
	NotificationsPageNoDeps,
	ResetOverride,
	SaveOrganizationSettings,
	TestNotification,
	UpdateUserSettings,
} from "./NotificationsPage"

/** Sounds go to the app; the user's own settings and the organization's write one at a time. */

const sound: SoundSettings = { enabled: true, volume: 0.5, soundFile: "notification01", cooldownMs: 2000 }
const nowMs = Date.UTC(2026, 10, 26, 15, 0)
const start = () => Scene.start(NotificationsPageNoDeps, { session, soundSettings: sound, nowMs })
const toggle = (label: string) => byProp("toggle", "label", label)
const time = (value: string) => value as User.UserSettings["quietHoursStart"]

describe("notifications page", () => {
	test("sound settings go to the app whole", () => {
		start()
			.fire(toggle("Enable notification sounds"), "change", { checked: false })
			.expectExact(SetSoundSettings.make({ settings: { ...sound, enabled: false } }))
			.resolve(SetSoundSettings, Component.noop)
			.fire(byProp("slider", "label", "Volume"), "change", { value: 0.8 })
			.expectExact(SetSoundSettings.make({ settings: { ...sound, volume: 0.8 } }))
			.resolve(SetSoundSettings, Component.noop)
			.fire(byProp("choiceGroup", "label", "Notification sound"), "change", {
				selected: ["notification03"],
			})
			.expectExact(SetSoundSettings.make({ settings: { ...sound, soundFile: "notification03" } }))
			.resolve(SetSoundSettings, Component.noop)
	})

	test("a test notification says how it went, for three seconds", () => {
		start()
			.fire(button("Test notification"), "press")
			.expectExact(TestNotification.make({}))
			.resolve(TestNotification, M.FailedSendTestNotification())
			.expectExact(ExpireNotificationStatus.make({ version: 1 }))
			.expect(byProp("text", "tone", "muted"))
			.toExist()
			.resolve(ExpireNotificationStatus, M.ExpiredNotificationStatus({ version: 1 }))
	})

	test("settings write one at a time; a change meanwhile is queued as the latest snapshot", () => {
		const s = start()
			.subscription(
				subscriptionKey("userSettings", ada.id),
				M.UpdatedUserSettings({ settings: { quietHoursStart: time("22:00") } }),
			)
			.fire(toggle("Enable do not disturb"), "change", { checked: true })
			.expectExact(
				UpdateUserSettings.make({
					userId: ada.id,
					settings: { quietHoursStart: time("22:00"), doNotDisturb: true },
				}),
			)
			.keepPending(UpdateUserSettings)
			.fire(byProp("datePicker", "label", "End time"), "change", { value: "07:30" })
		expect(s.get(byProp("datePicker", "label", "End time")).props?.["value"]).toBe("07:30")
		s.resolve(UpdateUserSettings, M.SucceededUpdateUserSettings())
			.expectExact(
				UpdateUserSettings.make({
					userId: ada.id,
					settings: {
						quietHoursStart: time("22:00"),
						doNotDisturb: true,
						quietHoursEnd: time("07:30"),
					},
				}),
			)
			.resolve(UpdateUserSettings, M.FailedUpdateUserSettings({ reason: "Offline" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Failed to update setting",
						description: "Check your internet connection and try again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("this organization: a level or a mute writes the whole snapshot", () => {
		start()
			.fire(byProp("choiceGroup", "label", "Notify me about"), "change", { selected: ["mentions"] })
			.expectExact(
				SaveOrganizationSettings.make({
					organizationId,
					settings: { ...DEFAULTS, level: "mentions" },
				}),
			)
			.resolve(SaveOrganizationSettings, M.SucceededSaveOrganizationSettings())
	})

	test("an override in effect is listed and can be reset", () => {
		const override: Override = {
			_tag: "Channel",
			memberId: ChannelMemberId.make("00000004-0000-4000-8000-000000000001"),
			channelId: ChannelId.make("00000005-0000-4000-8000-000000000001"),
			name: "design",
			type: "public",
			level: "all",
			isMuted: true,
			mutedUntilMs: null,
		}
		start()
			.subscription(
				`channelOverrides:${JSON.stringify(organizationId)},${JSON.stringify(ada.id)}`,
				M.UpdatedChannelOverrides({ overrides: [override] }),
			)
			.fire(button("Reset"), "press")
			.expectExact(ResetOverride.make({ organizationId, override }))
			.resolve(ResetOverride, M.CompletedResetOverride({ isSuccess: true }))
		expect(summaryOf(override, nowMs)).toBe("All messages · Muted")
	})

	test("a timed mute shows until when, and picking it again keeps it", () => {
		const muted = applied(DEFAULTS, { mute: 60 }, nowMs)
		expect(muted.mutedUntilMs).toBe(nowMs + 60 * 60_000)
		const { segments, selected } = muteSegmentsOf(muted, nowMs)
		expect(selected).toBe("timed")
		expect(segments.at(-1)?.label.startsWith("Until ")).toBe(true)
	})
})
