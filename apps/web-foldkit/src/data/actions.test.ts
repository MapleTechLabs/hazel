import { Cause, Effect, Exit, Schema } from "effect"
import { Atom } from "effect/reactivity"
import { UnauthorizedError } from "@hazel/domain/errors"
import { describe, expect, test } from "vitest"
import { errorToast, failureToast, runAtomFn, settle, successToast } from "./actions"

/** The shared runner for legacy optimistic actions and its `exitToast`-style failure toasts. */

class ChannelNotFoundError extends Schema.TaggedError<ChannelNotFoundError>()("ChannelNotFoundError", {
	message: Schema.String,
}) {}

const rename = Atom.fn((name: string) =>
	name === ""
		? Effect.fail(new ChannelNotFoundError({ message: "gone" }))
		: Effect.succeed(name.toUpperCase()),
)

describe("runAtomFn", () => {
	test("sets the action and returns its settled value", async () => {
		expect(await Effect.runPromise(runAtomFn(rename, "general"))).toBe("GENERAL")
	})

	test("keeps the action's typed failure", async () => {
		const exit = await Effect.runPromise(Effect.exit(runAtomFn(rename, "")))
		expect(Exit.isFailure(exit) && Cause.findErrorOption(exit.cause)).toMatchObject({
			value: { _tag: "ChannelNotFoundError" },
		})
	})
})

describe("failure toasts", () => {
	const unhandled = Cause.fail(new ChannelNotFoundError({ message: "gone" }))

	test("a tag handler wins over either fallback", async () => {
		const toast = await Effect.runPromise(
			settle(
				runAtomFn(rename, ""),
				() => successToast("Renamed"),
				(cause) =>
					failureToast(cause, "friendly", {
						ChannelNotFoundError: { title: "Channel not found", description: null },
					}),
			),
		)
		expect(toast).toEqual(errorToast("Channel not found"))
	})

	test("a handler function builds the message from the tagged error", () => {
		const handlers = {
			ChannelNotFoundError: (error: { readonly _tag: string }) => ({ title: error._tag }),
		}
		expect(failureToast(unhandled, "exitToast", handlers)).toEqual(errorToast("ChannelNotFoundError"))
	})

	test("the friendly fallback reads the error's message", () => {
		expect(failureToast(unhandled, "friendly")).toEqual(errorToast("gone"))
	})

	test("the exitToast fallback shows the generic message for an unknown tag", () => {
		expect(failureToast(unhandled, "exitToast")).toEqual(errorToast("An error occurred"))
	})

	test("both fallbacks use the common message for a common error", () => {
		const cause = Cause.fail(new UnauthorizedError({ message: "no", detail: "no" }))
		const common = errorToast(
			"You don't have permission to do this",
			"Contact your admin if you need access.",
		)
		expect(failureToast(cause, "friendly")).toEqual(common)
		expect(failureToast(cause, "exitToast")).toEqual(common)
	})

	test("a defect shows its message under either fallback", () => {
		const cause = Cause.die(new Error("boom"))
		expect(failureToast(cause, "friendly")).toEqual(errorToast("boom"))
		expect(failureToast(cause, "exitToast")).toEqual(errorToast("boom"))
	})

	test("success and error toasts default to no description", () => {
		expect(successToast("Saved")).toEqual({ intent: "success", title: "Saved", description: null })
		expect(successToast("Saved", "All good")).toEqual({
			intent: "success",
			title: "Saved",
			description: "All good",
		})
	})
})
