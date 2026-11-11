import { describe, expect, it } from "@effect/vitest"
import type { BotId } from "@hazel/schema"
import { Effect } from "effect"
import {
	BotStateStoreTag,
	GatewaySessionStoreTag,
	InMemoryGatewaySessionStoreLive,
	InMemoryBotStateStoreLive,
	createGatewayWebSocketUrl,
} from "./gateway.ts"

const BOT_ID = "00000000-0000-4000-8000-000000000111" as BotId

describe("InMemoryGatewaySessionStoreLive", () => {
	it("loads and saves offsets per bot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* GatewaySessionStoreTag
				expect(yield* store.load(BOT_ID)).toBe(null)
				yield* store.save(BOT_ID, "11")
				expect(yield* store.load(BOT_ID)).toBe("11")
			}).pipe(Effect.provide(InMemoryGatewaySessionStoreLive)),
		))
})

describe("InMemoryBotStateStoreLive", () => {
	it("stores bot-local state per key", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* BotStateStoreTag
				expect(yield* store.get(BOT_ID, "threads")).toBe(null)
				yield* store.set(BOT_ID, "threads", '{"count":1}')
				expect(yield* store.get(BOT_ID, "threads")).toBe('{"count":1}')
				yield* store.delete(BOT_ID, "threads")
				expect(yield* store.get(BOT_ID, "threads")).toBe(null)
			}).pipe(Effect.provide(InMemoryBotStateStoreLive)),
		))
})

describe("createGatewayWebSocketUrl", () => {
	it("rewrites the gateway path and protocol for websocket sessions", () => {
		expect(createGatewayWebSocketUrl("https://api.hazel.sh/base").toString()).toBe(
			"wss://api.hazel.sh/bot-gateway/ws",
		)
		expect(createGatewayWebSocketUrl("http://localhost:3034").toString()).toBe(
			"ws://localhost:3034/bot-gateway/ws",
		)
	})
})
