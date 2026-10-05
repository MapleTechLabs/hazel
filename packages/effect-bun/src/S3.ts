import type { BunFile, S3File, S3FilePresignOptions } from "bun"
import { s3 as bunS3 } from "bun"
import { Effect, Layer, Match, Schema, Context } from "effect"

// ============ Error Types ============

/**
 * Base S3 error - used for S3 server errors and unknown error codes
 */
export class S3Error extends Schema.TaggedError<S3Error>()("S3Error", {
	message: Schema.String,
	code: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Missing S3 credentials (access key or secret)
 * Bun error code: ERR_S3_MISSING_CREDENTIALS
 */
export class S3MissingCredentialsError extends Schema.TaggedError<S3MissingCredentialsError>()(
	"S3MissingCredentialsError",
	{
		message: Schema.String,
	},
) {}

/**
 * Invalid HTTP method for S3 operation
 * Bun error code: ERR_S3_INVALID_METHOD
 */
export class S3InvalidMethodError extends Schema.TaggedError<S3InvalidMethodError>()("S3InvalidMethodError", {
	message: Schema.String,
}) {}

/**
 * Invalid S3 path/key
 * Bun error code: ERR_S3_INVALID_PATH
 */
export class S3InvalidPathError extends Schema.TaggedError<S3InvalidPathError>()("S3InvalidPathError", {
	message: Schema.String,
}) {}

/**
 * Invalid S3 endpoint URL
 * Bun error code: ERR_S3_INVALID_ENDPOINT
 */
export class S3InvalidEndpointError extends Schema.TaggedError<S3InvalidEndpointError>()(
	"S3InvalidEndpointError",
	{
		message: Schema.String,
	},
) {}

/**
 * Invalid signature calculation
 * Bun error code: ERR_S3_INVALID_SIGNATURE
 */
export class S3InvalidSignatureError extends Schema.TaggedError<S3InvalidSignatureError>()(
	"S3InvalidSignatureError",
	{
		message: Schema.String,
	},
) {}

/**
 * Invalid session token
 * Bun error code: ERR_S3_INVALID_SESSION_TOKEN
 */
export class S3InvalidSessionTokenError extends Schema.TaggedError<S3InvalidSessionTokenError>()(
	"S3InvalidSessionTokenError",
	{
		message: Schema.String,
	},
) {}

/**
 * Union type for all S3 errors
 */
export type S3Errors =
	| S3Error
	| S3MissingCredentialsError
	| S3InvalidMethodError
	| S3InvalidPathError
	| S3InvalidEndpointError
	| S3InvalidSignatureError
	| S3InvalidSessionTokenError

/**
 * Map Bun S3 error codes to typed Effect errors
 */
const mapS3Error = (error: unknown): S3Errors => {
	const e = error as Error & { code?: string }
	const message = e.message ?? String(error)

	return Match.value(e.code).pipe(
		Match.when("ERR_S3_MISSING_CREDENTIALS", () => new S3MissingCredentialsError({ message })),
		Match.when("ERR_S3_INVALID_METHOD", () => new S3InvalidMethodError({ message })),
		Match.when("ERR_S3_INVALID_PATH", () => new S3InvalidPathError({ message })),
		Match.when("ERR_S3_INVALID_ENDPOINT", () => new S3InvalidEndpointError({ message })),
		Match.when("ERR_S3_INVALID_SIGNATURE", () => new S3InvalidSignatureError({ message })),
		Match.when("ERR_S3_INVALID_SESSION_TOKEN", () => new S3InvalidSessionTokenError({ message })),
		Match.orElse((code) => new S3Error({ message, code, cause: error })),
	)
}

// ============ Types ============

/**
 * Re-export Bun's presign options for convenience
 */
export type { S3FilePresignOptions as PresignOptions }

/**
 * Data that can be written to S3
 */
export type S3WriteData = string | ArrayBuffer | Uint8Array | Blob | Response | Request | BunFile

// ============ Service ============

/**
 * Effect service for Bun's native S3 API.
 *
 * Uses environment variables for configuration (auto-detected by Bun):
 * - S3_ACCESS_KEY_ID
 * - S3_SECRET_ACCESS_KEY
 * - S3_ENDPOINT
 * - S3_BUCKET
 * - S3_REGION (optional)
 *
 * @example
 * ```typescript
 * import { S3 } from "@hazel/effect-bun"
 *
 * const program = Effect.gen(function* () {
 *   const s3 = yield* S3
 *   const url = yield* s3.presign("my-file.txt", { method: "PUT", expiresIn: 300 })
 *   return url
 * })
 * ```
 */
export class S3 extends Context.Service<
	S3,
	{
		/**
		 * Generate a presigned URL for S3 operations
		 */
		readonly presign: (key: string, options?: S3FilePresignOptions) => Effect.Effect<string, S3Errors>
		/**
		 * Get a lazy reference to an S3 file
		 */
		readonly file: (key: string) => Effect.Effect<S3File, S3Errors>
		/**
		 * Write data to S3
		 */
		readonly write: (key: string, data: S3WriteData) => Effect.Effect<void, S3Errors>
		/**
		 * Delete a file from S3
		 */
		readonly delete: (key: string) => Effect.Effect<void, S3Errors>
		/**
		 * Check if a file exists in S3
		 */
		readonly exists: (key: string) => Effect.Effect<boolean, S3Errors>
	}
>()("@hazel/effect-bun/S3") {
	static readonly Default = Layer.sync(S3, () => ({
		file: (key) =>
			Effect.try({
				try: () => bunS3.file(key),
				catch: mapS3Error,
			}).pipe(Effect.withSpan("S3.file", { attributes: { key } })),
		presign: (key, options) =>
			Effect.try({
				try: () => bunS3.presign(key, options),
				catch: mapS3Error,
			}).pipe(Effect.withSpan("S3.presign", { attributes: { key, method: options?.method } })),
		write: (key, data) =>
			Effect.tryPromise({
				try: () => bunS3.write(key, data),
				catch: mapS3Error,
			}).pipe(Effect.withSpan("S3.write", { attributes: { key } })),
		delete: (key) =>
			Effect.tryPromise({
				try: () => bunS3.delete(key),
				catch: mapS3Error,
			}).pipe(Effect.withSpan("S3.delete", { attributes: { key } })),
		exists: (key) =>
			Effect.tryPromise({
				try: () => bunS3.exists(key),
				catch: mapS3Error,
			}).pipe(Effect.withSpan("S3.exists", { attributes: { key } })),
	}))
}
