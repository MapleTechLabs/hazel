// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	clearAccessToken,
	getAccessToken,
	invalidateAccessToken,
	readAccessToken,
	SESSION_REJECTED_EVENT,
} from "./access-token"

afterEach(() => {
	clearAccessToken()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

const rejections = () => {
	const seen = vi.fn()
	window.addEventListener(SESSION_REJECTED_EVENT, seen)
	return { seen, stop: () => window.removeEventListener(SESSION_REJECTED_EVENT, seen) }
}
describe("session token exchange", () => {
	it("sends the browser CSRF header", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ token: "current", expiresIn: 300 }),
		)
		vi.stubGlobal("fetch", fetch)
		expect(await getAccessToken()).toBe("current")
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({
			credentials: "include",
			headers: { "x-effect-auth-csrf": "1" },
		})
	})
	it("does not restore a token or replace a new exchange after sign-out", async () => {
		let finish!: (response: Response) => void
		const fetch = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						finish = resolve
					}),
			)
			.mockResolvedValue(Response.json({ token: "new", expiresIn: 300 }))
		vi.stubGlobal("fetch", fetch)
		const old = getAccessToken()
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
		clearAccessToken()
		expect(await getAccessToken()).toBe("new")
		finish(Response.json({ token: "old", expiresIn: 300 }))
		expect(await old).toBeNull()
		expect(await getAccessToken()).toBe("new")
	})

	it("retries an API that did not answer, then hands out the token", async () => {
		vi.useFakeTimers()
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValue(Response.json({ token: "late", expiresIn: 300 }))
		vi.stubGlobal("fetch", fetch)
		const token = getAccessToken()
		await vi.runAllTimersAsync()
		expect(await token).toBe("late")
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it("gives up after three unanswered attempts without reporting the session as refused", async () => {
		vi.useFakeTimers()
		const { seen, stop } = rejections()
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 503 }))
		vi.stubGlobal("fetch", fetch)
		const token = readAccessToken()
		await vi.runAllTimersAsync()
		expect(await token).toBe("unavailable")
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(seen).not.toHaveBeenCalled()
		// Callers that only want a token see none.
		const plain = getAccessToken()
		await vi.runAllTimersAsync()
		expect(await plain).toBeNull()
		stop()
	})

	it("treats a body that is not a token as an unanswered exchange", async () => {
		vi.useFakeTimers()
		const { seen, stop } = rejections()
		const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ token: 42 }))
		vi.stubGlobal("fetch", fetch)
		const token = readAccessToken()
		await vi.runAllTimersAsync()
		expect(await token).toBe("unavailable")
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(seen).not.toHaveBeenCalled()
		stop()
	})

	it("reports a refused session once, without retrying", async () => {
		const { seen, stop } = rejections()
		const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 401 }))
		vi.stubGlobal("fetch", fetch)
		expect(await readAccessToken()).toBeNull()
		expect(fetch).toHaveBeenCalledOnce()
		expect(seen).toHaveBeenCalledOnce()
		stop()
	})

	it("a rejected token is exchanged again; a token already replaced is left alone", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ token: "first", expiresIn: 300 }))
			.mockResolvedValue(Response.json({ token: "second", expiresIn: 300 }))
		vi.stubGlobal("fetch", fetch)
		expect(await getAccessToken()).toBe("first")
		invalidateAccessToken("stale")
		expect(await getAccessToken()).toBe("first")
		invalidateAccessToken("first")
		expect(await getAccessToken()).toBe("second")
	})
})

describe("the exchange index.html starts early", () => {
	const early = (response: Response | null, startedAtMs = Date.now()) => {
		window.__hazelEarlyToken = { response: Promise.resolve(response), startedAtMs }
	}

	it("hands out its token without a second exchange", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>()
		vi.stubGlobal("fetch", fetch)
		early(Response.json({ token: "early", expiresIn: 300 }))
		expect(await getAccessToken()).toBe("early")
		expect(fetch).not.toHaveBeenCalled()
	})

	it("is used once: a later exchange asks the API", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ token: "fresh", expiresIn: 300 }),
		)
		vi.stubGlobal("fetch", fetch)
		early(Response.json({ token: "early", expiresIn: 300 }))
		expect(await getAccessToken()).toBe("early")
		invalidateAccessToken("early")
		expect(await getAccessToken()).toBe("fresh")
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("asks again after a refused, failed or stale early exchange, without reporting it", async () => {
		const { seen, stop } = rejections()
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ token: "fresh", expiresIn: 300 }),
		)
		vi.stubGlobal("fetch", fetch)
		for (const set of [
			() => early(new Response(null, { status: 401 })),
			() => early(null),
			() => early(Response.json({ token: "stale", expiresIn: 300 }), Date.now() - 60_000),
		]) {
			set()
			expect(await getAccessToken()).toBe("fresh")
			clearAccessToken()
		}
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(seen).not.toHaveBeenCalled()
		stop()
	})

	it("is dropped on sign-out", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ token: "fresh", expiresIn: 300 }),
		)
		vi.stubGlobal("fetch", fetch)
		early(Response.json({ token: "early", expiresIn: 300 }))
		clearAccessToken()
		expect(await getAccessToken()).toBe("fresh")
	})
})
