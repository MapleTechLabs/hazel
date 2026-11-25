// @vitest-environment jsdom
import { NotificationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { applyBadge, badgedTitle, badgeOf, isMentionReason, NO_BADGE } from "./badge"

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

	/** jsdom draws nothing: an image that loads (or fails) at once, and a canvas that records. */
	const stubCanvas = (loads: boolean) => {
		const drawImage = vi.fn()
		const arc = vi.fn()
		class FakeImage {
			naturalWidth = 32
			naturalHeight = 32
			onload: (() => void) | null = null
			onerror: ((cause: unknown) => void) | null = null
			set src(_value: string) {
				queueMicrotask(() => (loads ? this.onload?.() : this.onerror?.("broken")))
			}
		}
		vi.stubGlobal("Image", FakeImage)
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage,
			beginPath: vi.fn(),
			arc,
			fill: vi.fn(),
			fillStyle: "",
		} as unknown as CanvasRenderingContext2D)
		vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,dotted")
		return { drawImage, arc }
	}
	const iconHref = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute("href")

	test("in the browser, mentions draw the red dot once, and the page's favicon comes back at 0", async () => {
		const { drawImage, arc } = stubCanvas(true)
		document.head.innerHTML = '<link rel="icon" href="/dot-test.svg" />'
		await Effect.runPromise(applyBadge({ mentionCount: 2, hasUnread: true }))
		expect(iconHref()).toBe("data:image/png;base64,dotted")
		expect(arc).toHaveBeenCalledTimes(1)
		await Effect.runPromise(applyBadge({ mentionCount: 0, hasUnread: true }))
		expect(iconHref()).toContain("/dot-test.svg")
		// The dotted image is cached per original icon: a later mention draws nothing new.
		await Effect.runPromise(applyBadge({ mentionCount: 1, hasUnread: false }))
		expect(iconHref()).toBe("data:image/png;base64,dotted")
		expect(drawImage).toHaveBeenCalledTimes(1)
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test("a favicon that fails to load is left as it is", async () => {
		stubCanvas(false)
		document.head.innerHTML = '<link rel="icon" href="/broken-test.svg" />'
		await expect(Effect.runPromise(applyBadge({ mentionCount: 1, hasUnread: false }))).resolves.toBe(
			undefined,
		)
		expect(iconHref()).toContain("/broken-test.svg")
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test("in the browser, no mentions keeps the page's own favicon", async () => {
		document.head.innerHTML = '<link rel="icon" href="/icon.svg" />'
		await Effect.runPromise(applyBadge({ mentionCount: 0, hasUnread: true }))
		expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute("href")).toBe(
			"/icon.svg",
		)
	})
})

describe("what counts as a mention", () => {
	test("personal mentions, replies, @channel, DMs and older rows; not a plain message", () => {
		expect(
			["mention", "reply", "everyone", "direct", null].every((reason) => isMentionReason(reason)),
		).toBe(true)
		expect(isMentionReason("message")).toBe(false)
	})
})
