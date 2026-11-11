import { InternalServerError, UnauthorizedError } from "@hazel/domain/errors"
import { Cause, Effect, Exit, Fiber, Schema } from "effect"
import { HttpClientError, HttpClientRequest } from "effect/http"
import { RpcClientError } from "effect/rpc"
import { describe, expect, test } from "vitest"
import { commonMessage, isRetryableError } from "~/lib/error-messages"
import { catchCommon, errorToast, failureToast, settle, successToast } from "./actions"

/** The Command side of the error convention, and the legacy `exitToast`-style failure toasts. */

class ChannelNotFoundError extends Schema.TaggedError<ChannelNotFoundError>()("ChannelNotFoundError", {
	message: Schema.String,
}) {}

const request = HttpClientRequest.get("https://api.hazel.test/rpc")
const offline = new HttpClientError.HttpClientError({
	reason: new HttpClientError.TransportError({ request, description: "Failed to fetch" }),
})
const rpcOffline = new RpcClientError.RpcClientError({
	reason: new HttpClientError.HttpClientErrorSchema({ _tag: "HttpError", kind: "TransportError" }),
})
const unauthorized = new UnauthorizedError({ message: "no", detail: "no" })
const serverError = new InternalServerError({ message: "pg: relation users does not exist" })

const Failed = (reason: string) => ({ _tag: "Failed" as const, reason })

describe("catchCommon", () => {
	test("a common error becomes its reason", async () => {
		expect(await Effect.runPromise(Effect.fail(offline).pipe(catchCommon(Failed)))).toEqual(
			Failed("Offline"),
		)
		expect(await Effect.runPromise(Effect.fail(rpcOffline).pipe(catchCommon(Failed)))).toEqual(
			Failed("Offline"),
		)
		expect(await Effect.runPromise(Effect.fail(unauthorized).pipe(catchCommon(Failed)))).toEqual(
			Failed("SignedOut"),
		)
		expect(await Effect.runPromise(Effect.fail(serverError).pipe(catchCommon(Failed)))).toEqual(
			Failed("Unexpected"),
		)
	})

	test("feature errors are caught first with catchTags", async () => {
		const result = await Effect.runPromise(
			Effect.fail(new ChannelNotFoundError({ message: "gone" })).pipe(
				Effect.catchTags({ ChannelNotFoundError: () => Effect.succeed(Failed("NotFound")) }),
				catchCommon(Failed),
			),
		)
		expect(result).toEqual(Failed("NotFound"))
	})

	test("a defect becomes Unexpected instead of crashing the app", async () => {
		expect(await Effect.runPromise(Effect.die(new Error("boom")).pipe(catchCommon(Failed)))).toEqual(
			Failed("Unexpected"),
		)
	})

	test("an interrupt stays an interrupt", async () => {
		const exit = await Effect.runPromise(
			Effect.never.pipe(
				catchCommon(Failed),
				Effect.forkChild,
				Effect.flatMap((fiber) => Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)))),
			),
		)
		expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
	})
})

describe("retry policy", () => {
	test("network drops are retryable, server and auth failures are not", () => {
		expect(isRetryableError(offline)).toBe(true)
		expect(isRetryableError(rpcOffline)).toBe(true)
		expect(isRetryableError(unauthorized)).toBe(false)
		expect(isRetryableError(serverError)).toBe(false)
		expect(isRetryableError(new Error("boom"))).toBe(false)
	})
})

describe("failure toasts", () => {
	const unhandled = Cause.fail(new ChannelNotFoundError({ message: "gone" }))

	test("a tag handler wins", async () => {
		const toast = await Effect.runPromise(
			settle(
				Effect.fail(new ChannelNotFoundError({ message: "gone" })),
				() => successToast("Renamed"),
				(cause) =>
					failureToast(cause, "friendly", {
						ChannelNotFoundError: { title: "Channel not found", description: null },
					}),
			),
		)
		expect(toast).toEqual(errorToast("Channel not found"))
	})

	test("a handler function builds the message from the typed error", () => {
		expect(
			failureToast(unhandled, "exitToast", {
				ChannelNotFoundError: (error) => ({ title: error._tag }),
			}),
		).toEqual(errorToast("ChannelNotFoundError"))
	})

	test("an unknown error never shows its own message", () => {
		const generic = errorToast(commonMessage("Unexpected").title, commonMessage("Unexpected").description)
		expect(failureToast(unhandled, "friendly")).toEqual(generic)
		expect(failureToast(Cause.fail(serverError), "exitToast")).toEqual(generic)
	})

	test("a common error gets the shared copy", () => {
		const copy = commonMessage("SignedOut")
		expect(failureToast(Cause.fail(unauthorized), "friendly")).toEqual(
			errorToast(copy.title, copy.description),
		)
		const offlineCopy = commonMessage("Offline")
		expect(failureToast(Cause.fail(offline), "exitToast")).toEqual(
			errorToast(offlineCopy.title, offlineCopy.description),
		)
	})

	test("a defect never shows its message", () => {
		const toast = failureToast(Cause.die(new Error("boom")), "friendly")
		expect(toast.title).not.toContain("boom")
		expect(toast).toEqual(
			errorToast(commonMessage("Unexpected").title, commonMessage("Unexpected").description),
		)
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
