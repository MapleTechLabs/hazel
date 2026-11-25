// @vitest-environment jsdom
import { NotificationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { applyBadge, badgedTitle, badgeOf, NO_BADGE } from "./badge"

const id = (n: number) =>
	Schema.decodeSync(NotificationId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)

const inputs = {
	unreadMentionIds: [] as ReadonlyArray<NotificationId>,
	optimisticReadIds: [] as ReadonlyArray<NotificationId>,
	unreadChannels: [] as ReadonlyArray<{ mutedUntilMs: number | null }>,
	nowMs: 1_000,
}

describe("badgeOf", () => {
	test("nothing unread is no badge", () => {
		expect(badgeOf(inputs)).toEqual(NO_BADGE)
	})

	test("counts unread mentions, less the ones marked read here", () => {
		expect(
			badgeOf({ ...inputs, unreadMentionIds: [id(1), id(2), id(3)], optimisticReadIds: [id(2)] }),
		).toEqual({ mentionCount: 2, hasUnread: false })
	})

	test("an unread channel shows the dot", () => {
		expect(badgeOf({ ...inputs, unreadChannels: [{ mutedUntilMs: null }] }).hasUnread).toBe(true)
	})

	test("a channel muted until later does not; one whose mute ended does", () => {
		expect(badgeOf({ ...inputs, unreadChannels: [{ mutedUntilMs: 2_000 }] }).hasUnread).toBe(false)
		expect(badgeOf({ ...inputs, unreadChannels: [{ mutedUntilMs: 1_000 }] }).hasUnread).toBe(true)
	})

	test("mentions count whether or not their channel is muted", () => {
		expect(
			badgeOf({ ...inputs, unreadMentionIds: [id(1)], unreadChannels: [{ mutedUntilMs: 2_000 }] }),
		).toEqual({ mentionCount: 1, hasUnread: false })
	})
})

describe("badgedTitle", () => {
	test("the mention count leads the title", () => {
		expect(badgedTitle("Chat · Hazel", { mentionCount: 3, hasUnread: true })).toBe("(3) Chat · Hazel")
	})

	test("a dot without mentions but with unread channels", () => {
		expect(badgedTitle("Chat · Hazel", { mentionCount: 0, hasUnread: true })).toBe("• Chat · Hazel")
	})

	test("the plain title otherwise", () => {
		expect(badgedTitle("Chat · Hazel", NO_BADGE)).toBe("Chat · Hazel")
	})
})

describe("applyBadge", () => {
	afterEach(() => {
		Reflect.deleteProperty(window, "__TAURI__")
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
		document.head.innerHTML = ""
	})

	const stubTauri = () => {
		const setBadgeCount = vi.fn((_count?: number) => Promise.resolve())
		Object.assign(window, {
			__TAURI_INTERNALS__: {},
			__TAURI__: { window: { getCurrentWindow: () => ({ setBadgeCount }) } },
		})
		return setBadgeCount
	}

	test("in the desktop app, the dock shows the mention count and clears at 0", async () => {
		const setBadgeCount = stubTauri()
		await Effect.runPromise(applyBadge({ mentionCount: 3, hasUnread: true }))
		await Effect.runPromise(applyBadge({ mentionCount: 0, hasUnread: true }))
		expect(setBadgeCount.mock.calls).toEqual([[3], [undefined]])
	})

	test("a refused count (Windows) is ignored", async () => {
		const setBadgeCount = stubTauri()
		setBadgeCount.mockImplementation(() => Promise.reject(new Error("unsupported")))
		await expect(Effect.runPromise(applyBadge({ mentionCount: 1, hasUnread: false }))).resolves.toBe(
			undefined,
		)
	})

	test("in the browser, no mentions keeps the page's own favicon", async () => {
		document.head.innerHTML = '<link rel="icon" href="/icon.svg" />'
		await Effect.runPromise(applyBadge({ mentionCount: 0, hasUnread: true }))
		expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute("href")).toBe(
			"/icon.svg",
		)
	})
})
