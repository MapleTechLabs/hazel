/**
 * The OAuth broker's two configurations (`docs/self-hosting.md#brokered-integrations`):
 *
 * - **broker** (Hazel's own install): `OAUTH_BROKER_ENABLED=true`, `OAUTH_BROKER_STATE_KEY`,
 *   `OAUTH_BROKER_SIGNING_KEY` and the registry `OAUTH_BROKER_INSTANCES`;
 * - **client** (a customer install): `OAUTH_BROKER_URL`, `OAUTH_BROKER_INSTANCE_ID`,
 *   `OAUTH_BROKER_PRIVATE_KEY` and the broker's pinned `OAUTH_BROKER_PUBLIC_KEY`.
 *
 * Either is off unless complete; a half-set one is logged and stays off, never half on.
 */
import { Config, Effect, Option, Redacted, Schema } from "effect"
import {
	decodeInstancePrivateKey,
	decodeP256Jwk,
	fromBase64Url,
	InstancePublicKey,
	type InstancePrivateKey,
	type Jwk,
} from "./crypto"

/** The providers Hazel's apps can broker. Discord cannot: one gateway session per bot token. */
export const BROKERED_PROVIDERS = ["slack", "linear", "github"] as const
export type BrokeredProvider = (typeof BROKERED_PROVIDERS)[number]
export const isBrokeredProvider = (provider: string): provider is BrokeredProvider =>
	(BROKERED_PROVIDERS as ReadonlyArray<string>).includes(provider)

export const INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const isHttpsOrigin = (url: string) => {
	if (!URL.canParse(url)) return false
	const parsed = new URL(url)
	return (
		(parsed.protocol === "https:" ||
			(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) &&
		parsed.username === "" &&
		parsed.password === "" &&
		parsed.search === "" &&
		parsed.hash === "" &&
		(parsed.pathname === "/" || parsed.pathname === "")
	)
}

const BrokerInstance = Schema.Struct({
	id: Schema.String.pipe(Schema.check(Schema.isPattern(INSTANCE_ID_RE))),
	/** The instance's api origin (`https://api.<zone>`): where tokens and webhooks are handed. */
	apiUrl: Schema.String.pipe(
		Schema.check(
			Schema.makeFilter((url: string) => (isHttpsOrigin(url) ? undefined : "not an https origin")),
		),
	),
	publicKey: InstancePublicKey,
})
export type BrokerInstance = typeof BrokerInstance.Type

export const decodeBrokerInstances = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Array(BrokerInstance)),
)

export interface BrokerConfig {
	readonly instances: ReadonlyMap<string, BrokerInstance>
	readonly stateKey: string
	readonly signingKey: Jwk
}

/** The broker's configuration on Hazel's own install, or none when it is off. */
export const loadBrokerConfig = Effect.gen(function* () {
	const enabled = yield* Config.Boolean("OAUTH_BROKER_ENABLED").pipe(Config.withDefault(false))
	if (!enabled) return Option.none<BrokerConfig>()
	const raw = yield* Config.all({
		instances: Config.Redacted("OAUTH_BROKER_INSTANCES").pipe(Config.option),
		stateKey: Config.Redacted("OAUTH_BROKER_STATE_KEY").pipe(Config.option),
		signingKey: Config.Redacted("OAUTH_BROKER_SIGNING_KEY").pipe(Config.option),
	})
	const problems: Array<string> = []
	const instances = Option.flatMap(raw.instances, (value) => decodeBrokerInstances(Redacted.value(value)))
	if (Option.isNone(instances)) problems.push("OAUTH_BROKER_INSTANCES is missing or invalid")
	const stateKey = Option.filter(
		Option.map(raw.stateKey, Redacted.value),
		(key) => (fromBase64Url(key)?.length ?? 0) >= 32,
	)
	if (Option.isNone(stateKey)) problems.push("OAUTH_BROKER_STATE_KEY is missing or under 32 bytes")
	const signingKey = Option.filter(
		Option.flatMap(raw.signingKey, (value) => decodeP256Jwk(Redacted.value(value))),
		(jwk) => jwk.d !== undefined,
	)
	if (Option.isNone(signingKey))
		problems.push("OAUTH_BROKER_SIGNING_KEY is missing or not a P-256 private JWK")
	if (Option.isNone(instances) || Option.isNone(stateKey) || Option.isNone(signingKey)) {
		yield* Effect.logError("OAuth broker is enabled but misconfigured; it stays off", { problems })
		return Option.none<BrokerConfig>()
	}
	const byId = new Map<string, BrokerInstance>()
	for (const instance of instances.value) byId.set(instance.id, instance)
	return Option.some<BrokerConfig>({
		instances: byId,
		stateKey: stateKey.value,
		signingKey: signingKey.value as Jwk,
	})
}).pipe(Effect.orDie, Effect.withSpan("OAuthBroker.loadConfig"))

export interface BrokerClientConfig {
	/** The broker's api origin (`https://api.hazel.sh`). */
	readonly brokerUrl: string
	readonly instanceId: string
	readonly privateKey: InstancePrivateKey
	readonly brokerPublicKey: Jwk
}

/** A customer install's broker client, or none when it is not set up. */
export const loadBrokerClientConfig = Effect.gen(function* () {
	const raw = yield* Config.all({
		brokerUrl: Config.String("OAUTH_BROKER_URL").pipe(Config.option),
		instanceId: Config.String("OAUTH_BROKER_INSTANCE_ID").pipe(Config.option),
		privateKey: Config.Redacted("OAUTH_BROKER_PRIVATE_KEY").pipe(Config.option),
		brokerPublicKey: Config.String("OAUTH_BROKER_PUBLIC_KEY").pipe(Config.option),
	})
	// The installer writes the instance id and key up front; the broker is used once its URL is set.
	if (Option.isNone(raw.brokerUrl)) return Option.none<BrokerClientConfig>()
	const brokerUrl = Option.filter(raw.brokerUrl, isHttpsOrigin)
	const instanceId = Option.filter(raw.instanceId, (id) => INSTANCE_ID_RE.test(id))
	const privateKey = Option.flatMap(raw.privateKey, (value) =>
		decodeInstancePrivateKey(Redacted.value(value)),
	)
	const brokerPublicKey = Option.flatMap(raw.brokerPublicKey, decodeP256Jwk)
	if (
		Option.isNone(brokerUrl) ||
		Option.isNone(instanceId) ||
		Option.isNone(privateKey) ||
		Option.isNone(brokerPublicKey)
	) {
		yield* Effect.logError("OAuth broker client is misconfigured; brokered integrations stay off", {
			brokerUrl: Option.isSome(brokerUrl),
			instanceId: Option.isSome(instanceId),
			privateKey: Option.isSome(privateKey),
			brokerPublicKey: Option.isSome(brokerPublicKey),
		})
		return Option.none<BrokerClientConfig>()
	}
	return Option.some<BrokerClientConfig>({
		brokerUrl: brokerUrl.value.replace(/\/$/, ""),
		instanceId: instanceId.value,
		privateKey: privateKey.value,
		brokerPublicKey: brokerPublicKey.value as Jwk,
	})
}).pipe(Effect.orDie, Effect.withSpan("OAuthBroker.loadClientConfig"))
