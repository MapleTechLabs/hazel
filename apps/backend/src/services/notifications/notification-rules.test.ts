import { ChannelId, UserId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { decide, isInQuietHours, type MessageActivity, type Recipient } from "./notification-rules"

const channelId = ChannelId.make("00000000-0000-4000-8000-000000000001")
const author = UserId.make("00000000-0000-4000-8000-0000000000a1")
const bob = UserId.make("00000000-0000-4000-8000-0000000000b1")
const other = UserId.make("00000000-0000-4000-8000-0000000000c1")

// 2026-01-15 12:00 UTC.
const NOON_UTC = Date.UTC(2026, 0, 15, 12, 0)

const activity = (overrides: Partial<MessageActivity> = {}): MessageActivity => ({
	channelId,
	channelType: "public",
	parentChannelId: null,
	authorId: author,
	mentionedUserIds: [],
	notifyAll: false,
	replyToAuthorId: null,
	...overrides,
})

const bobAs = (overrides: Partial<Recipient> = {}): Recipient => ({
	userId: bob,
	level: null,
	isMuted: false,
	mutedUntil: null,
	parent: null,
	presence: null,
	settings: null,
	timezone: null,
	...overrides,
})

describe("decide", () => {
	it("never notifies the author", () => {
		expect(decide(activity({ mentionedUserIds: [author] }), bobAs({ userId: author }), NOON_UTC)).toEqual(
			{
				_tag: "Skip",
				why: "author",
			},
		)
	})

	it("channels default to mentions, DMs, group DMs and threads to every message", () => {
		expect(decide(activity(), bobAs(), NOON_UTC)).toEqual({ _tag: "Skip", why: "level" })
		expect(decide(activity({ mentionedUserIds: [bob] }), bobAs(), NOON_UTC)).toEqual({
			_tag: "Notify",
			reason: "mention",
			silent: false,
		})
		expect(decide(activity({ channelType: "direct" }), bobAs(), NOON_UTC)).toMatchObject({
			_tag: "Notify",
			reason: "direct",
		})
		expect(decide(activity({ channelType: "single" }), bobAs(), NOON_UTC)).toMatchObject({
			reason: "direct",
		})
		expect(decide(activity({ channelType: "thread" }), bobAs(), NOON_UTC)).toMatchObject({
			reason: "message",
		})
	})

	it("follows the member's level over the default", () => {
		expect(decide(activity(), bobAs({ level: "all" }), NOON_UTC)).toMatchObject({ reason: "message" })
		expect(decide(activity({ mentionedUserIds: [bob] }), bobAs({ level: "nothing" }), NOON_UTC)).toEqual({
			_tag: "Skip",
			why: "level",
		})
		expect(
			decide(activity({ channelType: "direct" }), bobAs({ level: "mentions" }), NOON_UTC),
		).toMatchObject({ reason: "direct" })
	})

	it("@channel and replies notify on the mentions level", () => {
		expect(decide(activity({ notifyAll: true }), bobAs(), NOON_UTC)).toMatchObject({ reason: "everyone" })
		expect(decide(activity({ replyToAuthorId: bob }), bobAs(), NOON_UTC)).toMatchObject({
			reason: "reply",
		})
	})

	it("a mute lets only personal mentions and replies through, until it expires", () => {
		const muted = bobAs({ isMuted: true })
		expect(decide(activity({ notifyAll: true }), muted, NOON_UTC)).toEqual({ _tag: "Skip", why: "muted" })
		expect(decide(activity({ channelType: "direct" }), muted, NOON_UTC)).toEqual({
			_tag: "Skip",
			why: "muted",
		})
		expect(decide(activity({ mentionedUserIds: [bob] }), muted, NOON_UTC)).toMatchObject({
			reason: "mention",
		})

		const later = bobAs({ mutedUntil: new Date(NOON_UTC + 60_000) })
		expect(decide(activity({ notifyAll: true }), later, NOON_UTC)).toEqual({ _tag: "Skip", why: "muted" })
		const expired = bobAs({ mutedUntil: new Date(NOON_UTC - 60_000) })
		expect(decide(activity({ notifyAll: true }), expired, NOON_UTC)).toMatchObject({ _tag: "Notify" })
	})

	it("skips who is online in the channel, not who is away or in another one", () => {
		const presence = {
			status: "online",
			activeChannelId: channelId,
			suppressNotifications: false,
		} as const
		const dm = activity({ channelType: "direct" })
		expect(decide(dm, bobAs({ presence }), NOON_UTC)).toEqual({ _tag: "Skip", why: "viewing" })
		expect(decide(dm, bobAs({ presence: { ...presence, status: "away" } }), NOON_UTC)).toMatchObject({
			_tag: "Notify",
		})
		expect(
			decide(
				dm,
				bobAs({ presence: { ...presence, activeChannelId: ChannelId.make(other) } }),
				NOON_UTC,
			),
		).toMatchObject({ _tag: "Notify" })
	})

	it("do not disturb, paused notifications and quiet hours notify silently", () => {
		const dm = activity({ channelType: "direct" })
		const silent = { _tag: "Notify", reason: "direct", silent: true }
		expect(
			decide(
				dm,
				bobAs({ presence: { status: "dnd", activeChannelId: null, suppressNotifications: false } }),
				NOON_UTC,
			),
		).toEqual(silent)
		expect(
			decide(
				dm,
				bobAs({ presence: { status: "online", activeChannelId: null, suppressNotifications: true } }),
				NOON_UTC,
			),
		).toEqual(silent)
		expect(decide(dm, bobAs({ settings: { doNotDisturb: true } }), NOON_UTC)).toEqual(silent)
		expect(
			decide(
				dm,
				bobAs({ settings: { quietHoursStart: "11:00", quietHoursEnd: "13:00" }, timezone: "UTC" }),
				NOON_UTC,
			),
		).toEqual(silent)
	})

	it("a thread inherits its parent channel's mute and `nothing`", () => {
		const thread = activity({ channelType: "thread", parentChannelId: ChannelId.make(other) })
		const parent = { level: null, isMuted: false, mutedUntil: null }
		expect(decide(thread, bobAs({ parent }), NOON_UTC)).toMatchObject({ _tag: "Notify" })
		expect(decide(thread, bobAs({ parent: { ...parent, isMuted: true } }), NOON_UTC)).toEqual({
			_tag: "Skip",
			why: "muted",
		})
		expect(decide(thread, bobAs({ parent: { ...parent, level: "nothing" } }), NOON_UTC)).toEqual({
			_tag: "Skip",
			why: "muted",
		})
		expect(
			decide(
				{ ...thread, mentionedUserIds: [bob] },
				bobAs({ parent: { ...parent, isMuted: true } }),
				NOON_UTC,
			),
		).toMatchObject({ reason: "mention" })
		// Only a thread looks at the parent.
		expect(
			decide(
				activity({ channelType: "direct" }),
				bobAs({ parent: { ...parent, isMuted: true } }),
				NOON_UTC,
			),
		).toMatchObject({ _tag: "Notify" })
	})
})

describe("isInQuietHours", () => {
	const overnight = { quietHoursStart: "22:00", quietHoursEnd: "08:00" }

	it("reads the window in the user's timezone, across midnight", () => {
		expect(isInQuietHours(overnight, "UTC", NOON_UTC)).toBe(false)
		// 12:00 UTC is 23:00 in Sydney (AEDT, +11).
		expect(isInQuietHours(overnight, "Australia/Sydney", NOON_UTC)).toBe(true)
		// 12:00 UTC is 04:00 in Los Angeles (PST, -8).
		expect(isInQuietHours(overnight, "America/Los_Angeles", NOON_UTC)).toBe(true)
	})

	it("is never on without both ends, or without a valid timezone (the client's call then)", () => {
		const noon = { quietHoursStart: "11:00", quietHoursEnd: "13:00" }
		expect(isInQuietHours({ quietHoursStart: "22:00" }, "UTC", NOON_UTC)).toBe(false)
		expect(isInQuietHours(null, "UTC", NOON_UTC)).toBe(false)
		expect(isInQuietHours(noon, "UTC", NOON_UTC)).toBe(true)
		expect(isInQuietHours(noon, null, NOON_UTC)).toBe(false)
		expect(isInQuietHours(noon, "Not/AZone", NOON_UTC)).toBe(false)
	})
})
