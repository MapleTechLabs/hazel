/** Calling a `MessageLiveObject` from the api Worker: encode, send, decode the exit (typed errors). */
import { InternalServerError } from "@hazel/domain"
import { Effect, Schema } from "effect"
import {
	LiveObjectStubs,
	type LiveReadRequest,
	LiveReadExit,
	LiveReadRequestJson,
	type LiveWriteRequest,
	LiveWriteExit,
	LiveWriteRequestJson,
} from "./runtime"

const unavailable = (cause: unknown) =>
	new InternalServerError({ message: "The message's live state is unavailable", cause })

export const writeLive = (request: LiveWriteRequest) =>
	Effect.gen(function* () {
		const encoded = yield* Schema.encodeEffect(LiveWriteRequestJson)(request).pipe(Effect.orDie)
		const response = yield* (yield* LiveObjectStubs)
			.get(request.messageId)
			.write(encoded)
			.pipe(Effect.mapError(unavailable))
		return yield* yield* Schema.decodeUnknownEffect(LiveWriteExit)(response.exit).pipe(Effect.orDie)
	}).pipe(
		Effect.withSpan("MessageLive.send", {
			kind: "client",
			attributes: { "live.action": request.action._tag, "message.id": request.messageId },
		}),
	)

export const readLive = (request: LiveReadRequest) =>
	Effect.gen(function* () {
		const encoded = yield* Schema.encodeEffect(LiveReadRequestJson)(request).pipe(Effect.orDie)
		const response = yield* (yield* LiveObjectStubs)
			.get(request.messageId)
			.read(encoded)
			.pipe(Effect.mapError(unavailable))
		return yield* yield* Schema.decodeUnknownEffect(LiveReadExit)(response.exit).pipe(Effect.orDie)
	}).pipe(
		Effect.withSpan("MessageLive.readSend", {
			kind: "client",
			attributes: { "message.id": request.messageId },
		}),
	)
