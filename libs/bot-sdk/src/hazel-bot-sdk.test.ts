import { afterAll, afterEach, beforeAll, describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Ref } from "effect"
import { delay, http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { vi } from "vitest"
import {
	BotGatewayAckFrame,
	BotGatewayClientFrame,
	BotGatewayDispatchFrame,
	BotGatewayHelloFrame,
	BotGatewayInvalidSessionFrame,
	BotGatewayReadyFrame,
} from "@hazel/domain"
import { BotAuth } from "./auth.ts"
import { Command, CommandGroup, EmptyCommandGroup } from "./command.ts"
import { HazelBotClient, HazelBotRuntimeConfigTag } from "./hazel-bot-sdk.ts"
import { BotRpcClient, BotRpcClientConfigTag } from "./rpc/client.ts"
import { BotStateStoreTag, GatewaySessionStoreTag } from "./gateway.ts"
import { Schema } from "effect"

vi.mock("./telemetry.ts", () => ({
	createTracingLayer: () => Layer.empty,
}))

const BACKEND_URL = "http://localhost:3070"
const GATEWAY_URL = "http://localhost:3034"
const BOT_ID = "00000000-0000-4000-8000-000000000111"
const USER_ID = "00000000-0000-4000-8000-000000000222"
const ORG_ID = "00000000-0000-4000-8000-000000000333"
const CHANNEL_ID = "00000000-0000-4000-8000-000000000444"
const BOT_TOKEN = "test-bot-token"

const EchoCommand = Command.make("echo", {
	description: "Echo text back",
	args: { text: Schema.String },
})

const commandEnvelope = {
	schemaVersion: 1 as const,
	deliveryId: "delivery-1",
	partitionKey: `org:${ORG_ID}:channel:${CHANNEL_ID}`,
	occurredAt: 1_700_000_000_000,
	idempotencyKey: `command:${BOT_ID}:echo:${CHANNEL_ID}:1700000000000`,
	eventType: "command.invoke" as const,
	payload: {
		commandName: "echo",
		channelId: CHANNEL_ID,
		userId: USER_ID,
		orgId: ORG_ID,
		arguments: { text: "hello" },
		timestamp: 1_700_000_000_000,
	},
}

const server = setupServer()

class FakeWebSocket {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSING = 2
	static readonly CLOSED = 3
	static onSend:
		| ((socket: FakeWebSocket, frame: Schema.Schema.Type<typeof BotGatewayClientFrame>) => void)
		| null = null
	static onCreate: ((socket: FakeWebSocket) => void) | null = null
	static instances: Array<FakeWebSocket> = []

	readonly listeners = new Map<string, Array<(event: any) => void>>()
	readyState = FakeWebSocket.OPEN

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this)
		queueMicrotask(() => {
			this.emit("open", {})
			FakeWebSocket.onCreate?.(this)
		})
	}

	addEventListener(type: string, listener: (event: any) => void) {
		const existing = this.listeners.get(type) ?? []
		existing.push(listener)
		this.listeners.set(type, existing)
	}

	send(data: string) {
		const frame = JSON.parse(data) as Schema.Schema.Type<typeof BotGatewayClientFrame>
		FakeWebSocket.onSend?.(this, frame)
	}

	close(code = 1000, reason = "") {
		if (this.readyState === FakeWebSocket.CLOSED) {
			return
		}
		this.readyState = FakeWebSocket.CLOSED
		this.emit("close", { code, reason })
	}

	emitServerFrame(
		frame:
			| Schema.Schema.Type<typeof BotGatewayHelloFrame>
			| Schema.Schema.Type<typeof BotGatewayReadyFrame>
			| Schema.Schema.Type<typeof BotGatewayDispatchFrame>
			| Schema.Schema.Type<typeof BotGatewayInvalidSessionFrame>,
	) {
		this.emit("message", { data: JSON.stringify(frame) })
	}

	private emit(type: string, event: any) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event)
		}
	}

	static reset() {
		FakeWebSocket.onSend = null
		FakeWebSocket.onCreate = null
		FakeWebSocket.instances = []
	}
}

const makeHazelBotLayer = (options: {
	sessionStore: any
	commands?: CommandGroup<any>
	stateStore?: {
		get: (botId: string, key: string) => Effect.Effect<string | null, any>
		set: (botId: string, key: string, value: string) => Effect.Effect<void, any>
		delete: (botId: string, key: string) => Effect.Effect<void, any>
	}
}) => {
	return HazelBotClient.layer.pipe(
		Layer.provide(
			BotAuth.layer({
				botId: BOT_ID,
				botName: "Test Bot",
				userId: USER_ID,
				channelIds: [] as readonly string[],
				token: BOT_TOKEN,
			}),
		),
		Layer.provide(Layer.succeed(BotRpcClient, {} as any)),
		Layer.provide(
			Layer.succeed(BotRpcClientConfigTag, {
				backendUrl: BACKEND_URL,
				botToken: BOT_TOKEN,
			}),
		),
		Layer.provide(
			Layer.succeed(HazelBotRuntimeConfigTag, {
				backendUrl: BACKEND_URL,
				gatewayUrl: GATEWAY_URL,
				botToken: BOT_TOKEN,
				commands: options.commands ?? EmptyCommandGroup,
				mentionable: false,
				resumeOffset: "now",
				maxConcurrentPartitions: 2,
			}),
		),
		Layer.provide(Layer.succeed(GatewaySessionStoreTag, options.sessionStore)),
		Layer.provide(
			Layer.succeed(BotStateStoreTag, {
				get: () => Effect.succeed(null),
				set: () => Effect.void,
				delete: () => Effect.void,
				...options.stateStore,
			}),
		),
	)
}

describe("HazelBotClient durable gateway", () => {
	beforeAll(() => {
		server.listen({ onUnhandledRequest: "error" })
	})

	afterEach(() => {
		server.resetHandlers()
		FakeWebSocket.reset()
	})

	afterAll(() => {
		server.close()
	})

	it("persists the next offset only after successful command handling", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const handledArgsRef = yield* Ref.make<Array<string>>([])
				const savedOffsetsRef = yield* Ref.make<Array<string>>([])
				const sentFramesRef = yield* Ref.make<Array<string>>([])
				const originalWebSocket = globalThis.WebSocket

				server.use(
					http.post(`${BACKEND_URL}/bot-commands/sync`, async () =>
						HttpResponse.json({ syncedCount: 1 }),
					),
					http.patch(`${BACKEND_URL}/bot-commands/settings`, async () =>
						HttpResponse.json({ success: true }),
					),
				)

				globalThis.WebSocket = FakeWebSocket as any
				FakeWebSocket.onCreate = (socket) => {
					socket.emitServerFrame({
						op: "HELLO",
						heartbeatIntervalMs: 60_000,
					})
				}
				FakeWebSocket.onSend = (socket, frame) => {
					Ref.update(sentFramesRef, (frames) => [...frames, frame.op]).pipe(Effect.runSync)
					if (frame.op === "IDENTIFY") {
						socket.emitServerFrame({
							op: "READY",
							sessionId: "session-1",
							resumed: false,
							resumeOffset: "now",
						})
						socket.emitServerFrame({
							op: "DISPATCH",
							sessionId: "session-1",
							events: [commandEnvelope],
							nextOffset: "1",
						})
					}
					if (frame.op === "ACK") {
						socket.close()
					}
				}

				const TestLayer = makeHazelBotLayer({
					commands: CommandGroup.make(EchoCommand),
					sessionStore: {
						load: () => Effect.succeed(null),
						save: (_botId, offset) =>
							Ref.update(savedOffsetsRef, (offsets) => [...offsets, offset]).pipe(
								Effect.asVoid,
							),
					},
				})

				yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					yield* bot.onCommand(EchoCommand, (ctx) =>
						Ref.update(handledArgsRef, (handled) => [...handled, ctx.args.text]).pipe(
							Effect.asVoid,
						),
					)
					yield* bot.start
					yield* Effect.sleep(Duration.millis(100))

					expect(yield* Ref.get(handledArgsRef)).toEqual(["hello"])
					expect(yield* Ref.get(savedOffsetsRef)).toEqual(["1"])
					expect(yield* Ref.get(sentFramesRef)).toContain("ACK")
				}).pipe(
					Effect.scoped,
					Effect.provide(TestLayer),
					Effect.ensuring(
						Effect.sync(() => {
							globalThis.WebSocket = originalWebSocket
						}),
					),
				)
			}),
		))

	it("does not advance the offset when command handling fails", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const attemptsRef = yield* Ref.make(0)
				const savedOffsetsRef = yield* Ref.make<Array<string>>([])
				const sentFramesRef = yield* Ref.make<Array<string>>([])
				const originalWebSocket = globalThis.WebSocket

				server.use(
					http.post(`${BACKEND_URL}/bot-commands/sync`, async () =>
						HttpResponse.json({ syncedCount: 1 }),
					),
					http.patch(`${BACKEND_URL}/bot-commands/settings`, async () =>
						HttpResponse.json({ success: true }),
					),
				)

				globalThis.WebSocket = FakeWebSocket as any
				FakeWebSocket.onCreate = (socket) => {
					socket.emitServerFrame({
						op: "HELLO",
						heartbeatIntervalMs: 60_000,
					})
				}
				FakeWebSocket.onSend = (socket, frame) => {
					Ref.update(sentFramesRef, (frames) => [...frames, frame.op]).pipe(Effect.runSync)
					if (frame.op === "IDENTIFY") {
						socket.emitServerFrame({
							op: "READY",
							sessionId: "session-1",
							resumed: false,
							resumeOffset: "now",
						})
						socket.emitServerFrame({
							op: "DISPATCH",
							sessionId: "session-1",
							events: [commandEnvelope],
							nextOffset: "1",
						})
						setTimeout(() => socket.close(1011, "test-finished"), 50)
					}
				}

				const TestLayer = makeHazelBotLayer({
					commands: CommandGroup.make(EchoCommand),
					sessionStore: {
						load: () => Effect.succeed(null),
						save: (_botId, offset) =>
							Ref.update(savedOffsetsRef, (offsets) => [...offsets, offset]).pipe(
								Effect.asVoid,
							),
					},
				})

				yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					yield* bot.onCommand(EchoCommand, () =>
						Ref.update(attemptsRef, (attempts) => attempts + 1).pipe(
							Effect.andThen(Effect.fail(new Error("boom"))),
						),
					)
					yield* bot.start
					yield* Effect.sleep(Duration.millis(100))

					expect(yield* Ref.get(attemptsRef)).toBe(1)
					expect(yield* Ref.get(savedOffsetsRef)).toEqual([])
					expect(yield* Ref.get(sentFramesRef)).not.toContain("ACK")
				}).pipe(
					Effect.scoped,
					Effect.provide(TestLayer),
					Effect.ensuring(
						Effect.sync(() => {
							globalThis.WebSocket = originalWebSocket
						}),
					),
				)
			}),
		))

	it("uses RESUME when a saved gateway session id exists", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const sentFramesRef = yield* Ref.make<
					Array<Schema.Schema.Type<typeof BotGatewayClientFrame>>
				>([])
				const originalWebSocket = globalThis.WebSocket

				server.use(
					http.post(`${BACKEND_URL}/bot-commands/sync`, async () =>
						HttpResponse.json({ syncedCount: 0 }),
					),
					http.patch(`${BACKEND_URL}/bot-commands/settings`, async () =>
						HttpResponse.json({ success: true }),
					),
				)

				globalThis.WebSocket = FakeWebSocket as any
				FakeWebSocket.onCreate = (socket) => {
					socket.emitServerFrame({
						op: "HELLO",
						heartbeatIntervalMs: 60_000,
					})
				}
				FakeWebSocket.onSend = (socket, frame) => {
					Ref.update(sentFramesRef, (frames) => [...frames, frame]).pipe(Effect.runSync)
					if (frame.op === "RESUME") {
						socket.close()
					}
				}

				const TestLayer = makeHazelBotLayer({
					sessionStore: {
						load: () => Effect.succeed("42"),
						save: () => Effect.void,
					},
					stateStore: {
						get: (_botId, key) =>
							Effect.succeed(key === "gateway_session_id" ? JSON.stringify("session-1") : null),
						set: () => Effect.void,
						delete: () => Effect.void,
					},
				})

				yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					yield* bot.start
					yield* Effect.sleep(Duration.millis(50))

					expect(yield* Ref.get(sentFramesRef)).toContainEqual({
						op: "RESUME",
						botToken: BOT_TOKEN,
						sessionId: "session-1",
						resumeOffset: "42",
					})
				}).pipe(
					Effect.scoped,
					Effect.provide(TestLayer),
					Effect.ensuring(
						Effect.sync(() => {
							globalThis.WebSocket = originalWebSocket
						}),
					),
				)
			}),
		))

	it("persists the gateway session id from READY", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const savedStateRef = yield* Ref.make<Array<{ key: string; value: string }>>([])
				const originalWebSocket = globalThis.WebSocket

				server.use(
					http.post(`${BACKEND_URL}/bot-commands/sync`, async () =>
						HttpResponse.json({ syncedCount: 0 }),
					),
					http.patch(`${BACKEND_URL}/bot-commands/settings`, async () =>
						HttpResponse.json({ success: true }),
					),
				)

				globalThis.WebSocket = FakeWebSocket as any
				FakeWebSocket.onCreate = (socket) => {
					socket.emitServerFrame({
						op: "HELLO",
						heartbeatIntervalMs: 60_000,
					})
				}
				FakeWebSocket.onSend = (socket, frame) => {
					if (frame.op === "IDENTIFY") {
						socket.emitServerFrame({
							op: "READY",
							sessionId: "session-1",
							resumed: false,
							resumeOffset: "now",
						})
						setTimeout(() => socket.close(), 20)
					}
				}

				const TestLayer = makeHazelBotLayer({
					sessionStore: {
						load: () => Effect.succeed(null),
						save: () => Effect.void,
					},
					stateStore: {
						get: () => Effect.succeed(null),
						set: (_botId, key, value) =>
							Ref.update(savedStateRef, (entries) => [...entries, { key, value }]).pipe(
								Effect.asVoid,
							),
						delete: () => Effect.void,
					},
				})

				yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					yield* bot.start
					yield* Effect.sleep(Duration.millis(100))

					expect(yield* Ref.get(savedStateRef)).toContainEqual({
						key: "gateway_session_id",
						value: JSON.stringify("session-1"),
					})
				}).pipe(
					Effect.scoped,
					Effect.provide(TestLayer),
					Effect.ensuring(
						Effect.sync(() => {
							globalThis.WebSocket = originalWebSocket
						}),
					),
				)
			}),
		))

	it("clears the saved gateway session id after INVALID_SESSION", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const deletedKeysRef = yield* Ref.make<Array<string>>([])
				const originalWebSocket = globalThis.WebSocket

				server.use(
					http.post(`${BACKEND_URL}/bot-commands/sync`, async () =>
						HttpResponse.json({ syncedCount: 0 }),
					),
					http.patch(`${BACKEND_URL}/bot-commands/settings`, async () =>
						HttpResponse.json({ success: true }),
					),
				)

				globalThis.WebSocket = FakeWebSocket as any
				FakeWebSocket.onCreate = (socket) => {
					socket.emitServerFrame({
						op: "HELLO",
						heartbeatIntervalMs: 60_000,
					})
				}
				FakeWebSocket.onSend = (socket, frame) => {
					if (frame.op === "RESUME") {
						socket.emitServerFrame({
							op: "INVALID_SESSION",
							reason: "expired",
						})
					}
				}

				const TestLayer = makeHazelBotLayer({
					sessionStore: {
						load: () => Effect.succeed("42"),
						save: () => Effect.void,
					},
					stateStore: {
						get: (_botId, key) =>
							Effect.succeed(key === "gateway_session_id" ? JSON.stringify("session-1") : null),
						set: () => Effect.void,
						delete: (_botId, key) =>
							Ref.update(deletedKeysRef, (keys) => [...keys, key]).pipe(Effect.asVoid),
					},
				})

				yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					yield* bot.start
					yield* Effect.sleep(Duration.millis(100))

					expect(yield* Ref.get(deletedKeysRef)).toContain("gateway_session_id")
				}).pipe(
					Effect.scoped,
					Effect.provide(TestLayer),
					Effect.ensuring(
						Effect.sync(() => {
							globalThis.WebSocket = originalWebSocket
						}),
					),
				)
			}),
		))
})
