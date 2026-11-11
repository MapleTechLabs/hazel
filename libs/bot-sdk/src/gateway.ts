import type { BotId } from "@hazel/schema"
import { Context, Effect, Layer, Ref } from "effect"
import { GatewaySessionStoreError } from "./errors.ts"

export interface GatewaySessionStore {
	load(botId: BotId): Effect.Effect<string | null, GatewaySessionStoreError>
	save(botId: BotId, offset: string): Effect.Effect<void, GatewaySessionStoreError>
}

export const GatewaySessionStoreTag = Context.Service<GatewaySessionStore>(
	"@hazel/bot-sdk/GatewaySessionStore",
)

export const InMemoryGatewaySessionStoreLive = Layer.effect(
	GatewaySessionStoreTag,
	Effect.gen(function* () {
		const offsetsRef = yield* Ref.make(new Map<BotId, string>())

		return {
			load: (botId) =>
				Ref.get(offsetsRef).pipe(
					Effect.map((offsets) => offsets.get(botId) ?? null),
					Effect.mapError(
						(cause) =>
							new GatewaySessionStoreError({
								message: `Failed to load resume offset for bot ${botId}`,
								cause,
							}),
					),
				),

			save: (botId, offset) =>
				Ref.update(offsetsRef, (offsets) => {
					const next = new Map(offsets)
					next.set(botId, offset)
					return next
				}).pipe(
					Effect.mapError(
						(cause) =>
							new GatewaySessionStoreError({
								message: `Failed to save resume offset for bot ${botId}`,
								cause,
							}),
					),
				),
		} satisfies GatewaySessionStore
	}),
)

export interface BotStateStore {
	get(botId: BotId, key: string): Effect.Effect<string | null, GatewaySessionStoreError>
	set(botId: BotId, key: string, value: string): Effect.Effect<void, GatewaySessionStoreError>
	delete(botId: BotId, key: string): Effect.Effect<void, GatewaySessionStoreError>
}

export const BotStateStoreTag = Context.Service<BotStateStore>("@hazel/bot-sdk/BotStateStore")

export const InMemoryBotStateStoreLive = Layer.effect(
	BotStateStoreTag,
	Effect.gen(function* () {
		const stateRef = yield* Ref.make(new Map<BotId, Map<string, string>>())

		const getBotState = (state: Map<BotId, Map<string, string>>, botId: BotId) =>
			state.get(botId) ?? new Map<string, string>()

		return {
			get: (botId, key) =>
				Ref.get(stateRef).pipe(
					Effect.map((state) => getBotState(state, botId).get(key) ?? null),
					Effect.mapError(
						(cause) =>
							new GatewaySessionStoreError({
								message: `Failed to read bot state for bot ${botId} and key ${key}`,
								cause,
							}),
					),
				),

			set: (botId, key, value) =>
				Ref.update(stateRef, (state) => {
					const next = new Map(state)
					const botState = new Map(getBotState(state, botId))
					botState.set(key, value)
					next.set(botId, botState)
					return next
				}).pipe(
					Effect.mapError(
						(cause) =>
							new GatewaySessionStoreError({
								message: `Failed to persist bot state for bot ${botId} and key ${key}`,
								cause,
							}),
					),
				),

			delete: (botId, key) =>
				Ref.update(stateRef, (state) => {
					const existing = state.get(botId)
					if (!existing) {
						return state
					}
					const next = new Map(state)
					const botState = new Map(existing)
					botState.delete(key)
					if (botState.size === 0) {
						next.delete(botId)
					} else {
						next.set(botId, botState)
					}
					return next
				}).pipe(
					Effect.mapError(
						(cause) =>
							new GatewaySessionStoreError({
								message: `Failed to delete bot state for bot ${botId} and key ${key}`,
								cause,
							}),
					),
				),
		} satisfies BotStateStore
	}),
)

export const createGatewayWebSocketUrl = (gatewayUrl: string): URL => {
	const url = new URL("/bot-gateway/ws", gatewayUrl)
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
	return url
}
