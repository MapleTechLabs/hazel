import { Effect } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { broadcastActivity } from "./activity"

/** The cross-tab activity sender: no channel kept open between posts, and never a crash. */

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("broadcastActivity", () => {
	test("other tabs receive the post although the sender closes right after", async () => {
		const receiver = new BroadcastChannel("hazel:presence-activity")
		const received = new Promise<unknown>((resolve) =>
			receiver.addEventListener("message", (event) => resolve(event.data), { once: true }),
		)
		await Effect.runPromise(broadcastActivity(42))
		expect(await received).toMatchObject({ type: "activity", at: 42 })
		receiver.close()
	})

	test("a channel that cannot open is ignored, not a defect", async () => {
		vi.stubGlobal(
			"BroadcastChannel",
			class {
				constructor() {
					throw new Error("blocked")
				}
			},
		)
		await expect(Effect.runPromise(broadcastActivity(1))).resolves.toBeUndefined()
	})
})
