import { AwsClient } from "aws4fetch"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export class ObjectStorageError extends Schema.TaggedError<ObjectStorageError>()("ObjectStorageError", {
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
 * locally). SigV4 via `aws4fetch` runs on Workers and Bun alike, unlike Bun's built-in `s3`.
 * Path-style URLs: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`.
 */
export class ObjectStorage extends Context.Service<ObjectStorage>()("ObjectStorage", {
	make: Effect.gen(function* () {
		const endpoint = (yield* Config.String("S3_ENDPOINT")).replace(/\/+$/, "")
		const bucket = yield* Config.String("S3_BUCKET")
		const region = yield* Config.String("S3_REGION").pipe(Config.withDefault("auto"))
		const accessKeyId = yield* Config.Redacted("S3_ACCESS_KEY_ID")
		const secretAccessKey = yield* Config.Redacted("S3_SECRET_ACCESS_KEY")

		const client = new AwsClient({
			accessKeyId: Redacted.value(accessKeyId),
			secretAccessKey: Redacted.value(secretAccessKey),
			service: "s3",
			region,
		})

		const urlOf = (key: string) =>
			new URL(`${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`)

		/** Store `body` at `key` from the server (the MCP server's `upload_file`). */
		const put = Effect.fn("ObjectStorage.put")(function* (
			key: string,
			body: Uint8Array<ArrayBuffer>,
			contentType: string,
		) {
			const response = yield* Effect.tryPromise({
				try: () =>
					client.fetch(urlOf(key).toString(), {
						method: "PUT",
						// The key is a fresh attachment id: never replace what is there.
						headers: { "Content-Type": contentType, "If-None-Match": "*" },
						body,
						aws: { allHeaders: true },
					}),
				catch: (cause) => new ObjectStorageError({ message: "Failed to store the file", cause }),
			})
			if (!response.ok)
				return yield* new ObjectStorageError({
					message: `The bucket refused the file (${response.status})`,
				})
		})

		/**
		 * The size of the object stored at `key`, none when there is none (a presigned upload not
		 * made yet). Any other answer from the bucket is an error, not "missing".
		 */
		const storedSize = Effect.fn("ObjectStorage.storedSize")(function* (key: string) {
			const response = yield* Effect.tryPromise({
				try: () => client.fetch(urlOf(key).toString(), { method: "HEAD" }),
				catch: (cause) => new ObjectStorageError({ message: "Failed to check the file", cause }),
			})
			if (response.status === 404) return Option.none<number>()
			if (!response.ok)
				return yield* new ObjectStorageError({ message: `The bucket answered ${response.status}` })
			return Option.some(Number(response.headers.get("content-length") ?? "0"))
		})

		const presignPut = Effect.fn("ObjectStorage.presignPut")(function* (
			key: string,
			options: PresignPutOptions,
		) {
			const url = new URL(`${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`)
			url.searchParams.set("X-Amz-Expires", String(options.expiresIn))
			const signed = yield* Effect.tryPromise({
				try: () =>
					client.sign(url.toString(), {
						method: "PUT",
						headers: options.createOnly
							? { "Content-Type": options.contentType, "If-None-Match": "*" }
							: { "Content-Type": options.contentType },
						// `allHeaders` signs Content-Type too (aws4fetch skips it by default): the PUT must send
						// the type the handler checked, so a refused type cannot be stored after all.
						aws: { signQuery: true, allHeaders: true },
					}),
				catch: (cause) => new ObjectStorageError({ message: "Failed to presign upload URL", cause }),
			})
			return signed.url
		})

		return { presignPut, put, storedSize } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
