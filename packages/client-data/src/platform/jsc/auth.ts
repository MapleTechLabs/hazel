/**
 * What browser sign-in (`@hazel/auth/desktop`) needs in a bare JavaScriptCore context, over the
 * host (`__native.auth`, `HazelUI/Runtime/NativeAuth.swift`): `Digest` and `SecureRandom` in place
 * of the WebCrypto layers (no `crypto.subtle` here), and the system's sign-in sheet.
 */
import { Effect, Layer } from "effect"
import * as Digest from "effect/crypto/Digest"
import * as SecureRandom from "effect/crypto/SecureRandom"
import { nativeBridge } from "./bridge"

const auth = () => {
	const bridge = nativeBridge()
	if (bridge.auth === undefined) throw new Error("@hazel/client-data/jsc: the host has no __native.auth")
	return { auth: bridge.auth, randomBytes: bridge.randomBytes }
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/** SHA-256 on CryptoKit; the algorithms WebCrypto lacks (MD5) run their own TypeScript, as on the web. */
export const DigestJsc = Layer.sync(Digest.Digest, () => {
	const { auth: host } = auth()
	const digest = (algorithm: Digest.Algorithm, data: Uint8Array): Effect.Effect<Uint8Array> =>
		Effect.sync(() => {
			if (algorithm.name === "SHA-256") return host.sha256(data)
			if (algorithm.implementation !== undefined) return algorithm.implementation(data)
			throw new Error(`@hazel/client-data/jsc: no ${algorithm.name} on this host`)
		})
	return { digest, digestHex: (algorithm, data) => Effect.map(digest(algorithm, data), toHex) }
})

/** The system's secure random (`SecRandomCopyBytes`). */
export const SecureRandomJsc = Layer.sync(SecureRandom.SecureRandom, () => {
	const { randomBytes } = auth()
	if (randomBytes === undefined) throw new Error("@hazel/client-data/jsc: the host has no randomBytes")
	return SecureRandom.make(randomBytes)
})

/** The crypto browser sign-in uses, in place of `@yielded/auth/WebCrypto`'s `layer`. */
export const CryptoJsc = Layer.merge(DigestJsc, SecureRandomJsc)

export type SignInSheetError = "cancelled" | "unavailable"

/** Opens the sign-in sheet at `url` and waits for the callback to `callbackScheme`. */
export const openSignInSheet = (url: string, callbackScheme: string, ephemeral: boolean) =>
	Effect.callback<string, SignInSheetError>((resume) => {
		const { auth: host } = auth()
		host.openSignIn(url, callbackScheme, ephemeral, (callbackUrl, error) => {
			if (callbackUrl !== null) resume(Effect.succeed(callbackUrl))
			else resume(Effect.fail(error === "cancelled" ? "cancelled" : "unavailable"))
		})
		// The app stopped waiting (Cancel): the sheet goes too.
		return Effect.sync(() => host.cancelSignIn())
	})
