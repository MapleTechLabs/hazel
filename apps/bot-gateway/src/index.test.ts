import { describe, expect, it } from "bun:test"
import { ConfigProvider, Effect, Layer, Option, Result, Context } from "effect"
import {
	createGatewayServer,
	GatewayStartupError,
	InstrumentedConfigLive,
	instrumentStartupLayer,
} from "./index"

const TEST_CONFIG = {
	port: 8080,
	isDev: false,
	databaseFile: ":memory:",
	durableStreamsUrl: "http://durable.test/v1/stream",
	durableStreamsToken: Option.none(),
	heartbeatIntervalMs: 25_000,
	leaseTtlSeconds: 75,
	batchAckTimeoutMs: 60_000,
} as const

const makeHub = () =>
	({
		onOpen: () => Effect.void,
		onMessage: () => Effect.void,
		onClose: () => Effect.void,
		validateBotToken: () =>
			Effect.succeed({
				id: "00000000-0000-0000-0000-000000000111",
				name: "test-bot",
			}),
		proxyRead: () =>
			Effect.succeed(
				new Response("[]", {
					status: 200,
					headers: new Headers({
						"Content-Type": "application/json",
						"Stream-Next-Offset": "0",
					}),
				}),
			),
	}) as any

const makeTestServices = async () =>
	(await Effect.runPromise(Effect.context<never>())) as Context.Context<never>

describe("bot-gateway startup", () => {
	it("maps config failures to GatewayStartupError", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Layer.build(
					InstrumentedConfigLive.pipe(
						Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
					),
				).pipe(Effect.result),
			),
		)

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(GatewayStartupError)
			expect((result.failure as GatewayStartupError).dependency).toBe("config")
		}
	})

	it("maps database failures to GatewayStartupError", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Layer.build(
					instrumentStartupLayer(Layer.effectDiscard(Effect.fail(new Error("db unavailable"))), {
						dependency: "database",
						startMessage: "db start",
						successMessage: "db ok",
						failureMessage: "db failed",
					}),
				).pipe(Effect.result),
			),
		)

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(GatewayStartupError)
			expect((result.failure as GatewayStartupError).dependency).toBe("database")
			expect((result.failure as GatewayStartupError).message).toBe("db failed")
		}
	})

	it("maps redis failures to GatewayStartupError", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Layer.build(
					instrumentStartupLayer(Layer.effectDiscard(Effect.fail(new Error("redis unavailable"))), {
						dependency: "redis",
						startMessage: "redis start",
						successMessage: "redis ok",
						failureMessage: "redis failed",
					}),
				).pipe(Effect.result),
			),
		)

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(GatewayStartupError)
			expect((result.failure as GatewayStartupError).dependency).toBe("redis")
		}
	})

	it("maps tracer failures to GatewayStartupError", async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Layer.build(
					instrumentStartupLayer(
						Layer.effectDiscard(Effect.fail(new Error("tracer unavailable"))),
						{
							dependency: "tracer",
							startMessage: "tracer start",
							successMessage: "tracer ok",
							failureMessage: "tracer failed",
						},
					),
				).pipe(Effect.result),
			),
		)

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(GatewayStartupError)
			expect((result.failure as GatewayStartupError).dependency).toBe("tracer")
		}
	})

	it("maps server bind failures to GatewayStartupError", async () => {
		const services = await makeTestServices()
		const result = await Effect.runPromise(
			Effect.scoped(
				createGatewayServer({
					config: TEST_CONFIG as any,
					hub: makeHub(),
					runtime: services,
					serve: () => {
						throw new Error("bind failed")
					},
				}).pipe(Effect.result),
			),
		)

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(GatewayStartupError)
			expect((result.failure as GatewayStartupError).dependency).toBe("server")
		}
	})

	it("starts the server with a fake serve function and wires handlers", async () => {
		const services = await makeTestServices()
		let stopCalls = 0
		let servedOptions: any = null

		const result = await Effect.runPromise(
			Effect.scoped(
				createGatewayServer({
					config: TEST_CONFIG as any,
					hub: makeHub(),
					runtime: services,
					serve: (options: any) => {
						servedOptions = options
						return {
							port: TEST_CONFIG.port,
							stop: () => {
								stopCalls += 1
							},
						}
					},
				}),
			),
		)

		expect(result.port).toBe(TEST_CONFIG.port)
		expect(stopCalls).toBe(1)
		expect(servedOptions.fetch).toBeTypeOf("function")
		expect(servedOptions.websocket.open).toBeTypeOf("function")
	})
})
