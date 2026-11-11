# Changelog

## 0.3.0

### Added

- Bots can run on Cloudflare: `@hazel-chat/bot-sdk/cloudflare` exports `makeBotSupervisor`,
  which runs a bot inside a Durable Object and restarts it from an alarm or a cron, and
  `durableObjectStores`, which keeps the resume offset and bot state in the object's storage.
- `launchBot`: runs a `defineBot` bot inside the current Effect context (its logger, tracer and
  `ConfigProvider`), for hosts that bring their own.
- `makeHazelBotLayer`: the bot client layer without logging, tracing or a health server.

### Changed

- The SDK no longer depends on `@effect/platform-bun`: `runHazelBot` handles SIGINT/SIGTERM itself
  and runs on Node too. Drop `@effect/platform-bun` from your dependencies if only the SDK needed it.
  The `/health` server still needs Bun and is skipped elsewhere.
- Local tracing (Effect DevTools) uses the global `WebSocket`.
- The service version comes from `COMMIT_SHA` only; `RAILWAY_GIT_COMMIT_SHA` is no longer read.

## 0.2.0

### Breaking changes

Live state (`bot.stream.*`, `bot.ai.stream`) now goes through the Hazel API instead of the
RivetKit actors service (`rivet.hazel.sh`), which is gone. Removed:

- `actorsEndpoint` (in `createHazelBot` / `runHazelBot` config and `HazelBotClient`'s config)
- the `ACTORS_URL` (and `RIVET_URL`) environment variables
- `HazelBotClient.createActorsService`, and the `ActorsClient` / `ActorsClientService` /
  `ActorsClientConfig` / `MessageActor` exports
- `HazelBotClient.updateMessageFn` and the `MessageUpdateFn` type; use `bot.message.update`
- the `rivetkit` and `jose` dependencies

### Migrating

- Drop `actorsEndpoint` and `ACTORS_URL` from your config and environment. Streams use
  `backendUrl` (`BACKEND_URL`) and the bot token you already pass.
- Code that used `createActorsService` to reach a message's live state directly can use
  `LiveStateClient` / `makeLiveStateClient` (exported from the package) or the stream helpers.
- Replace `updateMessageFn(messageId, payload)` with `bot.message.update(...)`.

## 0.1.0

- First release.
