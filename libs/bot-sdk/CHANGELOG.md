# Changelog

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
