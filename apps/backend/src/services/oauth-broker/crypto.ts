/**
 * The OAuth broker's cryptography (`docs/self-hosting.md#brokered-integrations`), WebCrypto only so
 * it runs the same on Workers and Node. Every primitive is P-256, SHA-256, HKDF, AES-256-GCM or
 * HMAC-SHA256.
 *
 * Keys:
 * - each customer instance holds an ECDH key (`enc`: tokens are encrypted to it) and an ECDSA key
 *   (`sig`: it signs its OAuth state and its refresh requests); Hazel's registry
 *   (`OAUTH_BROKER_INSTANCES`) holds their public halves;
 * - the broker holds an ECDSA key (`OAUTH_BROKER_SIGNING_KEY`): it signs every sealed payload and
 *   every relayed webhook, and each instance pins its public half (`OAUTH_BROKER_PUBLIC_KEY`);
 * - the broker's HMAC key (`OAUTH_BROKER_STATE_KEY`) signs the state it sends to the provider.
 *
 * Encrypting to an instance's public key alone would let anyone forge a payload, so a sealed payload
 * is encrypt-then-sign: ECDH-ES (an ephemeral key) + HKDF + AES-GCM, with the instance id bound into
 * the key derivation and the AAD, then the whole compact string signed by the broker.
 */
import { Option, Schema } from "effect"

export type Jwk = JsonWebKey

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string =>
	Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url")

const BASE64URL = /^[A-Za-z0-9_-]*$/

/** Bytes of base64url text; `undefined` for anything outside the alphabet. */
export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | undefined =>
	BASE64URL.test(text) ? new Uint8Array(Buffer.from(text, "base64url")) : undefined

const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text) as Uint8Array<ArrayBuffer>

const nowSeconds = () => Math.floor(Date.now() / 1000)

const randomId = () => toBase64Url(crypto.getRandomValues(new Uint8Array(16)))

// ─── Keys ────────────────────────────────────────────────────────────────────

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const

const P256Jwk = Schema.Struct({
	kty: Schema.Literal("EC"),
	crv: Schema.Literal("P-256"),
	x: Schema.String,
	y: Schema.String,
	d: Schema.optional(Schema.String),
})

/** An instance's two public keys, as `OAUTH_BROKER_INSTANCES` lists them. */
export const InstancePublicKey = Schema.Struct({ enc: P256Jwk, sig: P256Jwk })
export type InstancePublicKey = typeof InstancePublicKey.Type

/** An instance's two private keys (`OAUTH_BROKER_PRIVATE_KEY`). */
export const InstancePrivateKey = Schema.Struct({
	enc: P256Jwk.pipe(Schema.check(Schema.makeFilter((jwk) => (jwk.d ? undefined : "not a private key")))),
	sig: P256Jwk.pipe(Schema.check(Schema.makeFilter((jwk) => (jwk.d ? undefined : "not a private key")))),
})
export type InstancePrivateKey = typeof InstancePrivateKey.Type

export const decodeInstancePrivateKey = Schema.decodeUnknownOption(Schema.fromJsonString(InstancePrivateKey))
export const decodeP256Jwk = Schema.decodeUnknownOption(Schema.fromJsonString(P256Jwk))

/** The public half of a P-256 JWK: its curve point and nothing else. */
export const publicOf = (jwk: Jwk): Jwk => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y })

const exportJwk = (key: CryptoKey) => crypto.subtle.exportKey("jwk", key) as Promise<Jwk>

const stripMeta = (jwk: Jwk): Jwk => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d })

/** A fresh instance keypair: the private half for its env file, the public half for Hazel's registry. */
export const generateInstanceKeys = async (): Promise<{
	readonly privateKey: { readonly enc: Jwk; readonly sig: Jwk }
	readonly publicKey: { readonly enc: Jwk; readonly sig: Jwk }
}> => {
	const enc = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])
	const sig = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"])
	const encPrivate = stripMeta(await exportJwk(enc.privateKey))
	const sigPrivate = stripMeta(await exportJwk(sig.privateKey))
	return {
		privateKey: { enc: encPrivate, sig: sigPrivate },
		publicKey: { enc: publicOf(encPrivate), sig: publicOf(sigPrivate) },
	}
}

/** A fresh broker signing key (`OAUTH_BROKER_SIGNING_KEY`) and its public half. */
export const generateBrokerSigningKey = async (): Promise<{
	readonly privateKey: Jwk
	readonly publicKey: Jwk
}> => {
	const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"])
	const privateKey = stripMeta(await exportJwk(pair.privateKey))
	return { privateKey, publicKey: publicOf(privateKey) }
}

/** 32 random bytes, base64url: `OAUTH_BROKER_STATE_KEY`. */
export const generateStateKey = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

const importSigner = (jwk: Jwk) => crypto.subtle.importKey("jwk", stripMeta(jwk), ECDSA, false, ["sign"])
const importVerifier = (jwk: Jwk) => crypto.subtle.importKey("jwk", publicOf(jwk), ECDSA, false, ["verify"])

/** ECDSA P-256 / SHA-256 over `data`, base64url (raw r‖s). */
export const sign = async (privateJwk: Jwk, data: string): Promise<string> =>
	toBase64Url(await crypto.subtle.sign(ECDSA_SIGN, await importSigner(privateJwk), utf8(data)))

/** Whether `signature` is `publicJwk`'s over `data`; any malformed input is a `false`. */
export const verify = async (publicJwk: Jwk, data: string, signature: string): Promise<boolean> => {
	const bytes = fromBase64Url(signature)
	if (!bytes || bytes.length !== 64) return false
	try {
		return await crypto.subtle.verify(ECDSA_SIGN, await importVerifier(publicJwk), bytes, utf8(data))
	} catch {
		return false
	}
}

const importHmac = (keyBase64Url: string) => {
	const raw = fromBase64Url(keyBase64Url)
	if (!raw || raw.length < 32) throw new Error("The HMAC key must be at least 32 bytes of base64url")
	return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

const hmac = async (keyBase64Url: string, data: string) =>
	toBase64Url(await crypto.subtle.sign("HMAC", await importHmac(keyBase64Url), utf8(data)))

/** Constant-time (WebCrypto's `verify`). */
const hmacVerify = async (keyBase64Url: string, data: string, signature: string) => {
	const bytes = fromBase64Url(signature)
	if (!bytes || bytes.length !== 32) return false
	return crypto.subtle.verify("HMAC", await importHmac(keyBase64Url), bytes, utf8(data))
}

/** The UTF-8 text of a base64url part; empty for anything outside the alphabet. */
const textPart = (part: string): string => {
	const bytes = fromBase64Url(part)
	return bytes ? decoder.decode(bytes) : ""
}

export type Verified<A> =
	| { readonly ok: true; readonly value: A }
	| { readonly ok: false; readonly reason: string }

const refuse = <A>(reason: string): Verified<A> => ({ ok: false, reason })

/** Room for clock skew between the broker and an instance. */
const SKEW_SECONDS = 60

// ─── Sealed payloads (broker → instance) ─────────────────────────────────────

const SEAL_ALG = "ECDH-ES+HKDF-SHA256+A256GCM"
const SEAL_INFO = "hazel-oauth-broker/v1"
const MAX_SEALED_LENGTH = 64 * 1024

export const SealedKind = Schema.Literals(["connect", "refresh"])
export type SealedKind = typeof SealedKind.Type

const SealedHeader = Schema.Struct({
	v: Schema.Literal(1),
	alg: Schema.Literal(SEAL_ALG),
	kid: Schema.String,
	epk: P256Jwk,
})

const SealedClaims = Schema.Struct({
	iss: Schema.Literal("hazel-oauth-broker"),
	/** The instance the payload is for. */
	aud: Schema.String,
	provider: Schema.String,
	kind: SealedKind,
	iat: Schema.Finite,
	exp: Schema.Finite,
	/** The instance's own signed OAuth state (`connect` only). */
	state: Schema.optional(Schema.String),
	data: Schema.Unknown,
})
export type SealedClaims = typeof SealedClaims.Type

const decodeSealedHeader = Schema.decodeUnknownOption(Schema.fromJsonString(SealedHeader))
const decodeSealedClaims = Schema.decodeUnknownOption(Schema.fromJsonString(SealedClaims))

const sealKey = async (sharedSecret: ArrayBuffer, instanceId: string, usage: "encrypt" | "decrypt") => {
	const ikm = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"])
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(`${SEAL_INFO}|${instanceId}`) },
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		[usage],
	)
}

/** How long a sealed payload may be opened after the broker made it. */
export const SEALED_TTL_SECONDS = 5 * 60

/**
 * Encrypts `claims` to the instance's `enc` key and signs the result with the broker's key:
 * `header.iv.ciphertext.signature`, each part base64url.
 */
export const seal = async (input: {
	readonly instanceId: string
	readonly instanceEncKey: Jwk
	readonly brokerSigningKey: Jwk
	readonly provider: string
	readonly kind: SealedKind
	readonly state?: string | undefined
	readonly data: unknown
	readonly now?: number
	readonly ttlSeconds?: number
}): Promise<string> => {
	const iat = input.now ?? nowSeconds()
	const claims: SealedClaims = {
		iss: "hazel-oauth-broker",
		aud: input.instanceId,
		provider: input.provider,
		kind: input.kind,
		iat,
		exp: iat + (input.ttlSeconds ?? SEALED_TTL_SECONDS),
		state: input.state,
		data: input.data,
	}
	const ephemeral = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])
	const recipient = await crypto.subtle.importKey("jwk", publicOf(input.instanceEncKey), ECDH, false, [])
	const shared = await crypto.subtle.deriveBits(
		{ name: "ECDH", public: recipient },
		ephemeral.privateKey,
		256,
	)
	const header = {
		v: 1,
		alg: SEAL_ALG,
		kid: input.instanceId,
		epk: publicOf(await exportJwk(ephemeral.publicKey)),
	}
	const headerPart = toBase64Url(utf8(JSON.stringify(header)))
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: utf8(headerPart) },
		await sealKey(shared, input.instanceId, "encrypt"),
		utf8(JSON.stringify(claims)),
	)
	const compact = `${headerPart}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`
	return `${compact}.${await sign(input.brokerSigningKey, compact)}`
}

/**
 * Opens a sealed payload: the broker's signature first, then the instance it is for, the decryption,
 * its kind, provider and expiry. Every refusal names why, never echoing the payload.
 */
export const open = async (input: {
	readonly sealed: string
	readonly instanceId: string
	readonly instancePrivateEncKey: Jwk
	readonly brokerPublicKey: Jwk
	readonly provider: string
	readonly kind: SealedKind
	readonly now?: number
}): Promise<Verified<SealedClaims>> => {
	if (input.sealed.length > MAX_SEALED_LENGTH) return refuse("too large")
	const parts = input.sealed.split(".")
	if (parts.length !== 4) return refuse("malformed")
	const [headerPart, ivPart, ciphertextPart, signature] = parts as [string, string, string, string]
	const compact = `${headerPart}.${ivPart}.${ciphertextPart}`
	if (!(await verify(input.brokerPublicKey, compact, signature))) return refuse("bad signature")
	const header = decodeSealedHeader(textPart(headerPart))
	if (Option.isNone(header)) return refuse("malformed header")
	if (header.value.kid !== input.instanceId) return refuse("for another instance")
	const iv = fromBase64Url(ivPart)
	const ciphertext = fromBase64Url(ciphertextPart)
	if (!iv || iv.length !== 12 || !ciphertext) return refuse("malformed")
	let plaintext: ArrayBuffer
	try {
		const ephemeral = await crypto.subtle.importKey("jwk", publicOf(header.value.epk), ECDH, false, [])
		const own = await crypto.subtle.importKey(
			"jwk",
			stripMeta(input.instancePrivateEncKey),
			ECDH,
			false,
			["deriveBits"],
		)
		const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: ephemeral }, own, 256)
		plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv, additionalData: utf8(headerPart) },
			await sealKey(shared, input.instanceId, "decrypt"),
			ciphertext,
		)
	} catch {
		return refuse("cannot decrypt")
	}
	const claims = decodeSealedClaims(decoder.decode(plaintext))
	if (Option.isNone(claims)) return refuse("malformed claims")
	const now = input.now ?? nowSeconds()
	if (claims.value.aud !== input.instanceId) return refuse("for another instance")
	if (claims.value.kind !== input.kind) return refuse("wrong kind")
	if (claims.value.provider !== input.provider) return refuse("wrong provider")
	if (claims.value.exp < now) return refuse("expired")
	if (claims.value.iat > now + SKEW_SECONDS) return refuse("issued in the future")
	return { ok: true, value: claims.value }
}

// ─── The instance's OAuth state (instance → broker → instance) ───────────────

export const ConnectionLevel = Schema.Literals(["organization", "user"])

const CustomerState = Schema.Struct({
	v: Schema.Literal(1),
	instance: Schema.String,
	provider: Schema.String,
	exp: Schema.Finite,
	nonce: Schema.String,
	organizationId: Schema.String,
	userId: Schema.String,
	level: ConnectionLevel,
	returnTo: Schema.String,
})
export type CustomerState = typeof CustomerState.Type
const decodeCustomerState = Schema.decodeUnknownOption(Schema.fromJsonString(CustomerState))

/** How long a user has between starting a brokered connection and finishing it. */
export const STATE_TTL_SECONDS = 15 * 60
const MAX_STATE_LENGTH = 4096

/** The instance signs its state, so neither the broker nor anyone else can start a flow in its name. */
export const signCustomerState = async (
	instanceSigningKey: Jwk,
	state: Omit<CustomerState, "v" | "exp" | "nonce">,
	now = nowSeconds(),
): Promise<string> => {
	const body = toBase64Url(
		utf8(JSON.stringify({ v: 1, ...state, exp: now + STATE_TTL_SECONDS, nonce: randomId() })),
	)
	return `${body}.${await sign(instanceSigningKey, `hazel-oauth-state.${body}`)}`
}

/** Checked by the broker at the start (with the registry's key) and by the instance at the end. */
export const verifyCustomerState = async (
	instanceSigningPublicKey: Jwk,
	token: string,
	expect: { readonly instanceId: string; readonly provider: string; readonly now?: number },
): Promise<Verified<CustomerState>> => {
	if (token.length > MAX_STATE_LENGTH) return refuse("too large")
	const parts = token.split(".")
	if (parts.length !== 2) return refuse("malformed")
	const [body, signature] = parts as [string, string]
	if (!(await verify(instanceSigningPublicKey, `hazel-oauth-state.${body}`, signature))) {
		return refuse("bad signature")
	}
	const state = decodeCustomerState(textPart(body))
	if (Option.isNone(state)) return refuse("malformed")
	if (state.value.instance !== expect.instanceId) return refuse("for another instance")
	if (state.value.provider !== expect.provider) return refuse("wrong provider")
	if (state.value.exp < (expect.now ?? nowSeconds())) return refuse("expired")
	return { ok: true, value: state.value }
}

// ─── The broker's state (broker → provider → broker) ─────────────────────────

/** Marks a provider callback that belongs to the broker, not to the install's own flow. */
export const BROKER_STATE_PREFIX = "hzb1."

const BrokerState = Schema.Struct({
	/** The instance id. */
	i: Schema.String,
	/** The provider. */
	p: Schema.String,
	/** The instance's own signed state, handed back to it. */
	s: Schema.String,
	l: ConnectionLevel,
	iat: Schema.Finite,
	exp: Schema.Finite,
	n: Schema.String,
})
export type BrokerState = typeof BrokerState.Type
const decodeBrokerState = Schema.decodeUnknownOption(Schema.fromJsonString(BrokerState))

export const isBrokerState = (state: string | undefined): state is string =>
	state?.startsWith(BROKER_STATE_PREFIX) ?? false

export const signBrokerState = async (
	stateKey: string,
	state: Omit<BrokerState, "iat" | "exp" | "n">,
	now = nowSeconds(),
): Promise<string> => {
	const body = toBase64Url(
		utf8(JSON.stringify({ ...state, iat: now, exp: now + STATE_TTL_SECONDS, n: randomId() })),
	)
	return `${BROKER_STATE_PREFIX}${body}.${await hmac(stateKey, `hazel-broker-state.${body}`)}`
}

export const verifyBrokerState = async (
	stateKey: string,
	token: string,
	expect: { readonly provider: string; readonly now?: number },
): Promise<Verified<BrokerState>> => {
	if (!isBrokerState(token) || token.length > MAX_STATE_LENGTH * 2) return refuse("malformed")
	const parts = token.slice(BROKER_STATE_PREFIX.length).split(".")
	if (parts.length !== 2) return refuse("malformed")
	const [body, signature] = parts as [string, string]
	if (!(await hmacVerify(stateKey, `hazel-broker-state.${body}`, signature))) return refuse("bad signature")
	const state = decodeBrokerState(textPart(body))
	if (Option.isNone(state)) return refuse("malformed")
	if (state.value.p !== expect.provider) return refuse("wrong provider")
	if (state.value.exp < (expect.now ?? nowSeconds())) return refuse("expired")
	return { ok: true, value: state.value }
}

// ─── Signed requests (relayed webhooks, refresh requests) ────────────────────

/** How far a signed request's timestamp may be from now, either way. */
export const REQUEST_WINDOW_SECONDS = 5 * 60

/** What the broker signs on a relayed webhook: its provider, instance, time, headers and raw body. */
export const relaySigningInput = (input: {
	readonly provider: string
	readonly instanceId: string
	readonly timestamp: string
	readonly event: string
	readonly delivery: string
	readonly body: string
}) =>
	[
		"hazel-broker-relay/v1",
		input.provider,
		input.instanceId,
		input.timestamp,
		input.event,
		input.delivery,
		input.body,
	].join("\n")

/** What an instance signs on a refresh request. */
export const refreshSigningInput = (input: {
	readonly provider: string
	readonly instanceId: string
	readonly timestamp: string
	readonly body: string
}) => ["hazel-broker-refresh/v1", input.provider, input.instanceId, input.timestamp, input.body].join("\n")

/** Whether a signed request's `timestamp` (seconds) is within the window of now. */
export const isFresh = (timestamp: string | undefined, now = nowSeconds()): boolean => {
	if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false
	return Math.abs(now - Number(timestamp)) <= REQUEST_WINDOW_SECONDS
}

export const currentTimestamp = () => String(nowSeconds())
