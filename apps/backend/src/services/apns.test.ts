import { ConfigProvider, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { HttpClientRequest } from "effect/http"
import { describe, expect, it } from "vitest"
import { ApnsClient, type ApnsNotification, importApnsKey, pkcs8Of, signProviderToken } from "./apns"

const decoder = new TextDecoder()

const fromBase64Url = (value: string) =>
	Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))

const json = (part: string) => JSON.parse(decoder.decode(fromBase64Url(part)))

const generateKey = async () => {
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))
	const base64 = btoa(String.fromCharCode(...pkcs8))
	const pem = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`
	return { pair, base64, pem }
}

const notification: ApnsNotification = {
	environment: "development",
	token: "ab".repeat(32),
	topic: "app.hazel.ios",
	expiration: 1_900_000_000,
	payload: {
		aps: {
			alert: { title: "Ada · #general", body: "hi" },
			sound: "default",
			badge: 2,
			"thread-id": "c-1",
		},
		hazel: { path: "/acme/chat/c-1", channelId: "c-1", notificationId: "n-1" },
	},
}

describe("APNs provider token", () => {
	it("signs an ES256 JWT the public key verifies", async () => {
		const { pair, pem } = await generateKey()
		const key = await importApnsKey(pem)
		const token = await signProviderToken({
			key,
			keyId: "KEY123",
			teamId: "TEAM456",
			nowMs: 1_800_000_000_500,
		})
		const [header, claims, signature] = token.split(".")
		expect(json(header!)).toEqual({ alg: "ES256", kid: "KEY123" })
		expect(json(claims!)).toEqual({ iss: "TEAM456", iat: 1_800_000_000 })
		const raw = fromBase64Url(signature!)
		// JWS ES256: the raw r || s, 64 bytes.
		expect(raw.length).toBe(64)
		const valid = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			pair.publicKey,
			raw,
			new TextEncoder().encode(`${header}.${claims}`),
		)
		expect(valid).toBe(true)
	})

	it("reads the key as PEM, PEM with escaped newlines, or bare base64", async () => {
		const { base64, pem } = await generateKey()
		const bytes = pkcs8Of(base64)
		expect(pkcs8Of(pem)).toEqual(bytes)
		expect(pkcs8Of(pem.replace(/\n/g, "\\n"))).toEqual(bytes)
	})
})

describe("ApnsClient", () => {
	const clientWith = async (answer: (request: HttpClientRequest.HttpClientRequest) => Response) => {
		const { pem } = await generateKey()
		const requests: Array<HttpClientRequest.HttpClientRequest> = []
		const http = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.sync(() => {
					requests.push(request)
					return HttpClientResponse.fromWeb(request, answer(request))
				}),
			),
		)
		const config = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				APNS_KEY_ID: "KEY123",
				APNS_TEAM_ID: `TEAM-${crypto.randomUUID()}`,
				APNS_PRIVATE_KEY: pem,
			}),
		)
		const layer = ApnsClient.layer.pipe(Layer.provide(Layer.mergeAll(http, config)))
		return { layer, requests }
	}

	it("posts to the environment's host with the APNs headers, reusing one provider token", async () => {
		const { layer, requests } = await clientWith(() => new Response(null, { status: 200 }))
		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const apns = yield* ApnsClient
				expect(apns.enabled).toBe(true)
				const first = yield* apns.send(notification)
				const second = yield* apns.send({ ...notification, environment: "production" })
				return [first, second]
			}).pipe(Effect.provide(layer)),
		)
		expect(results).toEqual([
			{ status: 200, reason: null },
			{ status: 200, reason: null },
		])
		expect(requests.map((request) => request.url)).toEqual([
			`https://api.sandbox.push.apple.com/3/device/${notification.token}`,
			`https://api.push.apple.com/3/device/${notification.token}`,
		])
		const headers = requests[0]!.headers
		expect(headers["apns-topic"]).toBe("app.hazel.ios")
		expect(headers["apns-push-type"]).toBe("alert")
		expect(headers["apns-priority"]).toBe("10")
		expect(headers["apns-expiration"]).toBe("1900000000")
		expect(headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/)
		expect(requests[1]!.headers.authorization).toBe(headers.authorization)
		const body = requests[0]!.body
		expect(body._tag).toBe("Uint8Array")
		if (body._tag === "Uint8Array") {
			expect(JSON.parse(decoder.decode(body.body))).toEqual(notification.payload)
		}
	})

	it("reads the reason of a refusal", async () => {
		const { layer } = await clientWith(
			() => new Response(JSON.stringify({ reason: "Unregistered", timestamp: 1 }), { status: 410 }),
		)
		const result = await Effect.runPromise(
			ApnsClient.use((apns) => apns.send(notification)).pipe(Effect.provide(layer)),
		)
		expect(result).toEqual({ status: 410, reason: "Unregistered" })
	})

	it("is off without config", async () => {
		const enabled = await Effect.runPromise(
			ApnsClient.use((apns) => Effect.succeed(apns.enabled)).pipe(
				Effect.provide(
					ApnsClient.layer.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(
									HttpClient.HttpClient,
									HttpClient.make(() => Effect.die("no request expected")),
								),
								ConfigProvider.layer(ConfigProvider.fromUnknown({})),
							),
						),
					),
				),
			),
		)
		expect(enabled).toBe(false)
	})
})
