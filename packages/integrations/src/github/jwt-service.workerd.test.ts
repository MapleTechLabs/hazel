import { describe, expect, it } from "@effect/vitest"
import * as nodeCrypto from "node:crypto"
import { Effect } from "effect"
import { vi } from "vitest"
import { generateAppJWT } from "./jwt-service"

// workerd's KeyObject has a `toCryptoKey` that throws ERR_METHOD_NOT_IMPLEMENTED.
vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof nodeCrypto>()
	return {
		...actual,
		createPrivateKey: (key: string) => {
			const keyObject = actual.createPrivateKey(key)
			Object.defineProperty(keyObject, "toCryptoKey", {
				value: () => {
					throw Object.assign(new Error("The toCryptoKey method is not implemented"), {
						code: "ERR_METHOD_NOT_IMPLEMENTED",
					})
				},
			})
			return keyObject
		},
	}
})

describe("generateAppJWT on workerd", () => {
	it.effect("signs through the JWK when toCryptoKey is not implemented", () =>
		Effect.gen(function* () {
			const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
			const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString()
			const [header, payload, signature] = (yield* generateAppJWT("7", pem)).split(".")
			expect(
				nodeCrypto.verify(
					"RSA-SHA256",
					Buffer.from(`${header}.${payload}`),
					publicKey,
					Buffer.from(signature ?? "", "base64url"),
				),
			).toBe(true)
		}),
	)
})
