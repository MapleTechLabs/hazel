// @effect-diagnostics experimentalApiUsage:off
/**
 * Effect's `HttpClient` over the host's URLSession (`__native.http.start`). The response is served
 * as soon as its head arrives and its body streams in chunks as URLSession hands them over, as
 * typed arrays (no base64). `stream` reads chunks as they come (the ndjson RPC protocol); the
 * other readers wait for the end. A host with only G3's `request` gets the whole-body path.
 */
import { Cause, Effect, Inspectable, Layer, Option, Queue, type Schema, Stream } from "effect"
import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientError,
	type HttpClientRequest,
	HttpClientResponse,
	HttpIncomingMessage,
	UrlParams,
} from "effect/http"
import { pipeArguments } from "effect/Pipeable"
import type { Socket } from "effect/socket"
import { decodeBase64, encodeBase64 } from "./base64"
import { type NativeBridge, type NativeHttpEvent, nativeBridge } from "./bridge"

/** The body as it arrives: kept for the whole-body readers, handed on to a stream reader. */
class Body {
	private chunks: Array<Uint8Array> = []
	private outcome: { readonly error: string | undefined } | undefined
	private reader: ((event: NativeHttpEvent) => void) | undefined
	private waiters: Array<() => void> = []

	push(event: NativeHttpEvent) {
		if (this.outcome !== undefined) return
		if (event.type === "chunk") {
			if (this.reader !== undefined) this.reader(event)
			else this.chunks.push(event.data)
			return
		}
		if (event.type === "head") return
		this.outcome = { error: event.type === "error" ? event.message : undefined }
		this.reader?.(event)
		for (const waiter of this.waiters.splice(0)) waiter()
	}

	/** Every chunk so far, then the rest as they come. One reader; the chunks are not kept for it. */
	read(onEvent: (event: NativeHttpEvent) => void): () => void {
		for (const data of this.chunks.splice(0)) onEvent({ type: "chunk", data })
		if (this.outcome !== undefined) {
			onEvent(
				this.outcome.error === undefined
					? { type: "end" }
					: { type: "error", message: this.outcome.error },
			)
			return () => {}
		}
		this.reader = onEvent
		return () => {
			this.reader = undefined
		}
	}

	/** The whole body, once it has ended. */
	whole(): Promise<Uint8Array> {
		return new Promise<void>((resolve) => {
			if (this.outcome !== undefined) resolve()
			else this.waiters.push(resolve)
		}).then(() => {
			if (this.outcome?.error !== undefined) throw new Error(this.outcome.error)
			const all = concat(this.chunks)
			this.chunks = [all]
			return all
		})
	}
}

class NativeHttpClientResponse extends Inspectable.Class implements HttpClientResponse.HttpClientResponse {
	readonly [HttpIncomingMessage.TypeId] = HttpIncomingMessage.TypeId
	readonly [HttpClientResponse.TypeId] = HttpClientResponse.TypeId
	readonly status: number
	readonly url: string
	readonly headers: Headers.Headers
	readonly cookies: Cookies.Cookies
	readonly remoteAddress = Option.none<string>()

	constructor(
		readonly request: HttpClientRequest.HttpClientRequest,
		head: {
			readonly status: number
			readonly url: string
			readonly headers: Readonly<Record<string, string>>
		},
		private readonly body: Body,
	) {
		super()
		this.status = head.status
		this.url = head.url.split("#")[0] ?? ""
		this.headers = Headers.fromInput(head.headers)
		const setCookie = this.headers["set-cookie"]
		this.cookies = setCookie === undefined ? Cookies.empty : Cookies.fromSetCookie(setCookie)
	}

	private decodeError(cause: unknown): HttpClientError.HttpClientError {
		return new HttpClientError.HttpClientError({
			reason: new HttpClientError.DecodeError({ request: this.request, response: this, cause }),
		})
	}

	private get bytes(): Effect.Effect<Uint8Array, HttpClientError.HttpClientError> {
		return Effect.tryPromise({ try: () => this.body.whole(), catch: (cause) => this.decodeError(cause) })
	}

	get arrayBuffer(): Effect.Effect<ArrayBuffer, HttpClientError.HttpClientError> {
		return Effect.map(this.bytes, (bytes) =>
			bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
				? (bytes.buffer as ArrayBuffer)
				: (bytes.slice().buffer as ArrayBuffer),
		)
	}
	get text(): Effect.Effect<string, HttpClientError.HttpClientError> {
		return Effect.map(this.bytes, (bytes) => new TextDecoder().decode(bytes))
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
		return Stream.callback<Uint8Array, HttpClientError.HttpClientError>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() =>
					this.body.read((event) => {
						if (event.type === "chunk") Queue.offerUnsafe(queue, event.data)
						else if (event.type === "end") Queue.endUnsafe(queue)
						else if (event.type === "error")
							Queue.failCauseUnsafe(
								queue,
								Cause.fail(this.decodeError(new Error(event.message))),
							)
					}),
				),
				(stop) => Effect.sync(stop),
			),
		)
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
	toJSON(): {
		readonly _id: "HttpClientResponse"
		readonly method: string
		readonly url: string
		readonly status: number
	} {
		return { _id: "HttpClientResponse", method: this.request.method, url: this.url, status: this.status }
	}
	pipe() {
		return pipeArguments(this, arguments)
	}
}

const transportError = (request: HttpClientRequest.HttpClientRequest, cause: unknown) =>
	new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) })

function concat(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
	const [only] = chunks
	if (chunks.length === 1 && only !== undefined) return only
	const all = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
	let at = 0
	for (const chunk of chunks) {
		all.set(chunk, at)
		at += chunk.length
	}
	return all
}

/** The request body as bytes (a stream body is collected first: URLSession takes one `Data`). */
const bodyOf = (
	request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<Uint8Array | null, HttpClientError.HttpClientError> => {
	const body = request.body
	switch (body._tag) {
		case "Empty":
			return Effect.succeed(null)
		case "Uint8Array":
			return Effect.succeed(body.body)
		case "Raw":
			if (typeof body.body === "string") return Effect.succeed(new TextEncoder().encode(body.body))
			if (body.body instanceof Uint8Array) return Effect.succeed(body.body)
			if (body.body instanceof ArrayBuffer) return Effect.succeed(new Uint8Array(body.body))
			return Effect.fail(
				transportError(request, new Error("Only text and byte bodies cross the bridge")),
			)
		case "Stream":
			return Stream.runCollect(body.stream).pipe(
				Effect.map((chunks) => concat([...chunks])),
				Effect.mapError((cause) => transportError(request, cause)),
			)
		case "FormData":
			return Effect.fail(transportError(request, new Error("FormData bodies are not bridged")))
	}
}

/** The request's headers without `content-length`: URLSession sets it from the body. */
const headersOf = (request: HttpClientRequest.HttpClientRequest) => {
	const { "content-length": _length, ...headers } = request.headers
	return headers
}

/** `HttpClient` over a bridge's `http`. */
export const makeNativeHttpClient = (bridge: () => NativeBridge): HttpClient.HttpClient =>
	HttpClient.make((request, url, signal) =>
		Effect.flatMap(bodyOf(request), (body) =>
			Effect.callback<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>(
				(resume) => {
					const http = bridge().http
					if (http.start === undefined) return legacy(http, request, url, body, resume)
					const response = new Body()
					let answered = false
					const id = http.start(request.method, url.href, headersOf(request), body, (event) => {
						if (event.type === "head" && !answered) {
							answered = true
							resume(Effect.succeed(new NativeHttpClientResponse(request, event, response)))
							return
						}
						if (event.type === "error" && !answered) {
							answered = true
							resume(Effect.fail(transportError(request, new Error(event.message))))
							return
						}
						response.push(event)
					})
					// The response is done with (read, or its scope closed): stop the transfer.
					const cancel = () => {
						response.push({ type: "error", message: "The request was cancelled" })
						http.cancel(id)
					}
					signal.addEventListener("abort", cancel, { once: true })
					return Effect.sync(cancel)
				},
			),
		),
	)

/** G3's bridge: the whole body at once, in base64. */
const legacy = (
	http: NativeBridge["http"],
	request: HttpClientRequest.HttpClientRequest,
	url: URL,
	body: Uint8Array | null,
	resume: (
		effect: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
	) => void,
) => {
	const send = http.request
	if (send === undefined) {
		resume(Effect.fail(transportError(request, new Error("The host has no HTTP bridge"))))
		return Effect.void
	}
	const id = send(
		request.method,
		url.href,
		headersOf(request),
		body === null ? null : encodeBase64(body),
		(result, error) => {
			if (result === null)
				return resume(Effect.fail(transportError(request, new Error(error ?? "request failed"))))
			const whole = new Body()
			const bytes = decodeBase64(result.bodyBase64)
			if (bytes.length > 0) whole.push({ type: "chunk", data: bytes })
			whole.push({ type: "end" })
			resume(Effect.succeed(new NativeHttpClientResponse(request, result, whole)))
		},
	)
	return Effect.sync(() => http.cancel(id))
}

export const nativeHttpClient: HttpClient.HttpClient = makeNativeHttpClient(nativeBridge)

/** `HttpClient` over URLSession. */
export const HttpClientJsc = Layer.succeed(HttpClient.HttpClient, nativeHttpClient)
