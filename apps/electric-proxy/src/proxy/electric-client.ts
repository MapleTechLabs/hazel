import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"
import { Effect, Metric, Schema } from "effect"
import { proxyElectricDuration, proxyElectricErrors } from "../observability/metrics"
import { ElectricUpstream } from "./electric-upstream"

/**
 * Error thrown when Electric proxy request fails
 */
export class ElectricProxyError extends Schema.TaggedError<ElectricProxyError>()("ElectricProxyError", {
	message: Schema.String,
	detail: Schema.optional(Schema.String),
}) {}

/**
 * Prepares the Electric SQL proxy URL from a request URL
 * Copies over Electric-specific query params and adds the upstream's auth params
 *
 * @param requestUrl - The incoming request URL
 * @returns Effect that succeeds with the prepared Electric SQL origin URL
 */
export const prepareElectricUrl = Effect.fn("ElectricClient.prepareElectricUrl")(function* (
	requestUrl: string,
) {
	const upstream = yield* ElectricUpstream
	const url = new URL(requestUrl)
	const originUrl = new URL(`${upstream.baseUrl}/v1/shape`)

	// Copy Electric-specific query params
	url.searchParams.forEach((value, key) => {
		if (ELECTRIC_PROTOCOL_QUERY_PARAMS.some((param) => key === param || key.startsWith(`${param}[`))) {
			originUrl.searchParams.set(key, value)
		}
	})

	// Electric's own authentication (ELECTRIC_SECRET), set after the copy so a client cannot override it
	const authEntries = Object.entries(upstream.authParams)
	yield* Effect.annotateCurrentSpan("electric.auth.configured", authEntries.length > 0)
	yield* Effect.annotateCurrentSpan("electric.upstream", upstream.kind)
	for (const [key, value] of authEntries) {
		originUrl.searchParams.set(key, value)
	}

	return originUrl
})

/**
 * Proxies a request to Electric SQL and returns the response
 * Uses zero-copy body passthrough for maximum streaming performance
 *
 * @param originUrl - The prepared Electric SQL URL (string or URL object)
 * @returns Effect that succeeds with the proxied response
 */
export const proxyElectricRequest = Effect.fn("ElectricClient.proxyElectricRequest")(function* (
	originUrl: string | URL,
) {
	const upstream = yield* ElectricUpstream
	const urlStr = typeof originUrl === "string" ? originUrl : originUrl.toString()
	const targetUrl = new URL(urlStr)
	yield* Effect.annotateCurrentSpan("url.path", targetUrl.pathname)
	yield* Effect.annotateCurrentSpan("server.address", targetUrl.host)
	const start = Date.now()
	const response = yield* Effect.tryPromise({
		try: () => upstream.fetch(urlStr),
		catch: (error) =>
			new ElectricProxyError({
				message: "Failed to fetch from Electric SQL",
				detail: String(error),
			}),
	})
	const duration = Date.now() - start

	yield* Effect.annotateCurrentSpan("electric.status_code", response.status)
	yield* Effect.annotateCurrentSpan("electric.duration_ms", duration)
	yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
	yield* Metric.update(proxyElectricDuration, duration)

	// Log non-2xx responses for debugging (e.g. Electric returning 400 for bad params)
	if (!response.ok) {
		const upstreamRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id")
		yield* Effect.annotateCurrentSpan("error.type", "ElectricUpstreamError")
		yield* Effect.annotateCurrentSpan("error.handled", true)
		if (upstreamRequestId) {
			yield* Effect.annotateCurrentSpan("electric.upstream_request_id", upstreamRequestId)
		}
		yield* Metric.update(
			Metric.withAttributes(proxyElectricErrors, { status_code: String(response.status) }),
			1,
		)
		const errorBody = yield* Effect.promise(() => response.text())
		yield* Effect.logWarning("Electric returned non-2xx", {
			status: response.status,
			statusText: response.statusText,
			upstreamRequestId: upstreamRequestId ?? undefined,
			bodyLength: errorBody.length,
			...(response.status >= 500 ? { bodyPreview: errorBody.slice(0, 500) } : {}),
		})
		const headers = new Headers(response.headers)
		headers.delete("content-encoding")
		headers.delete("content-length")
		return new Response(errorBody, {
			status: response.status,
			statusText: response.statusText,
			headers,
		})
	}

	// Prepare response headers
	const headers = new Headers(response.headers)
	headers.delete("content-encoding")
	headers.delete("content-length")
	headers.set("vary", "Authorization")
	headers.set("X-Accel-Buffering", "no")

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
})
