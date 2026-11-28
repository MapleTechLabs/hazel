import { assert, describe, it } from "@effect/vitest"
import { MAX_PREFETCHED, prefetchKey } from "./prefetch"

describe("prefetchKey", () => {
	it("puts notified channels first, drops repeats, and caps the set", () => {
		assert.strictEqual(prefetchKey(["c", "a"], ["b", "a"]), "a,c,b")
		const many = Array.from({ length: 20 }, (_, i) => `ch${String(i).padStart(2, "0")}`)
		assert.strictEqual(prefetchKey([], many).split(",").length, MAX_PREFETCHED)
		assert.strictEqual(prefetchKey([], []), "")
	})

	it("is the same key whatever order the rows arrive in", () => {
		assert.strictEqual(prefetchKey(["b", "a"], ["d", "c"]), prefetchKey(["a", "b"], ["c", "d"]))
	})
})
