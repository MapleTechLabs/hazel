# @hazel-chat/bot-sdk

Official SDK for building Hazel bots with Effect-TS.

The SDK now uses a single inbound delivery model: bots connect to the Hazel bot
gateway over WebSocket, and the gateway handles replay and resume from each
bot's event log (a `BotGateway` Durable Object).

## Requirements

- `effect`
- A runtime with global `fetch` and `WebSocket`: Bun `>=1.2.0`, Node 22+, or a Cloudflare
  Durable Object (see [Running on Cloudflare](#running-on-cloudflare)). The optional `/health`
  server needs Bun.

Optional peer dependencies:

- `@effect/opentelemetry` for tracing

## Installation

```bash
bun add @hazel-chat/bot-sdk effect
```

## Quick start

```typescript
import { createHazelBot, HazelBotClient } from "@hazel-chat/bot-sdk"
import { Effect } from "effect"

const program = Effect.gen(function* () {
	const bot = yield* HazelBotClient

	yield* bot.onMessage((message) =>
		Effect.gen(function* () {
			yield* Effect.log(`Received message: ${message.content}`)
		}),
	)

	yield* bot.start
})

createHazelBot({
	botToken: process.env.BOT_TOKEN!,
	gatewayUrl: process.env.GATEWAY_URL,
	backendUrl: process.env.BACKEND_URL,
}).runMain(Effect.scoped(program))
```

## Features

- Real-time inbound delivery over the gateway WebSocket
- Replay and resume through persisted gateway offsets
- Typed command handlers and Hazel event handlers
- Message send, reply, update, delete, and react helpers
- AI and live-state streaming helpers
- Bot-local state and session offset stores

## Running on Cloudflare

A bot holds an open WebSocket to the gateway, so on Cloudflare it runs inside a Durable Object:
the object keeps the socket and the bot's fibers alive between requests. `@hazel-chat/bot-sdk/cloudflare`
has what the object needs:

- `makeBotSupervisor(bot, { storage })` runs a `defineBot(...)` bot in the object. Its
  `ensureRunning` starts the bot unless it runs and arms a watchdog alarm; call it from the
  object's `alarm()` and from a per-minute cron on the Worker, which brings the bot back after a
  deploy or an eviction.
- The resume offset and bot state go to the object's storage (`durableObjectStores`), so a
  restarted bot resumes where it stopped.

The bot reads its config (`BOT_TOKEN`, `BACKEND_URL`, `GATEWAY_URL`, ...) through Effect's
`ConfigProvider`, so provide the Worker env as one:

```typescript
import { makeBotSupervisor } from "@hazel-chat/bot-sdk/cloudflare"
import { ConfigProvider, Effect, Scope } from "effect"
import { bot } from "./bot"

export class BotRunner {
	private readonly supervisor
	constructor(
		readonly ctx: DurableObjectState,
		readonly env: Record<string, unknown>,
	) {
		const scope = Effect.runSync(Scope.make())
		this.supervisor = Effect.runSync(
			Scope.provide(makeBotSupervisor(bot, { storage: ctx.storage }), scope),
		)
	}
	ensureRunning() {
		return Effect.runPromise(
			this.supervisor.ensureRunning.pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(this.env))),
			),
		)
	}
	async alarm() {
		await this.ensureRunning()
	}
}

export default {
	// wrangler.jsonc: "triggers": { "crons": ["* * * * *"] }
	async scheduled(_event: ScheduledController, env: { BOT_RUNNER: DurableObjectNamespace<BotRunner> }) {
		await env.BOT_RUNNER.getByName("bot").ensureRunning()
	},
}
```

Hazel's own bots run this way (`bots/*/src/worker.ts`, deployed with Alchemy).

## Live-state streaming

`bot.stream.create(channelId)` and `bot.ai.stream(...)` write a message's live state through
the Hazel API (`POST /api/v1/messages/:id/live`, authenticated with the bot token). The message's
live object streams every write to the channel's viewers and saves the final snapshot into the
message on `complete` or `fail`. There is no separate actors service to configure.

Upgrading from 0.1.x: see [CHANGELOG.md](./CHANGELOG.md#020).

## Error handling

```typescript
import { AuthenticationError, GatewayReadError } from "@hazel-chat/bot-sdk"

yield *
	bot.start.pipe(
		Effect.catchTags({
			AuthenticationError: (error) => Effect.logError(`Auth failed: ${error.message}`),
			GatewayReadError: (error) => Effect.logError(`Gateway failed: ${error.message}`),
		}),
	)
```

## Architecture

```text
Hazel api Worker -> BotGateway Durable Object -> Bot gateway websocket -> Your handlers
```

Core pieces:

- `BotAuth` for authentication context
- `GatewaySessionStore` for resume offsets
- `BotStateStore` for small bot-local durable state
- `HazelBotClient` for the public bot API

## License

MIT
