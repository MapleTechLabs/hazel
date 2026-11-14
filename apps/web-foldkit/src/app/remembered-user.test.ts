// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Effect, Fiber, Schema } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CurrentUser } from "../session"
import { loadRememberedUser, makeRememberedSession, REMEMBERED_USER_KEY } from "./remembered-user"

const forget = vi.fn<() => Promise<boolean>>()
const reload = vi.fn()
const { forget: forgetRememberedSession, settle: settleRememberedUser } = makeRememberedSession({
	forget,
	reload,
})

const user = (n: number, firstName: string): CurrentUser => ({
	id: Schema.decodeSync(UserId)(`00000000-0000-4000-8000-00000000000${n}`),
	firstName,
	lastName: "Lovelace",
	email: `${firstName.toLowerCase()}@hazel.test`,
	avatarUrl: null,
	isOnboarded: true,
})
const ada = user(1, "Ada")
const grace = user(2, "Grace")

/** Runs `effect` until it settles or parks (a reload never returns). */
const run = async (effect: Effect.Effect<void>) => {
	const fiber = Effect.runFork(effect)
	await new Promise((resolve) => setTimeout(resolve, 0))
	return fiber
}
const remembered = () => Effect.runPromise(loadRememberedUser)

beforeEach(() => {
	localStorage.clear()
	forget.mockReset().mockResolvedValue(false)
	reload.mockClear()
})

describe("the remembered user", () => {
	it("is none until user.me has answered once, then that user", async () => {
		expect(await remembered()).toBeNull()
		await run(settleRememberedUser(ada))
		expect(await remembered()).toEqual(ada)
		// What `index.html` reads before the app's script has loaded.
		expect(JSON.parse(localStorage.getItem(REMEMBERED_USER_KEY)!).id).toBe(ada.id)
		expect(forget).not.toHaveBeenCalled()
		expect(reload).not.toHaveBeenCalled()
	})

	it("follows user.me when it names the same user again", async () => {
		await run(settleRememberedUser(ada))
		await run(settleRememberedUser({ ...ada, firstName: "Augusta" }))
		expect((await remembered())?.firstName).toBe("Augusta")
		expect(forget).not.toHaveBeenCalled()
	})

	it("gives way to the session's own user: their cache goes and the page starts over", async () => {
		await run(settleRememberedUser(ada))
		forget.mockResolvedValue(true)
		const fiber = await run(settleRememberedUser(grace))
		expect(await remembered()).toEqual(grace)
		expect(forget).toHaveBeenCalledTimes(1)
		expect(reload).toHaveBeenCalledTimes(1)
		// Nothing after the reload runs: no message for a page that is going away.
		expect(fiber.pollUnsafe()).toBeUndefined()
		await Effect.runPromise(Fiber.interrupt(fiber))
	})

	it("needs no new page for another user while no cache was open", async () => {
		await run(settleRememberedUser(ada))
		await run(settleRememberedUser(grace))
		expect(await remembered()).toEqual(grace)
		expect(reload).not.toHaveBeenCalled()
	})

	it("is forgotten with the cache when the session has ended, and an open cache starts over", async () => {
		await run(settleRememberedUser(ada))
		await run(forgetRememberedSession)
		expect(await remembered()).toBeNull()
		expect(forget).toHaveBeenCalledTimes(1)
		expect(reload).not.toHaveBeenCalled()

		forget.mockResolvedValue(true)
		const fiber = await run(forgetRememberedSession)
		expect(reload).toHaveBeenCalledTimes(1)
		await Effect.runPromise(Fiber.interrupt(fiber))
	})
})
