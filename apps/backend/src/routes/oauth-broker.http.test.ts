/**
 * The OAuth broker end to end, on in-memory fakes: a broker (Hazel's install) and an instance (a
 * customer install) with their own config, a fake provider token endpoint behind `fetch`, a fake
 * directory and a fake org object.
 */
import { GitHub, Slack } from "@hazel/integrations"
import { OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientResponse, HttpServerRequest, HttpServerResponse } from "effect/http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatSyncInstallations } from "../services/chat-sync/chat-sync-installations"
import { Directory } from "../services/directory"
import { OAuthProviderRegistry } from "../services/oauth"
import { createLinearOAuthProvider } from "../services/oauth/providers/linear-oauth-provider"
import {
	handleBrokerProviderCallback,
	handleBrokerRefresh,
	relayToInstance,
} from "../services/oauth-broker/broker"
import { refreshViaBroker, verifyRelay } from "../services/oauth-broker/client"
import type { BrokerClientConfig } from "../services/oauth-broker/config"
import {
	currentTimestamp,
	generateBrokerSigningKey,
	generateInstanceKeys,
	generateStateKey,
	open,
	refreshSigningInput,
	relaySigningInput,
	sign,
} from "../services/oauth-broker/crypto"
import { BROKER_HEADERS } from "../services/oauth-broker/protocol"
import { exitCodec } from "../worker/objects/calls"
import { ConnectIntegrationCall } from "../worker/objects/org/integrations"
import { ObjectStubs } from "../worker/objects/protocol"
import { handleBrokerCallbackRoute, handleBrokeredWebhookRoute, handleStartRoute } from "./oauth-broker.http"

const brokerKey = await generateBrokerSigningKey()
const acme = await generateInstanceKeys()
const stateKey = generateStateKey()
const FRONTEND = "https://app.acme.test"
const ACME_API = "https://api.acme.test"
const ORG = OrganizationId.make("0b9c4f0e-9b64-4c1f-a8a3-6f3f6b0f0a01")
const USER = UserId.make("5f0a5b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b")

const brokerEnv = {
	OAUTH_BROKER_ENABLED: "true",
	OAUTH_BROKER_STATE_KEY: stateKey,
	OAUTH_BROKER_SIGNING_KEY: JSON.stringify(brokerKey.privateKey),
	OAUTH_BROKER_INSTANCES: JSON.stringify([{ id: "acme", apiUrl: ACME_API, publicKey: acme.publicKey }]),
	API_BASE_URL: "https://api.hazel.test",
	LINEAR_CLIENT_ID: "hazel-linear-id",
	LINEAR_CLIENT_SECRET: "hazel-linear-secret",
}

const instanceEnv = {
	FRONTEND_URL: FRONTEND,
	OAUTH_BROKER_URL: "https://api.hazel.test",
	OAUTH_BROKER_INSTANCE_ID: "acme",
	OAUTH_BROKER_PRIVATE_KEY: JSON.stringify(acme.privateKey),
	OAUTH_BROKER_PUBLIC_KEY: JSON.stringify(brokerKey.publicKey),
}

const client: BrokerClientConfig = {
	brokerUrl: "https://api.hazel.test",
	instanceId: "acme",
	privateKey: acme.privateKey as BrokerClientConfig["privateKey"],
	brokerPublicKey: brokerKey.publicKey,
}

// ─── Fakes ───────────────────────────────────────────────────────────────────

/** The provider's token endpoint, behind `fetch`. */
const tokenRequests: Array<URLSearchParams> = []
/** The broker, when a test puts it behind `fetch`. */
let brokerFetch: ((request: Request) => Promise<Response>) | undefined
beforeEach(() => {
	tokenRequests.length = 0
	brokerFetch = undefined
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		if (brokerFetch && url.origin === "https://api.hazel.test") {
			return brokerFetch(input instanceof Request ? input : new Request(url, init))
		}
		if (url.href === "https://api.linear.app/oauth/token") {
			const body =
				input instanceof Request
					? await input.text()
					: new TextDecoder().decode(init?.body as Uint8Array)
			const params = new URLSearchParams(body)
			tokenRequests.push(params)
			if (params.get("code") === "bad-code" || params.get("refresh_token") === "revoked") {
				return new Response('{"error":"invalid_grant"}', { status: 400 })
			}
			return Response.json({
				access_token: params.get("grant_type") === "refresh_token" ? "lin-refreshed" : "lin-access",
				refresh_token: "lin-refresh",
				expires_in: 3600,
				scope: "read,write",
				token_type: "Bearer",
			})
		}
		return new Response("not found", { status: 404 })
	})
})
afterEach(() => vi.unstubAllGlobals())

const linearProvider = createLinearOAuthProvider({
	provider: "linear",
	clientId: "hazel-linear-id",
	clientSecret: Redacted.make("hazel-linear-secret"),
	redirectUri: "https://api.hazel.test/integrations/linear/callback",
	authorizationUrl: "https://linear.app/oauth/authorize",
	tokenUrl: "https://api.linear.app/oauth/token",
	scopes: ["read", "write"],
	scopeDelimiter: ",",
})

const registry = Layer.succeed(OAuthProviderRegistry, {
	getProvider: () => Effect.succeed(linearProvider),
	getAccountInfoReader: () =>
		Option.some(() =>
			Effect.succeed({ externalAccountId: "lin-org", externalAccountName: "Acme Linear" }),
		),
} as never)

const makeDirectory = (routes: Map<string, string> = new Map()) =>
	Layer.succeed(Directory, {
		brokerRoute: (provider: string, externalId: string) =>
			Effect.succeed(
				Option.fromNullishOr(routes.get(`${provider}:${externalId}`)).pipe(
					Option.map((instanceId) => ({ provider, externalId, instanceId, createdAt: new Date() })),
				),
			),
		upsertBrokerRoute: (row: { provider: string; externalId: string; instanceId: string }) =>
			Effect.sync(() => void routes.set(`${row.provider}:${row.externalId}`, row.instanceId)),
		integration: () => Effect.succeed(Option.none()),
	} as never)

const github = Layer.succeed(GitHub.GitHubAppJWTService, {
	isConfigured: true,
	getInstallationToken: (id: string) =>
		Effect.succeed({ token: `ghs-${id}`, expiresAt: new Date(Date.now() + 3_600_000) }),
	getInstallation: () => Effect.succeed({ createdAt: new Date(), updatedAt: new Date() }),
	buildInstallationUrl: () => Effect.die("unused"),
} as never)

/** The org object: records what `ConnectIntegrationCall` carried. */
const makeOrgObject = () => {
	const calls: Array<unknown> = []
	const encode = Schema.encodeSync(exitCodec(ConnectIntegrationCall) as never)
	const decodePayload = Schema.decodeUnknownSync(
		Schema.toCodecJson(ConnectIntegrationCall.payload) as never,
	)
	const layer = Layer.succeed(ObjectStubs, {
		get: () =>
			({
				call: (request: { payload: unknown }) => {
					calls.push(decodePayload(request.payload))
					return Effect.succeed({
						exit: encode(
							Exit.succeed({
								connectionId: "7d1f3a52-0d6e-4b8e-9f4c-2a6b8c0d1e2f",
								botInstalled: false,
							}) as never,
						),
					})
				},
			}) as never,
	})
	return { calls, layer }
}

const chatSync = Layer.succeed(ChatSyncInstallations, { save: () => Effect.void } as never)

const config = (env: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromUnknown(env))

const asRequest = (request: Request) =>
	Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request))

/** Runs `effect` with `layer`, which must provide everything it needs. */
const run = <A, E, ROut, LE>(
	effect: Effect.Effect<A, E, NoInfer<ROut>>,
	layer: Layer.Layer<ROut, LE, never>,
) => Effect.runPromise(Effect.provide(effect, layer))

const toWeb = (response: HttpServerResponse.HttpServerResponse) => HttpServerResponse.toWeb(response)

/** The hidden fields of the broker's hand-back page. */
const fieldsOf = async (response: HttpServerResponse.HttpServerResponse) => {
	const html = await toWeb(response).text()
	const fields: Record<string, string> = {}
	for (const match of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
		fields[match[1] ?? ""] = (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&")
	}
	return { html, fields }
}

const signedState = async () => {
	const { brokerAuthorizationUrl } = await import("../services/oauth-broker/client")
	const url = new URL(
		await brokerAuthorizationUrl(client, "linear", {
			organizationId: ORG,
			userId: USER,
			level: "organization",
			returnTo: `${FRONTEND}/acme/settings/integrations/linear`,
		}),
	)
	return url
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("broker start", () => {
	const brokerLayer = Layer.mergeAll(registry, config(brokerEnv))

	it("sends a registered instance's user to the provider with Hazel's app and a broker state", async () => {
		const startUrl = await signedState()
		expect(startUrl.pathname).toBe("/oauth-broker/linear/start")
		const response = await run(
			handleStartRoute.pipe(
				asRequest(new Request(`https://api.hazel.test${startUrl.pathname}${startUrl.search}`)),
			),
			brokerLayer,
		)
		const web = toWeb(response)
		expect(web.status).toBe(302)
		const location = new URL(web.headers.get("location") ?? "")
		expect(location.origin).toBe("https://linear.app")
		expect(location.searchParams.get("client_id")).toBe("hazel-linear-id")
		expect(location.searchParams.get("redirect_uri")).toBe(
			"https://api.hazel.test/integrations/linear/callback",
		)
		expect(location.searchParams.get("state")?.startsWith("hzb1.")).toBe(true)
	})

	it("refuses an unknown instance, a state it did not sign, or a broker that is off", async () => {
		const startUrl = await signedState()
		const unknown = new URL(startUrl)
		unknown.searchParams.set("instance", "globex")
		const forged = new URL(startUrl)
		forged.searchParams.set(
			"state",
			`${startUrl.searchParams.get("state")?.split(".")[0]}.${"A".repeat(86)}`,
		)
		for (const url of [unknown, forged]) {
			const response = await run(handleStartRoute.pipe(asRequest(new Request(url))), brokerLayer)
			expect(toWeb(response).status).toBe(400)
		}
		const off = await run(
			handleStartRoute.pipe(asRequest(new Request(startUrl))),
			Layer.mergeAll(registry, config({})),
		)
		expect(toWeb(off).status).toBe(404)
	})
})

describe("broker callback → instance", () => {
	const startAndCallback = async (code: string) => {
		const routes = new Map<string, string>()
		const brokerLayer = Layer.mergeAll(registry, makeDirectory(routes), github, config(brokerEnv))
		const startUrl = await signedState()
		const started = toWeb(await run(handleStartRoute.pipe(asRequest(new Request(startUrl))), brokerLayer))
		const brokerState = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? ""
		const handBack = await run(
			handleBrokerProviderCallback("linear", { state: brokerState, code, installationId: undefined }),
			brokerLayer,
		)
		return { handBack, brokerState }
	}

	const postToInstance = async (fields: Record<string, string>) => {
		const org = makeOrgObject()
		const response = await run(
			handleBrokerCallbackRoute.pipe(
				asRequest(
					new Request(`${ACME_API}/integrations/linear/broker-callback`, {
						method: "POST",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams(fields).toString(),
					}),
				),
			),
			Layer.mergeAll(registry, org.layer, chatSync, config(instanceEnv)),
		)
		return { web: toWeb(response), calls: org.calls }
	}

	it("exchanges the code with Hazel's credentials and hands sealed tokens to the instance, which saves them", async () => {
		const { handBack } = await startAndCallback("good-code")
		expect(tokenRequests[0]?.get("client_secret")).toBe("hazel-linear-secret")
		expect(tokenRequests[0]?.get("redirect_uri")).toBe(
			"https://api.hazel.test/integrations/linear/callback",
		)
		const { html, fields } = await fieldsOf(handBack)
		expect(html).toContain(`action="${ACME_API}/integrations/linear/broker-callback"`)
		expect(html).not.toContain("lin-access")
		expect(toWeb(handBack).headers.get("content-security-policy")).toContain(`form-action ${ACME_API}`)
		expect(fields.payload).toBeDefined()

		const { web, calls } = await postToInstance({ payload: fields.payload ?? "" })
		expect(web.status).toBe(303)
		const location = new URL(web.headers.get("location") ?? "")
		expect(location.href.startsWith(`${FRONTEND}/acme/settings/integrations/linear`)).toBe(true)
		expect(location.searchParams.get("connection_status")).toBe("success")
		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({
			provider: "linear",
			connectedBy: USER,
			externalAccountId: "lin-org",
			metadata: { brokered: true },
			tokens: { accessToken: "lin-access", refreshToken: "lin-refresh", scope: "read,write" },
		})
	})

	it("hands a failed exchange back as an error the instance shows where the user started", async () => {
		const { handBack } = await startAndCallback("bad-code")
		const { fields } = await fieldsOf(handBack)
		expect(fields.payload).toBeUndefined()
		expect(fields.error).toBe("token_exchange_failed")
		const { web, calls } = await postToInstance(fields)
		const location = new URL(web.headers.get("location") ?? "")
		expect(location.href.startsWith(`${FRONTEND}/acme/settings/integrations/linear`)).toBe(true)
		expect(location.searchParams.get("error_code")).toBe("token_exchange_failed")
		expect(calls).toHaveLength(0)
	})

	it("refuses a tampered payload, and a broker state that was not the broker's", async () => {
		const { handBack, brokerState } = await startAndCallback("good-code")
		const { fields } = await fieldsOf(handBack)
		const parts = (fields.payload ?? "").split(".")
		parts[2] = `${parts[2]?.slice(0, -2)}AA`
		const { web, calls } = await postToInstance({ payload: parts.join(".") })
		expect(new URL(web.headers.get("location") ?? "").searchParams.get("error_code")).toBe(
			"invalid_state",
		)
		expect(calls).toHaveLength(0)

		const forged = `${brokerState.slice(0, -4)}AAAA`
		const refused = await run(
			handleBrokerProviderCallback("linear", {
				state: forged,
				code: "good-code",
				installationId: undefined,
			}),
			Layer.mergeAll(registry, makeDirectory(), github, config(brokerEnv)),
		)
		expect(toWeb(refused).status).toBe(400)
	})
})

describe("GitHub installations through the broker", () => {
	it("records the installation's route, and refuses one another instance holds", async () => {
		const routes = new Map<string, string>()
		const githubProvider = {
			provider: "github",
			config: { provider: "github" },
			buildAuthorizationUrl: (state: string) =>
				Effect.succeed(
					new URL(`https://github.com/apps/hazel/installations/select_target?state=${state}`),
				),
			exchangeCodeForTokens: (id: string) =>
				Effect.succeed({
					accessToken: `ghs-${id}`,
					tokenType: "Bearer",
					expiresAt: new Date(Date.now() + 3_600_000),
				}),
			getAccountInfo: () => Effect.die("unused"),
		}
		const githubRegistry = Layer.succeed(OAuthProviderRegistry, {
			getProvider: () => Effect.succeed(githubProvider),
		} as never)
		const layer = Layer.mergeAll(githubRegistry, makeDirectory(routes), github, config(brokerEnv))
		const { signBrokerState, signCustomerState } = await import("../services/oauth-broker/crypto")
		const customerState = await signCustomerState(acme.privateKey.sig, {
			instance: "acme",
			provider: "github",
			organizationId: ORG,
			userId: USER,
			level: "organization",
			returnTo: `${FRONTEND}/acme/settings/integrations/github`,
		})
		const state = await signBrokerState(stateKey, {
			i: "acme",
			p: "github",
			s: customerState,
			l: "organization",
		})

		const handBack = await run(
			handleBrokerProviderCallback("github", { state, code: undefined, installationId: "42" }),
			layer,
		)
		const { fields } = await fieldsOf(handBack)
		expect(routes.get("github:42")).toBe("acme")
		const opened = await open({
			sealed: fields.payload ?? "",
			instanceId: "acme",
			instancePrivateEncKey: acme.privateKey.enc,
			brokerPublicKey: brokerKey.publicKey,
			provider: "github",
			kind: "connect",
		})
		expect(opened).toMatchObject({
			ok: true,
			value: { data: { installationId: "42", tokens: { accessToken: "ghs-42" } } },
		})

		routes.set("github:43", "globex")
		const claimed = await fieldsOf(
			await run(
				handleBrokerProviderCallback("github", { state, code: undefined, installationId: "43" }),
				layer,
			),
		)
		expect(claimed.fields.error).toBe("invalid_state")
		const bogus = await fieldsOf(
			await run(
				handleBrokerProviderCallback("github", { state, code: undefined, installationId: "../app" }),
				layer,
			),
		)
		expect(bogus.fields.error).toBe("invalid_state")
	})
})

describe("broker refresh", () => {
	const refreshRequest = async (
		provider: string,
		body: Readonly<Record<string, string>>,
		options: { sign?: JsonWebKey; at?: string } = {},
	) => {
		const text = JSON.stringify(body)
		const timestamp = options.at ?? currentTimestamp()
		const signature = await sign(
			options.sign ?? acme.privateKey.sig,
			refreshSigningInput({ provider, instanceId: "acme", timestamp, body: text }),
		)
		return new Request(`https://api.hazel.test/oauth-broker/${provider}/refresh`, {
			method: "POST",
			body: text,
			headers: {
				[BROKER_HEADERS.instance]: "acme",
				[BROKER_HEADERS.timestamp]: timestamp,
				[BROKER_HEADERS.signature]: signature,
			},
		})
	}
	const layer = (routes = new Map<string, string>()) =>
		Layer.mergeAll(registry, makeDirectory(routes), github, config(brokerEnv))

	it("mints a GitHub token only for an installation routed to the instance", async () => {
		const routes = new Map([
			["github:42", "acme"],
			["github:43", "globex"],
		])
		const ok = toWeb(
			await run(
				handleBrokerRefresh("github").pipe(
					asRequest(await refreshRequest("github", { installationId: "42" })),
				),
				layer(routes),
			),
		)
		expect(ok.status).toBe(200)
		const { payload } = (await ok.json()) as { payload: string }
		const opened = await open({
			sealed: payload,
			instanceId: "acme",
			instancePrivateEncKey: acme.privateKey.enc,
			brokerPublicKey: brokerKey.publicKey,
			provider: "github",
			kind: "refresh",
		})
		expect(opened).toMatchObject({ ok: true, value: { data: { tokens: { accessToken: "ghs-42" } } } })

		const other = toWeb(
			await run(
				handleBrokerRefresh("github").pipe(
					asRequest(await refreshRequest("github", { installationId: "43" })),
				),
				layer(routes),
			),
		)
		expect(other.status).toBe(403)
	})

	it("refuses a request signed with another key, or replayed late", async () => {
		const impostor = await generateInstanceKeys()
		const forged = await refreshRequest(
			"github",
			{ installationId: "42" },
			{ sign: impostor.privateKey.sig },
		)
		expect(toWeb(await run(handleBrokerRefresh("github").pipe(asRequest(forged)), layer())).status).toBe(
			401,
		)
		const late = await refreshRequest(
			"github",
			{ installationId: "42" },
			{ at: String(Math.floor(Date.now() / 1000) - 900) },
		)
		expect(toWeb(await run(handleBrokerRefresh("github").pipe(asRequest(late)), layer())).status).toBe(
			401,
		)
	})

	it("refreshes an OAuth token with Hazel's credentials, end to end from the instance", async () => {
		const brokerLayer = layer()
		// The instance's client posts to the broker over `fetch`; here the broker answers in process.
		brokerFetch = async (request) =>
			toWeb(await run(handleBrokerRefresh("linear").pipe(asRequest(request)), brokerLayer))
		const tokens = await Effect.runPromise(
			refreshViaBroker(client, "linear", { refreshToken: "lin-refresh" }),
		)
		expect(tokens.accessToken).toBe("lin-refreshed")
		expect(tokens.refreshToken).toBe("lin-refresh")
		expect(tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token")
		expect(tokenRequests.at(-1)?.get("client_secret")).toBe("hazel-linear-secret")

		const revoked = await Effect.runPromiseExit(
			refreshViaBroker(client, "linear", { refreshToken: "revoked" }),
		)
		expect(Exit.isFailure(revoked)).toBe(true)
	})
})

describe("webhook relay", () => {
	const slackEvent = JSON.stringify({
		type: "event_callback",
		team_id: "T123",
		api_app_id: "A1",
		event_id: "Ev1",
		event_time: 1,
		event: { type: "message" },
	})

	it("forwards a brokered workspace's delivery to its instance, signed so the instance accepts it", async () => {
		const sent: Array<Request> = []
		const http = HttpClient.make((request) =>
			Effect.sync(() => {
				const body =
					request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
				sent.push(
					new Request(request.url, { method: "POST", body, headers: request.headers as never }),
				)
				return HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))
			}),
		)
		const relayed = await run(
			relayToInstance({ provider: "slack", externalId: "T123", rawBody: slackEvent }),
			Layer.mergeAll(
				makeDirectory(new Map([["slack:T123", "acme"]])),
				Layer.succeed(HttpClient.HttpClient, http),
				config(brokerEnv),
			),
		)
		expect(relayed).toEqual(Option.some(true))
		expect(sent[0]?.url).toBe(`${ACME_API}/webhooks/slack/brokered`)
		const headers = Object.fromEntries(sent[0]?.headers.entries() ?? [])
		const body = (await sent[0]?.text()) ?? ""
		expect(body).toBe(slackEvent)
		expect(await verifyRelay(client, "slack", headers, body)).toMatchObject({ ok: true })
	})

	it("leaves an installation that is not brokered, or a broker that is off, to the install", async () => {
		const http = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make(() => Effect.die("must not send")),
		)
		expect(
			await run(
				relayToInstance({ provider: "slack", externalId: "T999", rawBody: slackEvent }),
				Layer.mergeAll(makeDirectory(), http, config(brokerEnv)),
			),
		).toEqual(Option.none())
		expect(
			await run(
				relayToInstance({ provider: "slack", externalId: "T123", rawBody: slackEvent }),
				Layer.mergeAll(makeDirectory(new Map([["slack:T123", "acme"]])), http, config({})),
			),
		).toEqual(Option.none())
	})

	describe("on the instance", () => {
		const challenge = JSON.stringify({ type: "url_verification", token: "x", challenge: "abc123" })
		const deliver = async (
			options: {
				body?: string
				signWith?: JsonWebKey
				instance?: string
				at?: string
				signedBody?: string
			} = {},
		) => {
			const body = options.body ?? challenge
			const timestamp = options.at ?? currentTimestamp()
			const instanceId = options.instance ?? "acme"
			const signature = await sign(
				options.signWith ?? brokerKey.privateKey,
				relaySigningInput({
					provider: "slack",
					instanceId,
					timestamp,
					event: "",
					delivery: "",
					body: options.signedBody ?? body,
				}),
			)
			const response = await run(
				handleBrokeredWebhookRoute.pipe(
					asRequest(
						new Request(`${ACME_API}/webhooks/slack/brokered`, {
							method: "POST",
							body,
							headers: {
								[BROKER_HEADERS.instance]: instanceId,
								[BROKER_HEADERS.timestamp]: timestamp,
								[BROKER_HEADERS.signature]: signature,
							},
						}),
					),
				),
				// The URL check needs none of chat sync's services; a delivery that reached them would fail.
				Layer.mergeAll(
					makeDirectory(),
					makeOrgObject().layer,
					chatSync,
					Layer.succeed(Slack.SlackApiClient, {} as never),
					config(instanceEnv),
				),
			)
			return toWeb(response)
		}

		it("applies a delivery the broker signed", async () => {
			const response = await deliver()
			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({ ok: true, challenge: "abc123" })
		})

		it("refuses another signer, another instance, a stale delivery or a changed body", async () => {
			const impostor = await generateBrokerSigningKey()
			expect((await deliver({ signWith: impostor.privateKey })).status).toBe(401)
			expect((await deliver({ instance: "globex" })).status).toBe(401)
			expect((await deliver({ at: String(Math.floor(Date.now() / 1000) - 900) })).status).toBe(401)
			expect((await deliver({ signedBody: '{"type":"other"}' })).status).toBe(401)
		})
	})
})
