import { describe, expect, it } from "@effect/vitest"
import type { BotId } from "@hazel/schema"
import { ConfigProvider, Effect, Logger } from "effect"
import { type DurableObjectStorageLike, durableObjectStores, makeBotSupervisor } from "./cloudflare.ts"
import { defineBot } from "./runtime.ts"

const BOT_ID = "00000000-0000-4000-8000-000000000111" as BotId

const makeStorage = () => {
	const data = new Map<string, unknown>()
	const alarms: Array<number> = []
	const storage: DurableObjectStorageLike = {
		get: async <T>(key: string) => data.get(key) as T | undefined,
		put: async (key, value) => {
			data.set(key, value)
		},
		delete: async (key) => data.delete(key),
		setAlarm: async (time) => {
			alarms.push(time)
		},
	}
	return { storage, data, alarms }
}

describe("durableObjectStores", () => {
	it("keeps the resume offset and bot state in storage", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { storage, data } = makeStorage()
				const { sessionStore, stateStore } = durableObjectStores(storage)

				expect(yield* sessionStore.load(BOT_ID)).toBe(null)
				yield* sessionStore.save(BOT_ID, "42")
				expect(yield* sessionStore.load(BOT_ID)).toBe("42")

				expect(yield* stateStore.get(BOT_ID, "threads")).toBe(null)
				yield* stateStore.set(BOT_ID, "threads", "[]")
				expect(yield* stateStore.get(BOT_ID, "threads")).toBe("[]")
				yield* stateStore.delete(BOT_ID, "threads")
				expect(yield* stateStore.get(BOT_ID, "threads")).toBe(null)

				// A second store over the same storage (the object after a restart) sees it.
				expect(yield* durableObjectStores(storage).sessionStore.load(BOT_ID)).toBe("42")
				expect([...data.keys()]).toEqual([`gateway-offset:${BOT_ID}`])
			}),
		))

	it("fails typed when storage throws", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { storage } = makeStorage()
				const { sessionStore } = durableObjectStores({
					...storage,
					get: () => Promise.reject(new Error("storage reset")),
				})
				const error = yield* Effect.flip(sessionStore.load(BOT_ID))
				expect(error._tag).toBe("GatewaySessionStoreError")
			}),
		))
})

describe("makeBotSupervisor", () => {
	it("arms the watchdog and restarts a bot that stopped", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { storage, alarms } = makeStorage()
				const stopped: Array<unknown> = []
				const bot = defineBot({ setup: () => Effect.void })

				// No BOT_TOKEN: the bot fails at startup, as with a misconfigured deploy.
				const supervisor = yield* makeBotSupervisor(bot, { storage, watchdogIntervalMs: 1_000 })
				const check = supervisor.ensureRunning.pipe(
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
					Effect.provide(
						Logger.layer([
							Logger.make(({ message }) => {
								stopped.push(message)
							}),
						]),
					),
				)

				const before = Date.now()
				expect(yield* check).toEqual({ wasRunning: false })
				expect(alarms).toHaveLength(1)
				expect(alarms[0]).toBeGreaterThanOrEqual(before + 1_000)

				// Let the failed bot fiber finish, then the next check starts it again.
				yield* Effect.yieldNow
				yield* Effect.sleep("10 millis")
				expect(stopped).toHaveLength(1)
				yield* check
				yield* Effect.sleep("10 millis")
				expect(stopped).toHaveLength(2)
				expect(alarms).toHaveLength(2)
			}).pipe(Effect.scoped),
		))

	it("does not start a second bot while one runs", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { storage } = makeStorage()
				let launches = 0
				// Reading BOT_TOKEN never completes: the bot stays "running", and each read is a launch.
				const counting = ConfigProvider.make((path) => {
					if (path[0] !== "BOT_TOKEN") return Effect.succeed(undefined)
					launches++
					return Effect.never
				})
				const supervisor = yield* makeBotSupervisor(defineBot({ setup: () => Effect.void }), {
					storage,
				})
				const check = supervisor.ensureRunning.pipe(Effect.provide(ConfigProvider.layer(counting)))
				const results = yield* Effect.all([check, check, check], { concurrency: "unbounded" })
				yield* Effect.sleep("10 millis")
				expect(launches).toBe(1)
				expect(results.map((result) => result.wasRunning).sort()).toEqual([false, true, true])
				expect(yield* check).toEqual({ wasRunning: true })
			}).pipe(Effect.scoped),
		))
})
