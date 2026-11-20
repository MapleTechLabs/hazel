import { describe, expect, it } from "@effect/vitest"
import { createPrivateKey, generateKeyPairSync, verify } from "node:crypto"
import { signingKeyOf, type PrivateKeySource } from "./jwt-service"

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const

const notImplemented = () => {
	throw Object.assign(new Error("The toCryptoKey method is not implemented"), {
		code: "ERR_METHOD_NOT_IMPLEMENTED",
	})
}

describe("signingKeyOf", () => {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
	const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString()
	const signsVerifiably = async (key: CryptoKey) => {
		const data = new TextEncoder().encode("header.payload")
		const signature = new Uint8Array(await crypto.subtle.sign(RS256.name, key, data))
		return verify("RSA-SHA256", data, publicKey, signature)
	}

	it("converts a Node KeyObject directly", async () => {
		expect(await signsVerifiably(await signingKeyOf(createPrivateKey(pem)))).toBe(true)
	})

	it("takes the JWK path when toCryptoKey is not implemented (workerd)", async () => {
		const keyObject = createPrivateKey(pem)
		const workerdKey: PrivateKeySource = {
			toCryptoKey: notImplemented,
			export: (options) => keyObject.export(options),
		}
		expect(await signsVerifiably(await signingKeyOf(workerdKey))).toBe(true)
	})

	it("rethrows any other conversion failure", async () => {
		const keyObject = createPrivateKey(pem)
		const broken: PrivateKeySource = {
			toCryptoKey: () => {
				throw new TypeError("bad algorithm")
			},
			export: (options) => keyObject.export(options),
		}
		await expect(signingKeyOf(broken)).rejects.toThrow("bad algorithm")
	})
})
