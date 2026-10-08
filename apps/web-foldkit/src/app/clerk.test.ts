// @vitest-environment jsdom
import { Effect, Exit } from "effect"
import { afterEach, describe, expect, test } from "vitest"
import { signOut } from "./clerk"

/** `signOut` reports a rejected Clerk call as a typed failure instead of a defect (a crash). */

const original = window.Clerk

afterEach(() => {
	window.Clerk = original
})

describe("signOut", () => {
	test("a rejected clerk.signOut fails with SignOutError", async () => {
		Object.assign(window, { Clerk: { signOut: () => Promise.reject(new Error("offline")) } })
		const exit = await Effect.runPromiseExit(signOut)
		expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
			_tag: "Some",
			value: { _tag: "SignOutError" },
		})
	})
})
