/**
 * Authenticated fetch for Electric SQL. Attaches the Clerk bearer token and
 * retries 5xx with jittered backoff so we don't hammer the proxy on outages.
 * Auth state is handled by the React tree — this just fetches.
 */
import { Effect, Schedule } from "effect"
import { getClerkToken } from "./clerk-token"
import { runtime } from "./services/common/runtime"

const retrySchedule = Schedule.max([
	Schedule.min([Schedule.exponential("2 seconds").pipe(Schedule.jittered), Schedule.spaced("60 seconds")]),
	Schedule.recurs(8),
])

const shouldRetry = (response: Response): boolean => response.status >= 500 && response.status < 600

const doFetch = async (input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> => {
	const token = await getClerkToken()
	if (!token) return new Response(null, { status: 401 })
	return fetch(input, {
		...init,
		headers: { ...init?.headers, Authorization: `Bearer ${token}` },
	})
}

export const electricFetchClient = async (
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	const fetchEffect = Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () => doFetch(input, init),
			catch: (error) => error as Error,
		})
		if (shouldRetry(response)) return yield* Effect.fail(response)
		return response
	})

	const withRetry = fetchEffect.pipe(
		Effect.retry({
			schedule: retrySchedule,
			while: (error) => error instanceof Response && shouldRetry(error),
		}),
		Effect.catch((error) => (error instanceof Response ? Effect.succeed(error) : Effect.fail(error))),
	)

	return runtime.runPromise(withRetry) as Promise<Response>
}
