import { Cause, Effect, Exit, Schema } from "effect"
import { Atom } from "effect/reactivity"
import { describe, expect, test } from "vitest"
import { errorToast, failureToast, runAtomFn, settle, successToast } from "./actions"

/** The shared runner for legacy optimistic actions and its `exitToast`-style failure toasts. */

class ChannelNotFoundError extends Schema.TaggedError<ChannelNotFoundError>()("ChannelNotFoundError", {
	message: Schema.String,
}) {}

const rename = Atom.fn((name: string) =>
	name === "" ? Effect.fail(new ChannelNotFoundError({ message: "gone" })) : Effect.succeed(name.toUpperCase()),
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
	test("a tag handler wins over the friendly message", async () => {
		const toast = await Effect.runPromise(
			settle(
				runAtomFn(rename, ""),
				() => successToast("Renamed"),
				(cause) =>
					failureToast(cause, {
						ChannelNotFoundError: { title: "Channel not found", description: null },
					}),
			),
		)
		expect(toast).toEqual(errorToast("Channel not found"))
	})

	test("an unhandled failure falls back to an error toast", () => {
		const toast = failureToast(Cause.fail(new ChannelNotFoundError({ message: "gone" })))
		expect(toast.intent).toBe("error")
		expect(toast.title.length).toBeGreaterThan(0)
	})
})
