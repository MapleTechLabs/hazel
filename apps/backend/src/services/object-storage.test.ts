import { ConfigProvider, Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { ObjectStorageConfig, UPLOADS_S3_BINDING } from "./object-storage"

const read = (env: Record<string, unknown>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* ObjectStorageConfig
		}).pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
			Effect.map((settings) => ({
				...settings,
				accessKeyId: Redacted.value(settings.accessKeyId),
				secretAccessKey: Redacted.value(settings.secretAccessKey),
			})),
		),
	)

describe("ObjectStorageConfig", () => {
	it("reads the S3_* keys (Hazel's own stages, MinIO locally)", async () => {
		await expect(
			read({
				S3_ENDPOINT: "http://localhost:9000",
				S3_BUCKET: "hazel",
				S3_ACCESS_KEY_ID: "id",
				S3_SECRET_ACCESS_KEY: "secret",
			}),
		).resolves.toEqual({
			endpoint: "http://localhost:9000",
			bucket: "hazel",
			region: "auto",
			accessKeyId: "id",
			secretAccessKey: "secret",
		})
	})

	it("falls back to the customer install's stack-minted credentials", async () => {
		await expect(
			read({
				[UPLOADS_S3_BINDING]: JSON.stringify({
					endpoint: "https://acct.r2.cloudflarestorage.com",
					bucketName: "hazel-uploads-acme",
					region: "auto",
					accessKeyId: "token-id",
					secretAccessKey: "token-hash",
				}),
			}),
		).resolves.toEqual({
			endpoint: "https://acct.r2.cloudflarestorage.com",
			bucket: "hazel-uploads-acme",
			region: "auto",
			accessKeyId: "token-id",
			secretAccessKey: "token-hash",
		})
	})

	it("fails naming the missing key when neither is configured", async () => {
		await expect(read({})).rejects.toThrow(/S3_ENDPOINT|UPLOADS_S3/)
	})
})
