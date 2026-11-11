// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import {
	buildNotificationContent,
	formatNotificationTitle,
	sendNativeNotification,
} from "./native-notifications"

vi.mock("./tauri", () => ({
	isTauri: vi.fn(() => false),
}))

describe("native-notifications", () => {
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
	})
})
