/**
 * One `MessageLiveObject` instance, independent of workerd (tests run it over in-memory storage
 * and fake sockets). The state, the message it is bound to and a pending finalize live in the
 * object's storage, loaded once per in-memory instance.
 *
 * Authorization: the first access asks the message's `ChannelObject` (`channel.liveAccess`) for
 * the author and binds the object to that channel and author. Writes are the author's only (a
 * bot writes as its user); reads need a viewer of the channel (or the author), asked again on
 * every read and socket, and every `ACCESS_RECHECK_MS` from the alarm while sockets are open: a
 * socket whose user lost access is closed (4003).
 *
 * `Complete` and `Fail` write the final snapshot into the message (`message.update` in the
 * channel's object, as the writer), retried from the alarm while the channel is unreachable.
 */
import { InternalServerError, MessageNotFoundError, UnauthorizedError } from "@hazel/domain"
import {
	cachedLiveStateOf,
	decodeLiveClientFrame,
	encodeLiveServerFrame,
	initialLiveState,
	LiveAction,
	type LiveServerFrame,
	LiveState,
	LiveWriteResult,
} from "@hazel/domain/live"
import { SyncCloseCode, SYNC_SUBPROTOCOL } from "@hazel/domain/sync"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import type { SyncObjectState, SyncSocket } from "@hazel/sync-do"
import { Clock, Context, Effect, Exit, Option, Schema } from "effect"
import { callObject } from "../objects/calls"
import { LiveAccessCall } from "../objects/channel/live-access"
import { invokeObject } from "../objects/forward"
import { channelTarget } from "../objects/kinds"
import {
	decodeInvokePrincipal,
	InvokePrincipal,
	type InvokePrincipalEncoded,
	OBJECT_ID_HEADER,
	PRINCIPAL_HEADER,
	decodeSyncPrincipal,
	type SyncPrincipal,
} from "../objects/principal"
import { ObjectStubs } from "../objects/protocol"
import { applyLiveAction } from "./state"

/** The header the live route forwards the message's (host) channel with. */
export const LIVE_CHANNEL_HEADER = "x-hazel-live-channel"

/** The subset of `ctx.storage` the object uses. */
export interface LiveStorage {
	get<T>(key: string): Promise<T | undefined>
	put(key: string, value: unknown): Promise<void>
	delete(key: string): Promise<boolean>
	setAlarm(scheduledTime: number): Promise<void>
}

// ---------------------------------------------------------------------------
// The object's DO RPC (structured clone; exits JSON-encoded)
// ---------------------------------------------------------------------------

const LiveError = Schema.Union([UnauthorizedError, MessageNotFoundError, InternalServerError])
export type LiveError = typeof LiveError.Type

export const LiveWriteRequest = Schema.Struct({
	messageId: MessageId,
	channelId: ChannelId,
	principal: InvokePrincipal,
	action: LiveAction,
})
export type LiveWriteRequest = typeof LiveWriteRequest.Type

export const LiveReadRequest = Schema.Struct({
	messageId: MessageId,
	channelId: ChannelId,
	userId: UserId,
})
export type LiveReadRequest = typeof LiveReadRequest.Type

const json = <S extends Schema.Codec<any, any, never, never>>(schema: S) =>
	Schema.toCodecJson(schema) as unknown as Schema.Codec<S["Type"], unknown>

export const LiveWriteRequestJson = json(LiveWriteRequest)
export const LiveReadRequestJson = json(LiveReadRequest)
export const LiveWriteExit = json(Schema.Exit(LiveWriteResult, LiveError, Schema.Defect()))
export const LiveReadExit = json(Schema.Exit(LiveState, LiveError, Schema.Defect()))

export interface LiveResponse {
	readonly exit: unknown
}

export interface MessageLiveRpc {
	/** `request`: `LiveWriteRequestJson`'s encoding; the exit is `LiveWriteExit`'s. */
	readonly write: (request: unknown) => Effect.Effect<LiveResponse>
	/** `request`: `LiveReadRequestJson`'s encoding; the exit is `LiveReadExit`'s. */
	readonly read: (request: unknown) => Effect.Effect<LiveResponse>
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STATE_KEY = "live.state"
const BINDING_KEY = "live.binding"
const FINALIZE_KEY = "live.finalize"
const SOCKET_TAG = "live"

/** The message this object serves, learnt on first access. */
interface Binding {
	readonly messageId: MessageId
	readonly channelId: ChannelId
	readonly authorId: UserId
}

/** A snapshot still to be written into the message, as `principal`. */
interface PendingFinalize {
	readonly principal: InvokePrincipalEncoded
	readonly attempts: number
	/** When the next attempt is due (epoch ms); absent: now. */
	readonly dueAt?: number
}

interface LiveAttachment {
	readonly v: 1
	readonly userId: UserId
	readonly expiresAt: number | null
}

const FINALIZE_MAX_ATTEMPTS = 6
/** How often open sockets' access is asked again (revoked viewers are closed). */
export const ACCESS_RECHECK_MS = 30_000
const finalizeBackoff = (attempts: number) => Math.min(60_000, 1000 * 2 ** attempts)

const send = (socket: SyncSocket, frame: LiveServerFrame) => {
	try {
		socket.send(encodeLiveServerFrame(frame))
	} catch {
		// The socket is closing; its close event cleans up.
	}
}

const close = (socket: SyncSocket, code: number, reason: string) => {
	try {
		socket.close(code, reason)
	} catch {
		// Already closed.
	}
}

const isAttachment = (value: unknown): value is LiveAttachment =>
	typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1

export interface LiveRuntimeOptions {
	readonly storage: LiveStorage
	/** The hibernation API (`acceptWebSocket`, `getWebSockets`). */
	readonly state: SyncObjectState
	readonly newId?: () => string
}

export type SocketDecision = "accepted" | "forbidden" | "not_found" | "expired" | "error"

export const makeMessageLiveRuntime = (options: LiveRuntimeOptions) =>
	Effect.gen(function* () {
		const { storage } = options
		const stubs = yield* ObjectStubs
		const newId = options.newId ?? (() => crypto.randomUUID())

		const load = <T>(key: string) => Effect.promise(() => storage.get<T>(key))
		const persist = (key: string, value: unknown) => Effect.promise(() => storage.put(key, value))

		let state: LiveState = (yield* load<LiveState>(STATE_KEY)) ?? initialLiveState
		let binding: Binding | undefined = yield* load<Binding>(BINDING_KEY)
		let pending: PendingFinalize | undefined = yield* load<PendingFinalize>(FINALIZE_KEY)

		const sockets = () => options.state.getWebSockets(SOCKET_TAG)

		const broadcast = (frames: ReadonlyArray<LiveServerFrame>) =>
			Effect.gen(function* () {
				if (frames.length === 0) return
				const now = yield* Clock.currentTimeMillis
				for (const socket of sockets()) {
					const attachment = socket.deserializeAttachment()
					if (!isAttachment(attachment)) {
						close(socket, 1011, "session_state_lost")
						continue
					}
					if (attachment.expiresAt !== null && attachment.expiresAt <= now) {
						close(socket, SyncCloseCode.Reauth, "token_expired")
						continue
					}
					for (const frame of frames) send(socket, frame)
				}
			})

		/** Ask the channel about `userId`, binding this object to the message on first sight. */
		const access = (messageId: MessageId, channelId: ChannelId, userId: UserId) =>
			Effect.gen(function* () {
				if (binding !== undefined && binding.channelId !== channelId) {
					return yield* new MessageNotFoundError({ messageId })
				}
				const answer = yield* callObject(LiveAccessCall, channelTarget(channelId), {
					messageId,
					userId,
				}).pipe(
					Effect.provideService(ObjectStubs, stubs),
					Effect.catchTag("ObjectCallError", (error) =>
						Effect.fail(
							new InternalServerError({
								message: "The message's channel is unavailable",
								cause: error,
							}),
						),
					),
				)
				if (binding === undefined) {
					binding = { messageId, channelId, authorId: answer.authorId }
					yield* persist(BINDING_KEY, binding)
				}
				return answer
			}).pipe(Effect.withSpan("MessageLive.access"))

		/** The message's author, from the binding once known. */
		const authorOf = (messageId: MessageId, channelId: ChannelId, userId: UserId) =>
			binding !== undefined && binding.channelId === channelId
				? Effect.succeed(binding.authorId)
				: Effect.map(access(messageId, channelId, userId), (answer) => answer.authorId)

		const readable = (messageId: MessageId, channelId: ChannelId, userId: UserId) =>
			Effect.flatMap(access(messageId, channelId, userId), (answer) =>
				answer.viewer || answer.authorId === userId
					? Effect.void
					: Effect.fail(
							new UnauthorizedError({
								message: "You can't read this message",
								detail: `messageId=${messageId}`,
							}),
						),
			)

		/** The one alarm: the pending snapshot's retry, and the access recheck while sockets are open. */
		const scheduleAlarm = Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const due = [
				...(pending === undefined ? [] : [pending.dueAt ?? now]),
				...(sockets().length > 0 ? [now + ACCESS_RECHECK_MS] : []),
			]
			if (due.length === 0) return
			const at = Math.min(...due)
			yield* Effect.promise(() => storage.setAlarm(at))
		})

		/** Ask the channel again for each open socket's user; close the ones that lost access. */
		const recheckSockets = Effect.gen(function* () {
			const target = binding
			const open = sockets()
			if (target === undefined || open.length === 0) return
			const now = yield* Clock.currentTimeMillis
			const byUser = new Map<UserId, Array<SyncSocket>>()
			for (const socket of open) {
				const attachment = socket.deserializeAttachment()
				if (!isAttachment(attachment)) {
					close(socket, 1011, "session_state_lost")
					continue
				}
				if (attachment.expiresAt !== null && attachment.expiresAt <= now) {
					close(socket, SyncCloseCode.Reauth, "token_expired")
					continue
				}
				byUser.set(attachment.userId, [...(byUser.get(attachment.userId) ?? []), socket])
			}
			let closed = 0
			for (const [userId, userSockets] of byUser) {
				const refusal = yield* readable(target.messageId, target.channelId, userId).pipe(
					Effect.as(undefined),
					Effect.catchTags({
						UnauthorizedError: () =>
							Effect.succeed({ code: SyncCloseCode.Forbidden, reason: "forbidden" }),
						MessageNotFoundError: () =>
							Effect.succeed({ code: SyncCloseCode.NotFound, reason: "not_found" }),
						// The channel is unreachable: keep streaming, ask again next time.
						InternalServerError: () => Effect.succeed(undefined),
					}),
				)
				if (refusal === undefined) continue
				for (const socket of userSockets) close(socket, refusal.code, refusal.reason)
				closed += userSockets.length
			}
			yield* Effect.annotateCurrentSpan({ "live.rechecked_users": byUser.size, "live.closed": closed })
		}).pipe(Effect.withSpan("MessageLive.recheckSockets"))

		/** Write the snapshot into the message; on an unreachable channel, retry from the alarm. */
		const deliverFinalize = Effect.gen(function* () {
			if (pending === undefined || binding === undefined) return
			const current = pending
			const target = binding
			const principal = yield* decodeInvokePrincipal(current.principal).pipe(Effect.orDie)
			const payload = {
				id: target.messageId,
				channelId: target.channelId,
				...(state.text === "" ? {} : { content: state.text }),
				embeds: [{ liveState: { enabled: true, cached: cachedLiveStateOf(state) } }],
			}
			const outcome = yield* invokeObject(
				stubs,
				channelTarget(target.channelId),
				"message.update",
				payload,
				principal,
			).pipe(Effect.result)
			if (outcome._tag === "Failure") {
				const attempts = current.attempts + 1
				if (attempts >= FINALIZE_MAX_ATTEMPTS) {
					yield* Effect.logError("Live state snapshot dropped: the channel stayed unreachable", {
						messageId: target.messageId,
					})
				} else {
					const now = yield* Clock.currentTimeMillis
					pending = { ...current, attempts, dueAt: now + finalizeBackoff(attempts) }
					yield* persist(FINALIZE_KEY, pending)
					yield* scheduleAlarm
					return
				}
			} else if (Exit.isFailure(outcome.success)) {
				// Refused (deleted message, lost access): retrying would not help.
				yield* Effect.logWarning("Live state snapshot refused by the channel", {
					messageId: target.messageId,
					cause: outcome.success.cause,
				})
			}
			pending = undefined
			yield* Effect.promise(() => storage.delete(FINALIZE_KEY))
		}).pipe(Effect.withSpan("MessageLive.finalize"))

		const write = (request: LiveWriteRequest) =>
			Effect.gen(function* () {
				const user = request.principal.user
				if (user === null) {
					return yield* new UnauthorizedError({
						message: "Sign in to write",
						detail: "no principal",
					})
				}
				const authorId = yield* authorOf(request.messageId, request.channelId, user.id)
				if (authorId !== user.id) {
					return yield* new UnauthorizedError({
						message: "Only the message's author can write its live state",
						detail: `messageId=${request.messageId}`,
					})
				}
				const now = yield* Clock.currentTimeMillis
				const applied = applyLiveAction(state, request.action, { now, newId })
				state = applied.state
				yield* broadcast(applied.frames)
				yield* persist(STATE_KEY, state)

				const action = request.action
				if ((action._tag === "Complete" || action._tag === "Fail") && action.persist !== false) {
					pending = {
						principal: yield* encodePrincipal(request.principal).pipe(Effect.orDie),
						attempts: 0,
					}
					yield* persist(FINALIZE_KEY, pending)
					yield* deliverFinalize
				}
				return { stepId: applied.stepId }
			}).pipe(
				Effect.withSpan("MessageLive.write", {
					attributes: { "live.action": request.action._tag, "message.id": request.messageId },
				}),
			)

		const read = (request: LiveReadRequest) =>
			readable(request.messageId, request.channelId, request.userId).pipe(
				Effect.as(state),
				Effect.withSpan("MessageLive.read", { attributes: { "message.id": request.messageId } }),
			)

		/** Adopt an accepted server socket for `principal`; a refused one is closed with its code. */
		const adopt = (
			socket: SyncSocket,
			principal: SyncPrincipal,
			messageId: MessageId,
			channelId: ChannelId,
		) =>
			Effect.gen(function* () {
				const decision = yield* readable(messageId, channelId, principal.userId).pipe(
					Effect.as<SocketDecision>("accepted"),
					Effect.catchTags({
						UnauthorizedError: () => Effect.succeed<SocketDecision>("forbidden"),
						MessageNotFoundError: () => Effect.succeed<SocketDecision>("not_found"),
						InternalServerError: (error) =>
							Effect.logWarning("Live socket could not be authorized", error.message).pipe(
								Effect.as<SocketDecision>("error"),
							),
					}),
				)
				const attachment: LiveAttachment = {
					v: 1,
					userId: principal.userId,
					expiresAt: principal.expiresAt,
				}
				options.state.acceptWebSocket(socket, decision === "accepted" ? [SOCKET_TAG] : [])
				socket.serializeAttachment(attachment)
				const now = yield* Clock.currentTimeMillis
				if (decision === "accepted" && attachment.expiresAt !== null && attachment.expiresAt <= now) {
					close(socket, SyncCloseCode.Reauth, "token_expired")
					return "expired" as const
				}
				switch (decision) {
					case "accepted":
						send(socket, { _tag: "Snapshot", state })
						yield* scheduleAlarm
						break
					case "forbidden":
						close(socket, SyncCloseCode.Forbidden, "forbidden")
						break
					case "not_found":
						close(socket, SyncCloseCode.NotFound, "not_found")
						break
					default:
						close(socket, 1011, "unavailable")
				}
				yield* Effect.annotateCurrentSpan({ "live.socket": decision })
				return decision
			}).pipe(Effect.withSpan("MessageLive.adopt", { attributes: { "message.id": messageId } }))

		/** A forwarded upgrade (workerd): the live route verified the token and set the headers. */
		const connect = (request: Request) =>
			Effect.gen(function* () {
				const principal = decodeSyncPrincipal(request.headers.get(PRINCIPAL_HEADER) ?? "")
				const messageId = Schema.decodeUnknownOption(MessageId)(request.headers.get(OBJECT_ID_HEADER))
				const channelId = Schema.decodeUnknownOption(ChannelId)(
					request.headers.get(LIVE_CHANNEL_HEADER),
				)
				if (Option.isNone(principal) || Option.isNone(messageId) || Option.isNone(channelId)) {
					return new Response("Missing live principal", { status: 400 })
				}
				const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, SyncSocket> })
					.WebSocketPair
				const pair = new Pair()
				yield* adopt(pair[1], principal.value, messageId.value, channelId.value)
				const offered = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
					.split(",")
					.map((protocol) => protocol.trim())
				// The token rides as the second entry; echo only the protocol.
				const headers = offered.includes(SYNC_SUBPROTOCOL)
					? { "Sec-WebSocket-Protocol": SYNC_SUBPROTOCOL }
					: undefined
				return new Response(null, { status: 101, webSocket: pair[0], headers } as ResponseInit)
			})

		const onMessage = (socket: SyncSocket, message: string | ArrayBuffer) =>
			Effect.sync(() => {
				const text = typeof message === "string" ? message : new TextDecoder().decode(message)
				if (Option.isSome(decodeLiveClientFrame(text))) send(socket, { _tag: "Pong" })
			})

		const onClose = (socket: SyncSocket) => Effect.sync(() => close(socket, 1000, "closed"))

		const alarm = Effect.gen(function* () {
			// Any wake retries a pending snapshot: a recheck firing before its backoff only retries early.
			yield* deliverFinalize
			yield* recheckSockets
			yield* scheduleAlarm
		}).pipe(Effect.withSpan("MessageLive.alarm"))

		return {
			write,
			read,
			adopt,
			connect,
			onMessage,
			onClose,
			alarm,
			/** The current state (tests). */
			state: () => state,
		}
	})

const encodePrincipal = Schema.encodeEffect(Schema.toCodecJson(InvokePrincipal))

export type MessageLiveRuntime = Effect.Success<ReturnType<typeof makeMessageLiveRuntime>>

/** The RPC surface over a runtime: decode, run, encode the exit (never fails). */
export const liveRpcOf = (runtime: MessageLiveRuntime): MessageLiveRpc => ({
	write: (request) =>
		Schema.decodeUnknownEffect(LiveWriteRequestJson)(request).pipe(
			Effect.flatMap((decoded) => Effect.exit(runtime.write(decoded))),
			Effect.catchTag("SchemaError", () => Effect.succeed(Exit.die("Undecodable live write"))),
			Effect.flatMap((exit) => Schema.encodeEffect(LiveWriteExit)(exit)),
			Effect.orDie,
			Effect.map((exit) => ({ exit })),
		),
	read: (request) =>
		Schema.decodeUnknownEffect(LiveReadRequestJson)(request).pipe(
			Effect.flatMap((decoded) => Effect.exit(runtime.read(decoded))),
			Effect.catchTag("SchemaError", () => Effect.succeed(Exit.die("Undecodable live read"))),
			Effect.flatMap((exit) => Schema.encodeEffect(LiveReadExit)(exit)),
			Effect.orDie,
			Effect.map((exit) => ({ exit })),
		),
})

/** Stubs to the live objects: the Worker's namespace in workerd, in-memory runtimes in tests. */
export class LiveObjectStubs extends Context.Service<
	LiveObjectStubs,
	{
		readonly get: (messageId: MessageId) => {
			readonly write: (request: unknown) => Effect.Effect<LiveResponse, unknown>
			readonly read: (request: unknown) => Effect.Effect<LiveResponse, unknown>
		}
	}
>()("@hazel/backend/LiveObjectStubs") {}
