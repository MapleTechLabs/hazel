import type { ErrorMessage } from "../../data/actions"

/** The chat provider's `onErrorTag` messages, for `failureToast` and `toastOfExit` in `data/actions`. */

const retryAfterMsOf = (error: { readonly _tag: string }): number =>
	"retryAfterMs" in error && typeof error.retryAfterMs === "number" ? error.retryAfterMs : 0

/** `RateLimitExceededError` as the chat provider words it (`tryAgain` for edit and delete). */
export const rateLimited =
	(action: "sending another message" | "trying again") =>
	(error: { readonly _tag: string }): ErrorMessage => ({
		title: "Rate limit exceeded",
		description: `Please wait ${Math.ceil(retryAfterMsOf(error) / 1000)} seconds before ${action}.`,
		isRetryable: false,
	})

export const notRetryable = (title: string, description: string): (() => ErrorMessage) => () => ({
	title,
	description,
	isRetryable: false,
})
