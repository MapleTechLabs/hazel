import type { RateLimitExceededError } from "@hazel/domain"
import type {
	InternalServerError,
	InvalidBearerTokenError,
	InvalidJwtPayloadError,
	SessionAuthenticationError,
	SessionExpiredError,
	SessionLoadError,
	SessionNotProvidedError,
	SessionRefreshError,
	UnauthorizedError,
	WorkflowServiceUnavailableError,
} from "@hazel/domain/errors"
import type {
	CollectionInErrorEffectError,
	CollectionSyncEffectError,
	DuplicateKeyEffectError,
	KeyNotFoundEffectError,
	KeyUpdateNotAllowedEffectError,
	OptimisticActionError,
	SchemaValidationEffectError,
	SyncError,
	TransactionStateEffectError,
	UndefinedKeyEffectError,
} from "@hazel/effect-db-collection"
import { type Cause, Match, Predicate, Schema } from "effect"
import type { HttpClientError } from "effect/http"
import type { RpcClientError } from "effect/rpc"

/**
 * The app's error convention (`docs/foldkit-decisions/s6-errors.md`): every failure a Command can't name
 * itself collapses to a `CommonReason`, `update` turns reasons into copy, and retry policy is decided from
 * the reason, apart from the copy.
 */

/** The closed set every RPC, HTTP API and optimistic-action failure collapses to. */
export const CommonReason = Schema.Literals([
	"Offline",
	"Timeout",
	"SignedOut",
	"RateLimited",
	"Unavailable",
	"Unexpected",
])
export type CommonReason = typeof CommonReason.Type

/**
 * The errors any backend call can fail with besides its own: transport and decoding, the auth middleware,
 * the server's catch-alls, and the optimistic-action/collection machinery.
 */
export type CommonError =
	// Transport and decoding
	| HttpClientError.HttpClientError
	| RpcClientError.RpcClientError
	| Schema.SchemaError
	| Cause.TimeoutError
	// The auth middleware (`AuthFailure`)
	| UnauthorizedError
	| SessionNotProvidedError
	| SessionAuthenticationError
	| SessionExpiredError
	| SessionRefreshError
	| SessionLoadError
	| InvalidJwtPayloadError
	| InvalidBearerTokenError
	// Server catch-alls
	| InternalServerError
	| WorkflowServiceUnavailableError
	| RateLimitExceededError
	// Optimistic actions and TanStack DB
	| OptimisticActionError
	| SyncError
	| DuplicateKeyEffectError
	| KeyUpdateNotAllowedEffectError
	| UndefinedKeyEffectError
	| SchemaValidationEffectError
	| KeyNotFoundEffectError
	| CollectionInErrorEffectError
	| TransactionStateEffectError
	| CollectionSyncEffectError

/** The HTTP-level reason tags an `HttpClientError` (or an RPC's `HttpError.kind`) carries. */
type HttpReasonTag = HttpClientError.HttpClientErrorReason["_tag"]

const httpReason = (tag: HttpReasonTag, status: number | undefined): CommonReason => {
	if (tag === "TransportError") return "Offline"
	if (tag !== "StatusCodeError" || status === undefined) return "Unexpected"
	if (status === 401) return "SignedOut"
	if (status === 429) return "RateLimited"
	if (status === 502 || status === 503 || status === 504) return "Unavailable"
	return "Unexpected"
}

const rpcClientReason = (error: RpcClientError.RpcClientError): CommonReason =>
	Match.valueTags(error.reason, {
		HttpError: (reason) => httpReason(reason.kind, undefined),
		// The socket and worker transports: the connection is gone or never opened.
		SocketReadError: (): CommonReason => "Offline",
		SocketWriteError: (): CommonReason => "Offline",
		SocketOpenError: (): CommonReason => "Offline",
		SocketCloseError: (): CommonReason => "Offline",
		SocketUpgradeError: (): CommonReason => "Offline",
		WorkerSpawnError: (): CommonReason => "Unexpected",
		WorkerSendError: (): CommonReason => "Unexpected",
		WorkerReceiveError: (): CommonReason => "Unexpected",
		WorkerUnknownError: (): CommonReason => "Unexpected",
		RpcClientDefect: (): CommonReason => "Unexpected",
	})

const signedOut = (): CommonReason => "SignedOut"
const unavailable = (): CommonReason => "Unavailable"
const unexpected = (): CommonReason => "Unexpected"

/** The reason a `CommonError` collapses to. Exhaustive: a new member of the union must be classified here. */
export const commonReasonOf = (error: CommonError): CommonReason =>
	Match.valueTags(error, {
		HttpClientError: (e) => httpReason(e.reason._tag, e.response?.status),
		RpcClientError: rpcClientReason,
		SchemaError: unexpected,
		TimeoutError: (): CommonReason => "Timeout",
		UnauthorizedError: signedOut,
		SessionNotProvidedError: signedOut,
		SessionAuthenticationError: signedOut,
		SessionExpiredError: signedOut,
		SessionRefreshError: signedOut,
		InvalidJwtPayloadError: signedOut,
		InvalidBearerTokenError: signedOut,
		SessionLoadError: unavailable,
		WorkflowServiceUnavailableError: unavailable,
		CollectionSyncEffectError: unavailable,
		RateLimitExceededError: (): CommonReason => "RateLimited",
		// The write may have landed; only the confirmation timed out.
		SyncError: (): CommonReason => "Timeout",
		InternalServerError: unexpected,
		OptimisticActionError: unexpected,
		DuplicateKeyEffectError: unexpected,
		KeyUpdateNotAllowedEffectError: unexpected,
		UndefinedKeyEffectError: unexpected,
		SchemaValidationEffectError: unexpected,
		KeyNotFoundEffectError: unexpected,
		CollectionInErrorEffectError: unexpected,
		TransactionStateEffectError: unexpected,
	})

const commonTags: ReadonlySet<string> = new Set<CommonError["_tag"]>([
	"HttpClientError",
	"RpcClientError",
	"SchemaError",
	"TimeoutError",
	"UnauthorizedError",
	"SessionNotProvidedError",
	"SessionAuthenticationError",
	"SessionExpiredError",
	"SessionRefreshError",
	"InvalidJwtPayloadError",
	"InvalidBearerTokenError",
	"SessionLoadError",
	"WorkflowServiceUnavailableError",
	"CollectionSyncEffectError",
	"RateLimitExceededError",
	"SyncError",
	"InternalServerError",
	"OptimisticActionError",
	"DuplicateKeyEffectError",
	"KeyUpdateNotAllowedEffectError",
	"UndefinedKeyEffectError",
	"SchemaValidationEffectError",
	"KeyNotFoundEffectError",
	"CollectionInErrorEffectError",
	"TransactionStateEffectError",
])

/**
 * Narrows an untyped failure to a `CommonError`. Only for the places that lost the type (a Schedule's input, the
 * legacy `failureToast`); a Command already knows its `E` and uses `catchTags` + `catchCommon`.
 */
export const isCommonError = (error: unknown): error is CommonError =>
	Predicate.hasProperty(error, "_tag") && typeof error._tag === "string" && commonTags.has(error._tag)

/** The reason for any failure value: a `CommonError`'s reason, anything else is `Unexpected`. */
export const reasonOfUnknown = (error: unknown): CommonReason =>
	isCommonError(error) ? commonReasonOf(error) : "Unexpected"

// RETRY POLICY

/** Transient reasons, worth retrying the same request. */
export const isRetryableReason = (reason: CommonReason): boolean =>
	reason === "Offline" || reason === "Timeout" || reason === "Unavailable"

/** `isRetryableReason` for a raw failure, e.g. a `Schedule.while` input. */
export const isRetryableError = (error: unknown): boolean => isRetryableReason(reasonOfUnknown(error))

// COPY

/** What a toast or an inline error says. Never contains server or defect text. */
export interface UserErrorMessage {
	readonly title: string
	readonly description?: string | undefined
}

const COMMON_MESSAGES: { readonly [R in CommonReason]: UserErrorMessage } = {
	Offline: { title: "Connection lost", description: "Check your internet connection and try again." },
	Timeout: {
		title: "Request timed out",
		description: "The server is taking too long to respond. Please try again.",
	},
	SignedOut: { title: "Your session has expired", description: "Please sign in again to continue." },
	RateLimited: { title: "Rate limit exceeded", description: "Please wait before trying again." },
	Unavailable: { title: "Service temporarily unavailable", description: "Please try again in a moment." },
	Unexpected: { title: "Something went wrong", description: "Please try again." },
}

/** The shared copy for a common reason. */
export const commonMessage = (reason: CommonReason): UserErrorMessage => COMMON_MESSAGES[reason]

/** The generic message for a failure nothing classified. */
export const DEFAULT_ERROR_MESSAGE: UserErrorMessage = COMMON_MESSAGES.Unexpected

const isCommonReason = Schema.is(CommonReason)

/**
 * The copy for a feature's failure reason: `specific` covers exactly the feature's own literals, the common
 * reasons get the shared copy.
 *
 * @example failureMessage(reason, { NotFound: { title: "Channel not found" } })
 */
export const failureMessage = <Reason extends string>(
	reason: Reason | CommonReason,
	specific: { readonly [R in Exclude<Reason, CommonReason>]: UserErrorMessage },
): UserErrorMessage =>
	isCommonReason(reason)
		? commonMessage(reason)
		: ((specific as Record<string, UserErrorMessage>)[reason] ?? DEFAULT_ERROR_MESSAGE)
