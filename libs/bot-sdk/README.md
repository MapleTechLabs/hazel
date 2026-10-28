# @hazel-chat/bot-sdk

Official SDK for building Hazel bots with Effect-TS.

The SDK now uses a single inbound delivery model: bots connect to the Hazel bot
gateway over WebSocket, and the gateway handles replay and resume from each
bot's event log (a `BotGateway` Durable Object).

## Requirements

- Bun `>=1.2.0`
- `effect`
- `@effect/platform`
- `@effect/platform-bun`
- `@effect/rpc`

Optional peer dependencies:

- `@effect/opentelemetry` for tracing

## Installation

```bash
bun add @hazel-chat/bot-sdk effect @effect/platform @effect/platform-bun @effect/rpc
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
