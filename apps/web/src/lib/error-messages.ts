import { HttpClientError } from "effect/http"
import { RpcClientError } from "effect/rpc"
import {
	AIProviderUnavailableError,
	AIRateLimitError,
	AIResponseParseError,
	DesktopConnectionError,
	DmChannelAlreadyExistsError,
	InternalServerError,
	InvalidBearerTokenError,
	InvalidDesktopStateError,
	InvalidJwtPayloadError,
	MissingAuthCodeError,
	OAuthCallbackError,
	OAuthTimeoutError,
	OriginalMessageNotFoundError,
	SessionAuthenticationError,
	SessionExpiredError,
	SessionLoadError,
	SessionNotProvidedError,
	SessionRefreshError,
	TauriCommandError,
	TauriNotAvailableError,
	ThreadChannelNotFoundError,
	ThreadContextQueryError,
	ThreadNameUpdateError,
	TokenDecodeError,
	TokenExchangeError,
	TokenNotFoundError,
	TokenStoreError,
	UnauthorizedError,
	WorkflowServiceUnavailableError,
} from "@hazel/domain/errors"
import { Cause, Match, Schema } from "effect"
import {
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
} from "../../../../libs/effect-electric-db-collection/src"

/**
 * User-friendly error message configuration
 */
export interface UserErrorMessage {
	title: string
	description?: string
	isRetryable: boolean
}

/**
 * Schema union for Schema-based common errors.
 * Used for type-safe error matching and runtime validation.
 */
export const CommonAppErrorSchema = Schema.Union([
	// Auth errors (401)
	UnauthorizedError,
	SessionNotProvidedError,
	SessionAuthenticationError,
	InvalidJwtPayloadError,
	SessionExpiredError,
	InvalidBearerTokenError,
	// Service errors (503)
	SessionLoadError,
	SessionRefreshError,
	WorkflowServiceUnavailableError,
	// Business logic errors
	DmChannelAlreadyExistsError,
	// Server errors (500)
	InternalServerError,
	// Infrastructure errors (appear in most RPC calls)
	OptimisticActionError,
	SyncError,
	// TanStack DB errors (permanent - non-retryable)
	DuplicateKeyEffectError,
	KeyUpdateNotAllowedEffectError,
	UndefinedKeyEffectError,
	SchemaValidationEffectError,
	// TanStack DB errors (recoverable - retryable)
	KeyNotFoundEffectError,
	CollectionInErrorEffectError,
	TransactionStateEffectError,
	CollectionSyncEffectError,
	// Desktop auth errors
	TauriNotAvailableError,
	TauriCommandError,
	OAuthTimeoutError,
	OAuthCallbackError,
	MissingAuthCodeError,
	TokenStoreError,
	TokenNotFoundError,
	TokenExchangeError,
	TokenDecodeError,
	DesktopConnectionError,
	InvalidDesktopStateError,
	// Thread naming workflow errors
	ThreadChannelNotFoundError,
	OriginalMessageNotFoundError,
	ThreadContextQueryError,
	AIProviderUnavailableError,
	AIRateLimitError,
	AIResponseParseError,
	ThreadNameUpdateError,
])

/**
 * Union of common application errors that have user-friendly messages.
 * Entity-specific errors (e.g., ChannelNotFoundError) should be handled
 * at the call site where context is available.
 *
 * Note: ParseError and HttpClientError are not Schema-based, so they're
 * added to the type union separately.
 */
export type CommonAppError =
	| typeof CommonAppErrorSchema.Type
	// Non-Schema errors (still have _tag but not Schema.TaggedError)
	| Schema.SchemaError
	| HttpClientError.HttpClientError

/**
 * Static error messages for errors that don't need dynamic content
 */
const ERROR_MESSAGE_MAP: Record<string, UserErrorMessage> = {
	// Auth errors (401) - User needs to re-authenticate
	UnauthorizedError: {
		title: "You don't have permission to do this",
		description: "Contact your admin if you need access.",
		isRetryable: false,
	},
	SessionExpiredError: {
		title: "Your session has expired",
		description: "Please sign in again to continue.",
		isRetryable: false,
	},
	SessionNotProvidedError: {
		title: "Please sign in to continue",
		description: "You need to be signed in to perform this action.",
		isRetryable: false,
	},
	SessionAuthenticationError: {
		title: "Authentication failed",
		description: "Please sign in again.",
		isRetryable: false,
	},
	InvalidJwtPayloadError: {
		title: "Invalid session",
		description: "Please sign in again.",
		isRetryable: false,
	},
	InvalidBearerTokenError: {
		title: "Invalid authentication",
		description: "Please sign in again.",
		isRetryable: false,
	},

	// Service errors (503) - User can retry
	SessionLoadError: {
		title: "Service temporarily unavailable",
		description: "We're having trouble connecting. Please try again.",
		isRetryable: true,
	},
	WorkflowServiceUnavailableError: {
		title: "Service temporarily unavailable",
		description: "The workflow service is temporarily unavailable. Please try again later.",
		isRetryable: true,
	},
	SessionRefreshError: {
		title: "Session refresh failed",
		description: "Please sign in again.",
		isRetryable: false,
	},

	// Business logic errors (409)
	DmChannelAlreadyExistsError: {
		title: "This conversation already exists",
		description: "You already have a direct message with this person.",
		isRetryable: false,
	},

	// Server errors (500)
	InternalServerError: {
		title: "Something went wrong",
		description: "Please try again later.",
		isRetryable: true,
	},

	// Infrastructure errors - generic handling
	OptimisticActionError: {
		title: "Action failed",
		description: "Please try again.",
		isRetryable: true,
	},
	SyncError: {
		title: "Sync failed",
		description: "Your changes were saved but sync is delayed.",
		isRetryable: false,
	},
	RpcClientError: {
		title: "Request failed",
		description: "Please try again.",
		isRetryable: true,
	},
	ParseError: {
		title: "Invalid response",
		description: "Please try again.",
		isRetryable: true,
	},
	RequestError: {
		title: "Connection failed",
		description: "Please check your internet connection.",
		isRetryable: true,
	},
	ResponseError: {
		title: "Server error",
		description: "Please try again later.",
		isRetryable: true,
	},

	// TanStack DB errors - permanent (non-retryable)
	DuplicateKeyEffectError: {
		title: "Item already exists",
		description: "An item with this ID already exists. Please use a different ID.",
		isRetryable: false,
	},
	KeyUpdateNotAllowedEffectError: {
		title: "Cannot change item ID",
		description: "Item IDs cannot be modified. Delete and recreate the item instead.",
		isRetryable: false,
	},
	UndefinedKeyEffectError: {
		title: "Missing item ID",
		description: "The item is missing a required ID field.",
		isRetryable: false,
	},

	// TanStack DB errors - recoverable (retryable)
	CollectionInErrorEffectError: {
		title: "Collection error",
		description: "The data collection is in an error state. Please try refreshing.",
		isRetryable: true,
	},
	TransactionStateEffectError: {
		title: "Transaction error",
		description: "The operation couldn't be completed. Please try again.",
		isRetryable: true,
	},
	CollectionSyncEffectError: {
		title: "Sync error",
		description: "Failed to sync data. Please try again.",
		isRetryable: true,
	},

	// Thread naming workflow errors
	ThreadChannelNotFoundError: {
		title: "Thread not found",
		description: "This thread may have been deleted.",
		isRetryable: false,
	},
	OriginalMessageNotFoundError: {
		title: "Message not found",
		description: "The original message could not be found.",
		isRetryable: false,
	},
	ThreadContextQueryError: {
		title: "Database error",
		description: "Failed to load thread data. Please try again.",
		isRetryable: true,
	},
	AIProviderUnavailableError: {
		title: "AI service unavailable",
		description: "The AI service is temporarily unavailable. Please try again later.",
		isRetryable: true,
	},
	AIRateLimitError: {
		title: "AI rate limited",
		description: "Please wait a moment and try again.",
		isRetryable: true,
	},
	AIResponseParseError: {
		title: "AI response error",
		description: "The AI returned an unexpected response. Please try again.",
		isRetryable: true,
	},
	ThreadNameUpdateError: {
		title: "Update failed",
		description: "Failed to save the thread name. Please try again.",
		isRetryable: true,
	},

	// Desktop auth errors
	TauriNotAvailableError: {
		title: "Desktop app not available",
		description: "Please make sure Hazel is running.",
		isRetryable: false,
	},
	TauriCommandError: {
		title: "Desktop command failed",
		description: "Please restart Hazel and try again.",
		isRetryable: true,
	},
	OAuthTimeoutError: {
		title: "Sign in timed out",
		description: "The sign in process took too long. Please try again.",
		isRetryable: true,
	},
	OAuthCallbackError: {
		title: "Authentication failed",
		description: "There was a problem with the sign in process.",
		isRetryable: true,
	},
	MissingAuthCodeError: {
		title: "Authentication incomplete",
		description: "No authorization code received. Please try again.",
		isRetryable: true,
	},
	TokenStoreError: {
		title: "Failed to store credentials",
		description: "Please try signing in again.",
		isRetryable: true,
	},
	TokenNotFoundError: {
		title: "Not signed in",
		description: "Please sign in to continue.",
		isRetryable: false,
	},
	TokenExchangeError: {
		title: "Sign in failed",
		description: "Could not complete sign in. Please try again.",
		isRetryable: true,
	},
	TokenDecodeError: {
		title: "Invalid response",
		description: "Received an invalid response from the server.",
		isRetryable: true,
	},
	DesktopConnectionError: {
		title: "Could not connect to Hazel",
		description: "Make sure Hazel is running on your computer.",
		isRetryable: true,
	},
	InvalidDesktopStateError: {
		title: "Invalid authentication state",
		description: "Please try signing in again.",
		isRetryable: true,
	},
}

/**
 * Gets error message for errors that need dynamic content based on error properties
 */
function getDynamicErrorMessage(error: CommonAppError): UserErrorMessage | null {
	if (!("_tag" in error)) return null

	switch (error._tag) {
		case "SchemaValidationEffectError": {
			const e = error as typeof SchemaValidationEffectError.Type
			return {
				title: "Invalid data",
				description: e.issues[0]?.message || "The data doesn't match the expected format.",
				isRetryable: false,
			}
		}
		case "KeyNotFoundEffectError": {
			const e = error as typeof KeyNotFoundEffectError.Type
			return {
				title: e.operation === "update" ? "Item not found" : "Already deleted",
				description:
					e.operation === "update"
						? "The item you're trying to update doesn't exist."
						: "This item has already been deleted.",
				isRetryable: true,
			}
		}
		default:
			return null
	}
}

/**
 * Gets user-friendly error message for common application errors.
 * Uses a tag-based lookup for static messages and dynamic handlers for errors
 * that need to inspect error properties.
 */
export function getCommonErrorMessage(error: CommonAppError): UserErrorMessage {
	// First check for dynamic error messages
	const dynamicMessage = getDynamicErrorMessage(error)
	if (dynamicMessage) return dynamicMessage

	// Then check static message map
	if ("_tag" in error) {
		const staticMessage = ERROR_MESSAGE_MAP[error._tag]
		if (staticMessage) return staticMessage
	}

	// Fallback for unknown errors
	return {
		title: "An error occurred",
		description: undefined,
		isRetryable: false,
	}
}

/**
 * Network error message for connection issues
 */
const NETWORK_ERROR_MESSAGE: UserErrorMessage = {
	title: "Connection lost",
	description: "Check your internet connection and try again.",
	isRetryable: true,
}

/**
 * Timeout error message
 */
const TIMEOUT_ERROR_MESSAGE: UserErrorMessage = {
	title: "Request timed out",
	description: "The server is taking too long to respond. Please try again.",
	isRetryable: true,
}

/**
 * Default fallback error message
 */
export const DEFAULT_ERROR_MESSAGE: UserErrorMessage = {
	title: "An error occurred",
	description: undefined,
	isRetryable: false,
}

/**
 * Schema.is for Schema-based common errors (fast path)
 */
const isSchemaCommonError = Schema.is(CommonAppErrorSchema)

/**
 * Tags for non-Schema errors that are still common
 */
const NON_SCHEMA_COMMON_TAGS = new Set(["ParseError", "HttpClientError", "RpcClientError"])

/**
 * Type guard for CommonAppError.
 * Uses Schema.is for Schema-based errors and tag check for others.
 */
export function isCommonAppError(error: unknown): error is CommonAppError {
	// Fast path for Schema-based errors
	if (isSchemaCommonError(error)) return true

	// Check non-Schema errors by _tag
	if (typeof error === "object" && error !== null && "_tag" in error) {
		const tag = (error as { _tag: string })._tag
		return NON_SCHEMA_COMMON_TAGS.has(tag)
	}
	return false
}

/**
 * Checks if an error is a network/transport error
 */
function isNetworkError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false

	// Effect HttpClientError.RequestError with Transport reason
	if ("_tag" in error && error._tag === "HttpClientError" && "reason" in error) {
		return (error as { reason: string }).reason === "Transport"
	}

	// Standard fetch errors
	if (error instanceof TypeError && error.message.includes("fetch")) {
		return true
	}

	return false
}

/**
 * Checks if an error is a timeout error
 */
function isTimeoutError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false
	if ("_tag" in error) {
		return (error as { _tag: string })._tag === "TimeoutError"
	}
	return false
}

/**
 * Extracts user-friendly error information from a Cause.
 * Uses type-safe Match for common errors, falls back to message extraction.
 */
export function getUserFriendlyError<E>(cause: Cause.Cause<E>): UserErrorMessage {
	const firstFailure = cause.reasons.find(Cause.isFailReason)?.error

	if (firstFailure !== undefined) {
		const error = firstFailure

		// Check for network errors first
		if (isNetworkError(error)) {
			return NETWORK_ERROR_MESSAGE
		}

		// Check for timeout errors
		if (isTimeoutError(error)) {
			return TIMEOUT_ERROR_MESSAGE
		}

		// Use type-safe matcher for common errors
		if (isCommonAppError(error)) {
			return getCommonErrorMessage(error)
		}

		// Fall back to extracting message property for unknown tagged errors
		if (typeof error === "object" && error !== null && "message" in error) {
			return {
				title: String((error as { message: unknown }).message),
				isRetryable: false,
			}
		}

		if (error instanceof Error) {
			return { title: error.message, isRetryable: false }
		}

		if (typeof error === "string") {
			return { title: error, isRetryable: false }
		}
	}

	// Check defects (unexpected errors)
	const firstDefect = cause.reasons.find(Cause.isDieReason)?.defect

	if (firstDefect !== undefined) {
		const defect = firstDefect
		if (defect instanceof Error) {
			return { title: defect.message, isRetryable: false }
		}
	}

	return DEFAULT_ERROR_MESSAGE
}

/**
 * Gets just the user-friendly message string from a Cause.
 * Convenience wrapper around getUserFriendlyError.
 */
export function getUserFriendlyMessage<E>(cause: Cause.Cause<E>): string {
	return getUserFriendlyError(cause).title
}

/**
 * Determines if an error is retryable based on its type.
 */
export function isRetryableError<E>(cause: Cause.Cause<E>): boolean {
	return getUserFriendlyError(cause).isRetryable
}
