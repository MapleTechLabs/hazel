/**
 * The OAuth broker's client, on a customer install (`OAUTH_BROKER_URL` and friends,
 * `docs/self-hosting.md#brokered-integrations`): starts a connection at the broker, opens what it
 * hands back, asks it for fresh tokens and checks the webhooks it relays.
 */
import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpBody, HttpClient } from "effect/http"
import { BROKER_HEADERS, BrokeredTokens, ConnectData } from "./protocol"
import type { BrokerClientConfig } from "./config"
import {
	type CustomerState,
	currentTimestamp,
	isFresh,
	open,
	publicOf,
	refreshSigningInput,
	relaySigningInput,
	sign,
	signCustomerState,
	type Verified,
	verify,
	verifyCustomerState,
} from "./crypto"

/** The broker's start URL for a connection: the instance's state, signed with its own key. */
export const brokerAuthorizationUrl = async (
	client: BrokerClientConfig,
	provider: string,
	state: {
		readonly organizationId: OrganizationId
		readonly userId: UserId
		readonly level: "organization" | "user"
		readonly returnTo: string
	},
): Promise<string> => {
	const signed = await signCustomerState(client.privateKey.sig as JsonWebKey, {
		instance: client.instanceId,
		provider,
		...state,
	})
	const url = new URL(`${client.brokerUrl}/oauth-broker/${provider}/start`)
	url.searchParams.set("instance", client.instanceId)
	url.searchParams.set("state", signed)
	return url.toString()
}

/** The instance's own state, handed back by the broker (with a payload, or with an error). */
export const verifyOwnState = (client: BrokerClientConfig, provider: string, token: string) =>
	verifyCustomerState(publicOf(client.privateKey.sig as JsonWebKey), token, {
		instanceId: client.instanceId,
		provider,
	})

const decodeConnectData = Schema.decodeUnknownOption(ConnectData)

/** A sealed `connect` payload: the broker's signature, this instance, unexpired, and its own state. */
export const openConnectPayload = async (
	client: BrokerClientConfig,
	provider: string,
	sealed: string,
): Promise<Verified<{ readonly state: CustomerState; readonly data: ConnectData }>> => {
	const opened = await open({
		sealed,
		instanceId: client.instanceId,
		instancePrivateEncKey: client.privateKey.enc as JsonWebKey,
		brokerPublicKey: client.brokerPublicKey,
		provider,
		kind: "connect",
	})
	if (!opened.ok) return opened
	if (opened.value.state === undefined) return { ok: false, reason: "no state" }
	const state = await verifyOwnState(client, provider, opened.value.state)
	if (!state.ok) return { ok: false, reason: `state: ${state.reason}` }
	const data = decodeConnectData(opened.value.data)
	if (Option.isNone(data)) return { ok: false, reason: "malformed data" }
	return { ok: true, value: { state: state.value, data: data.value } }
}

export class BrokerRefreshError extends Schema.TaggedError<
	BrokerRefreshError,
	{ readonly brand: unique symbol }
>()("BrokerRefreshError", {
	provider: Schema.String,
	message: Schema.String,
	status: Schema.optional(Schema.Finite),
}) {}

const RefreshResponse = Schema.Struct({ payload: Schema.String })
const decodeRefreshResponse = Schema.decodeUnknownOption(RefreshResponse)
const decodeRefreshData = Schema.decodeUnknownOption(Schema.Struct({ tokens: BrokeredTokens }))

/**
 * Fresh tokens from the broker: a GitHub installation token (`installationId`) or an OAuth refresh
 * (`refreshToken`). The request is signed with the instance's key; the answer is sealed to it.
 */
export const refreshViaBroker = Effect.fn("OAuthBrokerClient.refresh")(function* (
	client: BrokerClientConfig,
	provider: string,
	request: { readonly installationId?: string; readonly refreshToken?: string },
) {
	const failure = (message: string, status?: number) =>
		new BrokerRefreshError({ provider, message, status })
	const body = JSON.stringify(request)
	const timestamp = currentTimestamp()
	const signature = yield* Effect.promise(() =>
		sign(
			client.privateKey.sig as JsonWebKey,
			refreshSigningInput({ provider, instanceId: client.instanceId, timestamp, body }),
		),
	)
	const http = yield* HttpClient.HttpClient
	const response = yield* http
		.post(`${client.brokerUrl}/oauth-broker/${provider}/refresh`, {
			headers: {
				[BROKER_HEADERS.instance]: client.instanceId,
				[BROKER_HEADERS.timestamp]: timestamp,
				[BROKER_HEADERS.signature]: signature,
			},
			body: HttpBody.text(body, "application/json"),
		})
		.pipe(
			Effect.timeout("15 seconds"),
			Effect.catchTags({
				HttpClientError: (error) => Effect.fail(failure(`Broker unreachable: ${error.message}`)),
				TimeoutError: () => Effect.fail(failure("Broker timed out")),
			}),
		)
	if (response.status !== 200) {
		return yield* failure(`Broker refused the refresh (${response.status})`, response.status)
	}
	const json = yield* response.json.pipe(
		Effect.catchTag("HttpClientError", () => Effect.fail(failure("Broker answered no JSON"))),
	)
	const answer = decodeRefreshResponse(json)
	if (Option.isNone(answer)) return yield* failure("Broker answered no payload")
	const opened = yield* Effect.promise(() =>
		open({
			sealed: answer.value.payload,
			instanceId: client.instanceId,
			instancePrivateEncKey: client.privateKey.enc as JsonWebKey,
			brokerPublicKey: client.brokerPublicKey,
			provider,
			kind: "refresh",
		}),
	)
	if (!opened.ok) return yield* failure(`Broker payload refused: ${opened.reason}`)
	const data = decodeRefreshData(opened.value.data)
	if (Option.isNone(data)) return yield* failure("Broker payload malformed")
	return data.value.tokens
}, Effect.provide(FetchHttpClient.layer))

/** Whether a relayed webhook is the broker's, for this instance, and recent. */
export const verifyRelay = async (
	client: BrokerClientConfig,
	provider: string,
	headers: Readonly<Record<string, string | undefined>>,
	body: string,
): Promise<Verified<{ readonly event: string; readonly delivery: string }>> => {
	const instanceId = headers[BROKER_HEADERS.instance] ?? ""
	const timestamp = headers[BROKER_HEADERS.timestamp] ?? ""
	const signature = headers[BROKER_HEADERS.signature] ?? ""
	const event = headers[BROKER_HEADERS.event] ?? ""
	const delivery = headers[BROKER_HEADERS.delivery] ?? ""
	if (instanceId !== client.instanceId) return { ok: false, reason: "for another instance" }
	if (!isFresh(timestamp)) return { ok: false, reason: "stale" }
	const signed = await verify(
		client.brokerPublicKey,
		relaySigningInput({ provider, instanceId, timestamp, event, delivery, body }),
		signature,
	)
	return signed ? { ok: true, value: { event, delivery } } : { ok: false, reason: "bad signature" }
}
