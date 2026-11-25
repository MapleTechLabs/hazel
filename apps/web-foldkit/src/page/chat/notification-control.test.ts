import { ChannelMemberId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { levelEntry, muteEntry, NotificationChoice } from "../../chat/notification-menu"
import { levelLabelOf, muteStatusOf } from "~/lib/notification-settings"
import * as Menu from "../../ui/menu"
import * as NotificationControl from "./notification-control"

/** The channel header's bell: its items choose a mute or a level for the signed-in member. */

const memberId = ChannelMemberId.make("00000000-0000-4000-8000-000000000005")
const member: NotificationControl.Member = {
	id: memberId,
	isMuted: false,
	mutedUntilMs: null,
	notificationLevel: null,
}
const opened = NotificationControl.update(
	NotificationControl.init("c"),
	NotificationControl.Message.GotMenuMessage({
		message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
	}),
	member,
).model
const chose = (key: string, who: NotificationControl.Member | null = member) =>
	NotificationControl.update(
		opened,
		NotificationControl.Message.GotMenuMessage({
			message: Menu.Message.ChoseFromNativeMenu({
				key,
				entries: [muteEntry({ isMuted: false, notificationLevel: null }), levelEntry("public")],
			}),
		}),
		who,
	)

describe("the header bell", () => {
	test("a duration mutes for that long, a level sets it", () => {
		expect(chose("mute:480").commands?.at(-1)?.args).toEqual({
			memberId,
			choice: NotificationChoice.Mute({ minutes: 480 }),
		})
		expect(chose("level:nothing").commands?.at(-1)?.args).toEqual({
			memberId,
			choice: NotificationChoice.SetLevel({ level: "nothing" }),
		})
	})

	test("a thread's Unfollow leaves it", () => {
		const unfollow = NotificationControl.update(
			opened,
			NotificationControl.Message.GotMenuMessage({
				message: Menu.Message.ChoseFromNativeMenu({
					key: "unfollow",
					entries: [Menu.item("unfollow", { textValue: "Unfollow thread" })],
				}),
			}),
			member,
		)
		expect(unfollow.commands?.at(-1)).toMatchObject({ name: "UnfollowThread", args: { memberId } })
	})

	test("without the member row nothing is written", () => {
		expect(chose("mute:60", null).commands ?? []).toEqual([])
	})

	test("the result is a toast", () => {
		const done = NotificationControl.update(
			opened,
			NotificationControl.Message.SucceededChoice({ choice: NotificationChoice.Unmute() }),
			member,
		)
		expect(done.toast?.title).toBe("Channel unmuted")
	})
})

describe("labels", () => {
	test("the default level names what it is for the channel type", () => {
		expect(levelLabelOf(null, "public")).toBe("Default (Only @mentions)")
		expect(levelLabelOf(null, "thread")).toBe("Default (All messages)")
	})

	test("a timed mute says until when; an expired one says nothing", () => {
		const now = Date.UTC(2026, 10, 25, 12)
		expect(muteStatusOf({ isMuted: true, mutedUntilMs: null }, now)).toBe("Muted")
		expect(muteStatusOf({ isMuted: false, mutedUntilMs: now - 1 }, now)).toBeNull()
		expect(muteStatusOf({ isMuted: false, mutedUntilMs: now + 60_000 }, now)).toMatch(/^Muted until /)
	})
})
