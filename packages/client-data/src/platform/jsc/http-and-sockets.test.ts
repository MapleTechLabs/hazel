// @effect-diagnostics experimentalApiUsage:off
import { Chunk, Effect, Fiber, Stream } from "effect"
import { HttpClientRequest } from "effect/http"
import { describe, expect, test } from "vitest"
import { encodeBase64 } from "./base64"
import { makeFakeBridge, respond } from "./fake-bridge"
import { makeNativeHttpClient } from "./http-client"
import { makeNativeWebSocket } from "./sockets"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("HttpClient over the bridge", () => {
	test("sends the body as bytes and reads JSON", async () => {
		const fake = makeFakeBridge()
		const client = makeNativeHttpClient(() => fake.bridge)
		const running = Effect.runPromise(
			client
				.execute(
					HttpClientRequest.post("http://127.0.0.1:4320/rpc").pipe(
						HttpClientRequest.bodyText("héllo", "text/plain"),
						HttpClientRequest.setHeader("authorization", "Bearer t"),
					),
				)
				.pipe(
					Effect.flatMap((response) => response.json),
					Effect.scoped,
				),
		)
		await settle()
		const [call] = fake.http
		expect(call!.method).toBe("POST")
		expect(call!.headers.authorization).toBe("Bearer t")
		expect(call!.body).toBeInstanceOf(Uint8Array)
		expect(new TextDecoder().decode(call!.body!)).toBe("héllo")
		respond(call!, 200, '{"ok":true}', { "content-type": "application/json" })
		expect(await running).toEqual({ ok: true })
	})

	test("streams chunks as they arrive, before the body ends", async () => {
		const fake = makeFakeBridge()
		const client = makeNativeHttpClient(() => fake.bridge)
		const seen: Array<string> = []
		const fiber = Effect.runFork(
			client.get("http://host/stream").pipe(
				Effect.flatMap((response) =>
					response.stream.pipe(
						Stream.decodeText(),
						Stream.tap((text) => Effect.sync(() => seen.push(text))),
						Stream.runCollect,
					),
				),
				Effect.scoped,
			),
		)
		await settle()
		const [call] = fake.http
		call!.emit({
			type: "head",
			status: 200,
			url: call!.url,
			headers: { "content-type": "application/ndjson" },
		})
		call!.emit({ type: "chunk", data: new TextEncoder().encode('{"a":1}\n') })
		await settle()
		expect(seen).toEqual(['{"a":1}\n'])
		call!.emit({ type: "chunk", data: new TextEncoder().encode('{"b":2}\n') })
		call!.emit({ type: "end" })
		const all = await Effect.runPromise(Fiber.join(fiber))
		expect(Chunk.toArray(Chunk.fromIterable(all)).join("")).toBe('{"a":1}\n{"b":2}\n')
	})

	test("interrupting a request cancels it on the host", async () => {
		const fake = makeFakeBridge()
		const client = makeNativeHttpClient(() => fake.bridge)
		const fiber = Effect.runFork(client.get("http://host/slow"))
		await settle()
		await Effect.runPromise(Fiber.interrupt(fiber))
		expect(fake.cancelled).toContain(fake.http[0]!.id)
	})

	test("an error before the head is a transport error; a status is a response", async () => {
		const fake = makeFakeBridge()
		const client = makeNativeHttpClient(() => fake.bridge)
		const failing = Effect.runPromise(Effect.flip(client.get("http://host/x")))
		await settle()
		fake.http[0]!.emit({ type: "error", message: "offline" })
		expect((await failing).reason._tag).toBe("TransportError")

		const notFound = Effect.runPromise(client.get("http://host/y").pipe(Effect.map((r) => r.status)))
		await settle()
		respond(fake.http[1]!, 404, "")
		expect(await notFound).toBe(404)
	})

	test("G3's whole-body bridge still works", async () => {
		const sent: Array<string | null> = []
		const fake = makeFakeBridge({
			http: {
				request: (_method, _url, _headers, body, done) => {
					sent.push(body)
					done(
						{
							status: 200,
							url: "http://host/",
							headers: {},
							bodyBase64: encodeBase64(new TextEncoder().encode("ok")),
						},
						null,
					)
					return 1
				},
				cancel: () => {},
			},
		})
		const client = makeNativeHttpClient(() => fake.bridge)
		const text = await Effect.runPromise(
			client
				.execute(HttpClientRequest.post("http://host/").pipe(HttpClientRequest.bodyText("hi")))
				.pipe(
					Effect.flatMap((r) => r.text),
					Effect.scoped,
				),
		)
		expect(text).toBe("ok")
		expect(sent).toEqual([encodeBase64(new TextEncoder().encode("hi"))])
	})
})

describe("WebSocket over the bridge", () => {
	test("text and binary frames both ways, with the browser's states", () => {
		const fake = makeFakeBridge()
		const NativeWebSocket = makeNativeWebSocket(() => fake.bridge)
		const socket = new NativeWebSocket("ws://host/sync/mux", ["v1", "token"])
		const [native] = fake.sockets
		expect(native!.protocols).toEqual(["v1", "token"])
		expect(() => socket.send("early")).toThrow()
		const received: Array<unknown> = []
		socket.onmessage = ({ data }) => received.push(data)
		native!.emit({ type: "open", protocol: "v1" })
		expect(socket.readyState).toBe(1)
		expect(socket.protocol).toBe("v1")
		socket.send("text")
		socket.send(Uint8Array.of(1, 2, 3))
		socket.send(Uint8Array.of(9, 8, 7, 6).subarray(1, 3))
		expect(native!.sent[0]).toBe("text")
		expect([...(native!.sent[1] as Uint8Array)]).toEqual([1, 2, 3])
		expect([...(native!.sent[2] as Uint8Array)]).toEqual([8, 7])
		const buffer = Uint8Array.of(4, 5).buffer
		native!.emit({ type: "message", data: "hello" })
		native!.emit({ type: "message", data: buffer })
		expect(received).toEqual(["hello", buffer])
		expect(() => socket.close(1001)).toThrow()
		socket.close(4001, "bye")
		expect(native!.closed).toEqual({ code: 4001, reason: "bye" })
		native!.emit({ type: "message", data: "late" })
		expect(received).toHaveLength(2)
		const closes: Array<number> = []
		socket.onclose = ({ code }) => closes.push(code)
		native!.emit({ type: "close", code: 4001, reason: "bye" })
		native!.emit({ type: "close", code: 1006, reason: "" })
		expect(closes).toEqual([4001])
		expect(socket.readyState).toBe(3)
	})

	test("a text-only host refuses binary frames", () => {
		const fake = makeFakeBridge()
		const textOnly = { ...fake.bridge, socket: { ...fake.bridge.socket, binary: undefined } }
		const NativeWebSocket = makeNativeWebSocket(() => textOnly)
		const socket = new NativeWebSocket("ws://host/", [])
		fake.sockets[0]!.emit({ type: "open", protocol: "" })
		expect(() => socket.send(Uint8Array.of(1))).toThrow(/text frames only/)
	})
})
