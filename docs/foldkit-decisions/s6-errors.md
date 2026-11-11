# S6: Frontend error convention (apps/web-foldkit)

Status: **adopted** · 2026-10-15 · foundation stream

Every Command that can fail settles into exactly one Message. Failures are **typed reasons**, never strings, toasts
or raw `error.message`. `update` turns the reason into copy. Defects are caught in one place.

## 1. The Failure Message

```ts
// <feature>/message.ts (or next to the Command)
import { CommonReason } from "~/lib/error-messages"

/** What can go wrong when renaming, beyond the shared reasons. */
export const RenameFailure = Schema.Union([Schema.Literals(["NotFound", "NameTaken"]), CommonReason])
export type RenameFailure = typeof RenameFailure.Type

FailedRenameChannel: { reason: RenameFailure },
```

- Name: `Failed<CommandName>`. Field: `reason`. Nothing else unless update needs it (e.g. the id the result is for).
- Reason = feature literals (or a tagged union when a case carries data) **unioned with `CommonReason`**.
- No `toast: ToastRequest`, no `message: string`, no `reason: String(error)`, no `isUnauthorized: boolean` payloads.
  If nothing reads the reason, still carry it (it's cheap and makes the Message honest) — or drop the Failed variant
  only if the failure genuinely can't happen.

`CommonReason` (from `~/lib/error-messages`) is the closed set every RPC / HttpApi / optimistic-action failure collapses to:

| reason        | from                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Offline`     | `HttpClientError` with `reason._tag === "TransportError"`, `RpcClientError` whose HTTP `kind` is `TransportError`, socket errors |
| `Timeout`     | `TimeoutError`, `TxIdTimeoutError`                                                                                               |
| `SignedOut`   | `UnauthorizedError`(401 middleware) / `Session*Error` / `InvalidJwtPayloadError` / `InvalidBearerTokenError`                     |
| `RateLimited` | `RateLimitExceededError`                                                                                                         |
| `Unavailable` | `SessionLoadError`, `WorkflowServiceUnavailableError`, 5xx `StatusCodeError`, `CollectionSyncEffectError`                        |
| `Unexpected`  | `InternalServerError`, `SchemaError`, decode/encode errors, `OptimisticActionError`, TanStack key errors, defects                |

## 2. Building the reason in the Command: `Effect.catchTags` + `catchCommon`

```ts
import { catchCommon } from "../../data/actions"

const RenameChannel = Command.define("RenameChannel", {
	args: { channelId: ChannelId, name: Schema.String },
	messages: [Message.SucceededRenameChannel, Message.FailedRenameChannel],
	execute: ({ channelId, name }) =>
		updateChannelAction({ channelId, name }).pipe(
			Effect.as(Message.SucceededRenameChannel()),
			// 1. the errors this feature has words for
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedRenameChannel({ reason: "NotFound" })),
				ChannelNameTakenError: () =>
					Effect.succeed(Message.FailedRenameChannel({ reason: "NameTaken" })),
			}),
			// 2. everything left must be a CommonError (compile error otherwise), plus defects
			catchCommon((reason) => Message.FailedRenameChannel({ reason })),
		),
})
```

- `catchCommon(onReason)` is **the only `catchCause`** in feature code. It requires the remaining `E` to extend
  `CommonError`, so an un-handled feature error (e.g. `BotNotInstalledError`) is a type error, not a silent "Failed".
  Defects are logged with `Effect.logError` and become `"Unexpected"`; interrupts stay interrupts.
- Do **not** use `Effect.catch(() => …)`, `Effect.catchCause(…)`, `Effect.ignore`, `orDie`, `_tag` string sniffing,
  `String(error)` or `error.message` in Commands. Best-effort work (focus, telemetry, typing-indicator delete) may
  `Effect.ignore` with a one-line comment saying why.
- Local fallible code: `Effect.tryPromise({ try, catch: (cause) => new XError({ cause }) })` with a
  `Schema.TaggedError` (the repo's form: `class XError extends Schema.TaggedError<XError>()("XError", {...}) {}`) defined next to it, then `catchTags` it like above. Never `Effect.promise`
  around something that can reject (a defect crashes the whole app).
- Optimistic actions (`~/db/actions`) are plain functions returning Effects now: `sendMessageAction(props)`,
  `updateChannelAction(props)` … (`runAtomFn` is gone). They need `HazelRpc` (a Foldkit resource, already provided to Commands). Their error is the RPC's
  declared errors `| SyncError | OptimisticActionError`, all handled by `catchTags` + `catchCommon`.
- RPC / HTTP API: `HazelRpc.use((rpc) => rpc("channel.update", payload))` and
  `HazelApiClient.use((client) => client.group.endpoint(...))` from `src/rpc.ts`. No other client exists.

## 3. Reason → copy, in `update`

```ts
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf } from "../../data/actions"

FailedRenameChannel: ({ reason }) => [
	evo(model, { submission: () => Submission.Failed({ reason }) }),
	[ShowToast(errorToastOf(failureMessage(reason, {
		NotFound: { title: "Channel not found", description: "It may have been deleted." },
		NameTaken: { title: "That name is taken" },
	})))],
],
```

- `failureMessage(reason, specific)`: `specific` must cover exactly the feature literals (`Exclude<R, CommonReason>`),
  common reasons get the shared copy (`commonMessage(reason)`). Exhaustive by type.
- Views that render an inline error call the same `failureMessage` from the Model's stored reason.
- Copy never contains server text. `RateLimited` may use `retryAfterMs` only if the feature carries it in a tagged reason.

## 4. Retry policy is separate from copy

`isRetryableReason(reason)` (Offline, Timeout, Unavailable) and `isRetryableError(error: unknown)` (for
`Schedule.while`) live in `~/lib/error-messages`. Copy tables carry no `isRetryable` flag. The update decides whether to
offer a "Try again" button from `isRetryableReason`.

## 5. Legacy, being migrated

`failureToast(cause, fallback, handlers)` / `settle` and `Failed*{ toast }` still exist so untouched
screens compile. They are now safe (typed `handlers` keyed by `E["_tag"]`, no raw text ever shown, defects logged), but
new or touched code uses sections 1–3. `fallback` is ignored and will be removed with the last caller.
