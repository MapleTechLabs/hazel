import { AwsClient } from "aws4fetch"
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

export class ObjectStorageError extends Schema.TaggedError<ObjectStorageError>()("ObjectStorageError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export interface PresignPutOptions {
	readonly contentType: string
	/** Seconds until the URL expires. */
	readonly expiresIn: number
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
						headers: { "Content-Type": options.contentType },
						aws: { signQuery: true },
					}),
				catch: (cause) => new ObjectStorageError({ message: "Failed to presign upload URL", cause }),
			})
			return signed.url
		})

		return { presignPut } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
