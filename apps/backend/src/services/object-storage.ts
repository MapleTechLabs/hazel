import * as AwsClient from "@distilled.cloud/aws4signer/AwsClient"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClientRequest } from "effect/http"

export class ObjectStorageError extends Schema.TaggedError<
	ObjectStorageError,
	{ readonly brand: unique symbol }
>()("ObjectStorageError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export interface PresignPutOptions {
	readonly contentType: string
	/** Seconds until the URL expires. */
	readonly expiresIn: number
	/**
	 * Sign `If-None-Match: *` into the URL: the PUT must send it, and the bucket refuses it (412)
	 * once an object is at the key, so the URL cannot replace a file after it was checked.
	 */
	readonly createOnly?: boolean
}

/**
 * Presigned uploads against the S3 API of the uploads bucket (R2 in every deployed stage, MinIO
 * locally). SigV4 via `@distilled.cloud/aws4signer` (an Effect port of `aws4fetch`'s signer) runs on
 * Workers and Bun alike, unlike Bun's built-in `s3`. Path-style URLs: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`.
 */
export class ObjectStorage extends Context.Service<ObjectStorage>()("ObjectStorage", {
	make: Effect.gen(function* () {
		const endpoint = (yield* Config.String("S3_ENDPOINT")).replace(/\/+$/, "")
		const bucket = yield* Config.String("S3_BUCKET")
		const region = yield* Config.String("S3_REGION").pipe(Config.withDefault("auto"))
		const accessKeyId = yield* Config.Redacted("S3_ACCESS_KEY_ID")
		const secretAccessKey = yield* Config.Redacted("S3_SECRET_ACCESS_KEY")

		const signing = {
			credentials: { accessKeyId: Redacted.value(accessKeyId), secretAccessKey },
			service: "s3",
			region,
			// Signs Content-Type and the like too (skipped by default): a PUT must send the type the
			// handler checked, so a refused type cannot be stored after all.
			allHeaders: true,
		} as const
		// Built once with its transport, so a request needs nothing from the context it runs in.
		const client = yield* AwsClient.make(signing).pipe(Effect.provide(FetchHttpClient.layer))

		const urlOf = (key: string) =>
			`${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`

		/** Store `body` at `key` from the server (the MCP server's `upload_file`). */
		const put = Effect.fn("ObjectStorage.put")(function* (
			key: string,
			body: Uint8Array<ArrayBuffer>,
			contentType: string,
		) {
			const response = yield* client
				.execute(
					HttpClientRequest.put(urlOf(key)).pipe(
						// The key is a fresh attachment id: never replace what is there.
						HttpClientRequest.setHeader("If-None-Match", "*"),
						HttpClientRequest.bodyUint8Array(body, contentType),
					),
				)
				.pipe(
					Effect.mapError(
						(cause) => new ObjectStorageError({ message: "Failed to store the file", cause }),
					),
				)
			if (response.status < 200 || response.status >= 300)
				return yield* new ObjectStorageError({
					message: `The bucket refused the file (${response.status})`,
				})
		})

		/**
		 * The size of the object stored at `key`, none when there is none (a presigned upload not
		 * made yet). Any other answer from the bucket is an error, not "missing".
		 */
		const storedSize = Effect.fn("ObjectStorage.storedSize")(function* (key: string) {
			const response = yield* client
				.execute(HttpClientRequest.head(urlOf(key)))
				.pipe(
					Effect.mapError(
						(cause) => new ObjectStorageError({ message: "Failed to check the file", cause }),
					),
				)
			if (response.status === 404) return Option.none<number>()
			if (response.status < 200 || response.status >= 300)
				return yield* new ObjectStorageError({ message: `The bucket answered ${response.status}` })
			// The size check rests on it: no length is an error, never "0 bytes".
			const size = Number(response.headers["content-length"] ?? Number.NaN)
			if (!Number.isFinite(size) || size < 0)
				return yield* new ObjectStorageError({ message: "The bucket gave no valid Content-Length" })
			return Option.some(size)
		})

		const presignPut = Effect.fn("ObjectStorage.presignPut")(function* (
			key: string,
			options: PresignPutOptions,
		) {
			return yield* AwsClient.presign(urlOf(key), {
				...signing,
				method: "PUT",
				expiresIn: options.expiresIn,
				headers: options.createOnly
					? { "Content-Type": options.contentType, "If-None-Match": "*" }
					: { "Content-Type": options.contentType },
			}).pipe(
				Effect.mapError(
					(cause) => new ObjectStorageError({ message: "Failed to presign upload URL", cause }),
				),
			)
		})

		return { presignPut, put, storedSize } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
