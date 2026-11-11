import { type Cause, Effect, ErrorReporter, Predicate } from "effect"

/**
 * Failures that mean the server, not the caller, went wrong. Their client-facing form is a
 * stable message; the underlying `cause` (kept off the wire) is what this reporter logs.
 * `SessionLoadError` is left out: the auth middlewares log its cause where they raise it.
 */
const SERVER_FAILURE_TAGS: ReadonlySet<string> = new Set([
	"InternalServerError",
	"UploadError",
	// Escaped the remapping to InternalServerError; still a server failure.
	"DatabaseError",
	"SchemaError",
])

const isServerFailure = (reason: Cause.Reason<unknown>): boolean =>
	reason._tag === "Die" ||
	(reason._tag === "Fail" &&
		Predicate.hasProperty(reason.error, "_tag") &&
		typeof reason.error._tag === "string" &&
		SERVER_FAILURE_TAGS.has(reason.error._tag))

/**
 * Logs every RPC and HttpApi failure that is the server's fault (5xx tags and defects) with its
 * full `Cause`, including the `cause` chain clients never see. Expected 4xx failures are not
 * logged. Both RpcServer and HttpApiBuilder report failed requests to `CurrentErrorReporters`.
 */
const serverFailureReporter: ErrorReporter.ErrorReporter = {
	[ErrorReporter.TypeId]: ErrorReporter.TypeId,
	report: ({ cause, fiber }) => {
		if (!cause.reasons.some(isServerFailure)) return
		Effect.runSyncWith(fiber.context)(Effect.logError("Request failed", cause))
	},
}

export const ServerFailureReporterLive = ErrorReporter.layer([serverFailureReporter], {
	mergeWithExisting: true,
})
