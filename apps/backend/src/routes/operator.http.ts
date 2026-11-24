/**
 * Operator endpoints for Durable Object point-in-time recovery (`docs/self-hosting.md`, "Backups
 * and restore"; `scripts/operator-restore.ts` calls them). Mounted only when `OPERATOR_TOKEN` is
 * set; without it, and for a missing or wrong `Authorization: Bearer <token>`, they answer 404 like
 * an unknown route.
 *
 * - `GET /internal/operator/bookmark?kind=org&id=<id>&timestamp=<ISO|ms>`: a dry run. Answers the
 *   bookmark of the object's storage at that time and its current one; changes nothing.
 * - `POST /internal/operator/restore` `{ kind, id, timestamp }`: arms the restore
 *   (`onNextSessionRestoreBookmark`) and restarts the object (`ctx.abort()`), which comes back with
 *   its storage as of `timestamp`. Answers both bookmarks: restoring to `current` undoes it.
 *
 * Objects keep 30 days of history. A restored object does not tell anyone what changed: clients
 * resync from scratch (the change log is restored too), but rows it projected into other objects
 * or the directory since then stay as they are.
 */
import { Clock, Config, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { isObjectKind, type ObjectKind } from "../worker/objects/kinds"
import { ObjectStubs } from "../worker/objects/protocol"

/** How far back Durable Object point-in-time recovery reaches. */
export const PITR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Constant-time comparison: both sides are hashed first, so neither length nor content leaks. */
export const sameToken = (given: string, expected: string) =>
	Effect.promise(async () => {
		const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		const [a, b] = await Promise.all([digest(given), digest(expected)])
		const left = new Uint8Array(a)
		const right = new Uint8Array(b)
		let diff = 0
		for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 1)
		return diff === 0
	})

const notFound = HttpServerResponse.empty({ status: 404 })

const RestoreBody = Schema.Struct({
	kind: Schema.String,
	id: Schema.String,
	timestamp: Schema.Union([Schema.String, Schema.Finite]),
})

export interface RestoreTarget {
	readonly kind: ObjectKind
	readonly id: string
	readonly at: number
}

/** Check a request's target: a known kind, an object id, and a time inside the recovery window. */
export const parseRestoreTarget = (
	input: { readonly kind: unknown; readonly id: unknown; readonly timestamp: unknown },
	now: number,
):
	| { readonly _tag: "Ok"; readonly target: RestoreTarget }
	| { readonly _tag: "Invalid"; readonly message: string } => {
	if (typeof input.kind !== "string" || !isObjectKind(input.kind))
		return { _tag: "Invalid", message: "kind must be one of org, channel, user, customers" }
	if (typeof input.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(input.id))
		return { _tag: "Invalid", message: "id must be the object's id (a UUID)" }
	const raw = input.timestamp
	const at =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && /^\d+$/.test(raw)
				? Number(raw)
				: typeof raw === "string"
					? Date.parse(raw)
					: Number.NaN
	if (!Number.isFinite(at)) return { _tag: "Invalid", message: "timestamp must be an ISO time or epoch ms" }
	if (at > now) return { _tag: "Invalid", message: "timestamp is in the future" }
	if (at < now - PITR_WINDOW_MS) return { _tag: "Invalid", message: "timestamp is older than 30 days" }
	return { _tag: "Ok", target: { kind: input.kind, id: input.id.toLowerCase(), at } }
}

const invalid = (message: string) => HttpServerResponse.text(message, { status: 400 })

const unreachable = (target: RestoreTarget, cause: unknown) =>
	Effect.logError("Operator point-in-time call failed", {
		kind: target.kind,
		id: target.id,
		cause: String(cause),
	}).pipe(Effect.as(HttpServerResponse.text("The object could not be reached", { status: 502 })))

/** The handlers, for a configured token (tests build them without the route table). */
export const makeOperatorHandlers = (token: string, stubs: ObjectStubs["Service"]) => {
	const authorized = Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		const authorization = request.headers.authorization ?? ""
		const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
		return bearer !== "" && (yield* sameToken(bearer, token))
	})

	const bookmark = Effect.gen(function* () {
		if (!(yield* authorized)) return notFound
		const request = yield* HttpServerRequest.HttpServerRequest
		const url = new URL(request.url, "http://localhost")
		const parsed = parseRestoreTarget(
			{
				kind: url.searchParams.get("kind"),
				id: url.searchParams.get("id"),
				timestamp: url.searchParams.get("timestamp"),
			},
			yield* Clock.currentTimeMillis,
		)
		if (parsed._tag === "Invalid") return invalid(parsed.message)
		const { target } = parsed
		return yield* stubs
			.get(target)
			.bookmark({ at: target.at, apply: false })
			.pipe(
				Effect.flatMap((result) =>
					HttpServerResponse.json({
						kind: target.kind,
						id: target.id,
						at: new Date(target.at).toISOString(),
						bookmark: result.bookmark,
						current: result.current,
						applied: false,
					}),
				),
				Effect.catch((cause) => unreachable(target, cause)),
			)
	}).pipe(Effect.withSpan("Operator.bookmark"))

	const restore = Effect.gen(function* () {
		if (!(yield* authorized)) return notFound
		const request = yield* HttpServerRequest.HttpServerRequest
		const body = yield* request.json.pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(RestoreBody)),
			Effect.option,
		)
		if (Option.isNone(body)) return invalid("Expected { kind, id, timestamp }")
		const parsed = parseRestoreTarget(body.value, yield* Clock.currentTimeMillis)
		if (parsed._tag === "Invalid") return invalid(parsed.message)
		const { target } = parsed
		const stub = stubs.get(target)
		return yield* stub.bookmark({ at: target.at, apply: true }).pipe(
			Effect.tap((result) =>
				Effect.logWarning("Operator armed a point-in-time restore", {
					kind: target.kind,
					id: target.id,
					at: new Date(target.at).toISOString(),
					bookmark: result.bookmark,
					undo: result.current,
				}),
			),
			// `ctx.abort()` fails the call that runs it: the failure is the restart.
			Effect.tap(() => stub.reset().pipe(Effect.ignore)),
			Effect.flatMap((result) =>
				HttpServerResponse.json({
					kind: target.kind,
					id: target.id,
					at: new Date(target.at).toISOString(),
					bookmark: result.bookmark,
					current: result.current,
					applied: true,
				}),
			),
			Effect.catch((cause) => unreachable(target, cause)),
		)
	}).pipe(Effect.withSpan("Operator.restore"))

	return { bookmark, restore }
}

export const OperatorRoutes = Layer.unwrap(
	Effect.gen(function* () {
		const configured = yield* Config.option(Config.Redacted("OPERATOR_TOKEN"))
		const token = Option.filter(configured, (value) => Redacted.value(value).trim() !== "")
		if (Option.isNone(token)) return Layer.empty
		yield* Effect.logWarning("OPERATOR_TOKEN is set: /internal/operator/* is enabled")
		const handlers = makeOperatorHandlers(Redacted.value(token.value).trim(), yield* ObjectStubs)
		return Layer.mergeAll(
			HttpRouter.add("GET", "/internal/operator/bookmark", handlers.bookmark),
			HttpRouter.add("POST", "/internal/operator/restore", handlers.restore),
		)
	}),
)
