// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import {
	buildNotificationContent,
	formatNotificationTitle,
	MARK_READ_ACTION,
	notificationActionOf,
	registerActions,
	sendNativeNotification,
} from "./native-notifications"

describe("native-notifications", () => {
	it("listens for clicks even when the platform refuses the action type", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		const onAction = vi.fn(async () => ({}))
		const registerActionTypes = vi.fn(async () => {
			throw new Error("unsupported")
		})
		expect(await registerActions({ onAction, registerActionTypes } as any)).toBe(true)
		expect(onAction).toHaveBeenCalledOnce()
		expect(registerActionTypes).toHaveBeenCalledOnce()
	})

	it("reports a listener that failed to attach", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		const onAction = vi.fn(async () => {
			throw new Error("no plugin")
		})
		expect(await registerActions({ onAction, registerActionTypes: vi.fn() } as any)).toBe(false)
	})

	it("suppresses when window is focused", async () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true)
		const result = await sendNativeNotification({ title: "T", body: "B" })
		expect(result.status).toBe("suppressed")
		expect(result.reason).toBe("focused_window")
	})

	it("suppresses when api is unavailable", async () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(false)
		const result = await sendNativeNotification({ title: "T", body: "B" })
		expect(result.status).toBe("suppressed")
		expect(result.reason).toBe("api_unavailable")
	})

	it("formats titles by channel type", () => {
		expect(formatNotificationTitle({ firstName: "A", lastName: "B" } as any, undefined)).toBe("A B")
		expect(
			formatNotificationTitle(
				{ firstName: "A", lastName: "B" } as any,
				{
					type: "direct",
					name: "random",
				} as any,
			),
		).toBe("A B")
		expect(
			formatNotificationTitle(
				{ firstName: "A", lastName: "B" } as any,
				{
					type: "public",
					name: "general",
				} as any,
			),
		).toBe("A B in #general")
	})

	it("builds content from message + author + channel", () => {
		const content = buildNotificationContent(
			{ content: "**hello** there" } as any,
			{ firstName: "A", lastName: "B" } as any,
			{ id: "ch1", type: "public", name: "general" } as any,
		)
		expect(content.title).toBe("A B in #general")
		expect(content.body).toBe("hello there")
		expect(content.group).toBe("ch1")
		expect(content.image).toBeUndefined()
		expect(content.conversation).toBe("general")
	})

	it("carries the author's profile picture", () => {
		const content = buildNotificationContent(
			{ content: "hi" } as any,
			{ id: "u1", firstName: "A", lastName: "B", avatarUrl: "https://cdn.example.com/a.png" } as any,
			{ id: "ch1", type: "direct", name: "" } as any,
		)
		expect(content.image).toBe("https://cdn.example.com/a.png")
		expect(content.sender).toEqual({ id: "u1", name: "A B" })
		expect(content.conversation).toBeUndefined()
	})
})

describe("notification actions", () => {
	const channelId = "00000000-0000-4000-8000-000000000002"
	const target = { channelId, path: `/acme/chat/${channelId}?messageId=m1` }
	const performed = (actionId: string, hazel: unknown = target) => ({
		actionId,
		inputValue: null,
		notification: { id: 7, title: "A B in #general", extra: { hazel } },
	})

	it("a message's notification is clickable and offers Mark as read", () => {
		const content = buildNotificationContent(
			{ id: "m1", content: "hi" } as any,
			{ firstName: "A", lastName: "B" } as any,
			{ id: channelId, type: "public", name: "general" } as any,
			"acme",
		)
		expect(content.target).toEqual({ channelId, path: `/acme/chat/${channelId}?messageId=m1` })
	})

	it("without the org's slug, it still marks read but opens nothing", () => {
		const content = buildNotificationContent({ id: "m1", content: "hi" } as any, undefined, {
			id: channelId,
			type: "public",
			name: "general",
		} as any)
		expect(content.target).toEqual({ channelId, path: undefined })
	})

	it("a click opens the message; Mark as read reads its channel", () => {
		expect(notificationActionOf(performed("tap"))).toEqual({ _tag: "Open", path: target.path })
		expect(notificationActionOf(performed(MARK_READ_ACTION))).toEqual({ _tag: "MarkRead", channelId })
	})

	it("ignores another notification, an unknown action, or a malformed event", () => {
		expect(
			notificationActionOf({ actionId: "tap", inputValue: null, notification: { id: 8, extra: {} } }),
		).toBeNull()
		expect(notificationActionOf(performed("snooze"))).toBeNull()
		expect(notificationActionOf(performed("tap", { channelId: "not an id" }))).toBeNull()
		expect(notificationActionOf({ actionId: "tap", notification: null })).toBeNull()
		expect(notificationActionOf("tap")).toBeNull()
	})
})
