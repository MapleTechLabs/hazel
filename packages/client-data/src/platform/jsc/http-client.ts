// @effect-diagnostics experimentalApiUsage:off
/**
 * Effect's `HttpClient` over the host's URLSession (`__native.http`). The response is read whole,
 * then served as bytes, text, JSON or a one-chunk stream (what the ndjson RPC protocol reads).
 */
import { Effect, Inspectable, Layer, Option, type Schema, Stream } from "effect"
import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientError,
	HttpClientRequest,
	HttpClientResponse,
	HttpIncomingMessage,
	UrlParams,
} from "effect/http"
import { pipeArguments } from "effect/Pipeable"
import type { Socket } from "effect/socket"
import { decodeBase64, encodeBase64 } from "./base64"
import { type NativeHttpResult, nativeBridge } from "./bridge"

class NativeHttpClientResponse extends Inspectable.Class implements HttpClientResponse.HttpClientResponse {
	readonly [HttpIncomingMessage.TypeId] = HttpIncomingMessage.TypeId
	readonly [HttpClientResponse.TypeId] = HttpClientResponse.TypeId
	readonly status: number
	readonly url: string
	readonly headers: Headers.Headers
	readonly cookies: Cookies.Cookies
	readonly remoteAddress = Option.none<string>()
	private readonly bytes: Uint8Array

	constructor(
		readonly request: HttpClientRequest.HttpClientRequest,
		result: NativeHttpResult,
	) {
		super()
		this.status = result.status
		this.url = result.url.split("#")[0] ?? ""
		this.headers = Headers.fromInput(result.headers)
		const setCookie = this.headers["set-cookie"]
		this.cookies = setCookie === undefined ? Cookies.empty : Cookies.fromSetCookie(setCookie)
		this.bytes = decodeBase64(result.bodyBase64)
	}

	private decodeError(cause: unknown): HttpClientError.HttpClientError {
		return new HttpClientError.HttpClientError({
			reason: new HttpClientError.DecodeError({ request: this.request, response: this, cause }),
		})
	}

	get arrayBuffer(): Effect.Effect<ArrayBuffer, HttpClientError.HttpClientError> {
		return Effect.succeed(this.bytes.slice().buffer)
	}
	get text(): Effect.Effect<string, HttpClientError.HttpClientError> {
		return Effect.sync(() => new TextDecoder().decode(this.bytes))
	}
	get json(): Effect.Effect<Schema.Json, HttpClientError.HttpClientError> {
		return Effect.flatMap(this.text, (text) =>
			Effect.try({
				try: (): Schema.Json => (text === "" ? null : JSON.parse(text)),
				catch: (cause) => this.decodeError(cause),
			}),
		)
	}
	get urlParamsBody(): Effect.Effect<UrlParams.UrlParams, HttpClientError.HttpClientError> {
		return Effect.map(this.text, (text) => UrlParams.fromInput(new URLSearchParams(text)))
	}
	get stream(): Stream.Stream<Uint8Array, HttpClientError.HttpClientError> {
		return this.bytes.length === 0 ? Stream.empty : Stream.make(this.bytes)
	}
	get formData(): Effect.Effect<FormData, HttpClientError.HttpClientError> {
		return Effect.fail(this.decodeError(new Error("FormData is not available in JavaScriptCore")))
	}
	get upgrade(): Effect.Effect<Socket.Socket, HttpClientError.HttpClientError> {
		return Effect.fail(
			new HttpClientError.HttpClientError({
				reason: new HttpClientError.StatusCodeError({
					request: this.request,
					response: this,
					description: "URLSession requests cannot hand over the connection",
				}),
			}),
		)
	}
	toJSON(): unknown {
		return { _id: "HttpClientResponse", request: this.request.toJSON(), status: this.status }
	}
	pipe() {
		return pipeArguments(this, arguments)
	}
}

const transportError = (request: HttpClientRequest.HttpClientRequest, cause: unknown) =>
	new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) })

/** The request body as base64, for the bodies the data layer sends (text and bytes). */
const bodyOf = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<string | null, HttpClientError.HttpClientError> => {
	const body = request.body
	switch (body._tag) {
		case "Empty":
			return Effect.succeed(null)
		case "Uint8Array":
			return Effect.succeed(encodeBase64(body.body))
		case "Raw":
			return typeof body.body === "string"
				? Effect.succeed(encodeBase64(new TextEncoder().encode(body.body)))
				: Effect.fail(transportError(request, new Error("Only text raw bodies cross the bridge")))
		case "Stream":
			return Stream.runCollect(body.stream).pipe(
				Effect.map((chunks) => {
					const all = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
					let at = 0
					for (const chunk of chunks) {
						all.set(chunk, at)
						at += chunk.length
					}
					return encodeBase64(all)
				}),
				Effect.mapError((cause) => transportError(request, cause)),
			)
		case "FormData":
			return Effect.fail(transportError(request, new Error("FormData bodies are not bridged")))
	}
}

export const nativeHttpClient: HttpClient.HttpClient = HttpClient.make((request, url) =>
	Effect.flatMap(bodyOf(request), (body) =>
		Effect.callback<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>((resume) => {
			const http = nativeBridge().http
			const headers: Record<string, string> = { ...request.headers }
			delete headers["content-length"]
			const id = http.request(request.method, url.href, headers, body, (result, error) => {
				resume(
					result === null
						? Effect.fail(transportError(request, new Error(error ?? "request failed")))
						: Effect.succeed(new NativeHttpClientResponse(request, result)),
				)
			})
			return Effect.sync(() => http.cancel(id))
		}),
	),
)

/** `HttpClient` over URLSession. */
export const HttpClientJsc = Layer.succeed(HttpClient.HttpClient, nativeHttpClient)
