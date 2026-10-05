import { Context, Config, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface EncryptedToken {
	ciphertext: string // Base64 encoded
	iv: string // Base64 encoded (12 bytes for AES-GCM)
	keyVersion: number
}

const EncryptionOperation = Schema.Literals(["encrypt", "decrypt", "importKey"])

export class IntegrationEncryptionError extends Schema.TaggedError<IntegrationEncryptionError>()(
	"IntegrationEncryptionError",
	{
		cause: Schema.Unknown,
		operation: EncryptionOperation,
	},
) {}

export class KeyVersionNotFoundError extends Schema.TaggedError<KeyVersionNotFoundError>()(
	"KeyVersionNotFoundError",
	{
		keyVersion: Schema.Number,
	},
) {}

export class IntegrationEncryption extends Context.Service<IntegrationEncryption>()("IntegrationEncryption", {
	make: Effect.gen(function* () {
		// Load encryption keys from config (support key rotation)
		const currentKey = yield* Config.Redacted("INTEGRATION_ENCRYPTION_KEY")
		const currentKeyVersion = yield* Config.Number("INTEGRATION_ENCRYPTION_KEY_VERSION").pipe(
			Config.withDefault(1),
		)

		// Optional: Previous key for decryption during rotation
		const previousKeyOption = yield* Config.Redacted("INTEGRATION_ENCRYPTION_KEY_PREV").pipe(
			Config.option,
		)
		const previousKey = Option.getOrUndefined(previousKeyOption)
		const previousKeyVersion = yield* Config.Number("INTEGRATION_ENCRYPTION_KEY_VERSION_PREV").pipe(
			Config.withDefault(0),
		)

		// Cache for imported crypto keys
		const keyCache = new Map<number, CryptoKey>()

		const importKey = (keyData: Redacted.Redacted<string>, version: number) =>
			Effect.gen(function* () {
				// Check cache first
				const cachedKey = keyCache.get(version)
				if (cachedKey) {
					return cachedKey
				}

				const rawKey = Buffer.from(Redacted.value(keyData), "base64")

				// Validate key length (256 bits = 32 bytes)
				if (rawKey.length !== 32) {
					return yield* Effect.fail(
						new IntegrationEncryptionError({
							cause: `Invalid key length: expected 32 bytes, got ${rawKey.length}`,
							operation: "importKey",
						}),
					)
				}

				const cryptoKey = yield* Effect.tryPromise({
					try: () =>
						crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, [
							"encrypt",
							"decrypt",
						]),
					catch: (cause) => new IntegrationEncryptionError({ cause, operation: "importKey" }),
				})

				// Cache the imported key
				keyCache.set(version, cryptoKey)
				return cryptoKey
			})

		const encrypt = Effect.fn("IntegrationEncryption.encrypt")(function* (plaintext: string) {
			const key = yield* importKey(currentKey, currentKeyVersion)

			// Generate random 12-byte IV for AES-GCM
			const iv = crypto.getRandomValues(new Uint8Array(12))
			const encoded = new TextEncoder().encode(plaintext)

			const ciphertext = yield* Effect.tryPromise({
				try: () =>
					crypto.subtle.encrypt(
						{
							name: "AES-GCM",
							iv,
							tagLength: 128,
						},
						key,
						encoded,
					),
				catch: (cause) => new IntegrationEncryptionError({ cause, operation: "encrypt" }),
			})

			return {
				ciphertext: Buffer.from(ciphertext).toString("base64"),
				iv: Buffer.from(iv).toString("base64"),
				keyVersion: currentKeyVersion,
			} satisfies EncryptedToken
		})

		const decrypt = Effect.fn("IntegrationEncryption.decrypt")(function* (encrypted: EncryptedToken) {
			// Select key based on version
			let keyData: Redacted.Redacted<string> | undefined
			if (encrypted.keyVersion === currentKeyVersion) {
				keyData = currentKey
			} else if (previousKey && encrypted.keyVersion === previousKeyVersion) {
				keyData = previousKey
			}

			if (!keyData) {
				return yield* Effect.fail(new KeyVersionNotFoundError({ keyVersion: encrypted.keyVersion }))
			}

			const key = yield* importKey(keyData, encrypted.keyVersion)
			const iv = Buffer.from(encrypted.iv, "base64")
			const ciphertext = Buffer.from(encrypted.ciphertext, "base64")

			const plaintext = yield* Effect.tryPromise({
				try: () =>
					crypto.subtle.decrypt(
						{
							name: "AES-GCM",
							iv,
							tagLength: 128,
						},
						key,
						ciphertext,
					),
				catch: (cause) => new IntegrationEncryptionError({ cause, operation: "decrypt" }),
			})

			return new TextDecoder().decode(plaintext)
		})

		return {
			encrypt,
			decrypt,
			currentKeyVersion,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
