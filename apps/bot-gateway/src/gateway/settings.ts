/**
 * Gateway timing, from the same env keys (and defaults) the Bun gateway read. Parsed from the
 * Worker env by hand rather than through `Config`: alchemy binds every `Config` read inside a
 * Worker or Durable Object init as a secret at plan time.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000
export const DEFAULT_LEASE_TTL_SECONDS = 75
export const DEFAULT_BATCH_ACK_TIMEOUT_MS = 60_000

export const GATEWAY_ENV_KEYS = [
	"GATEWAY_HEARTBEAT_INTERVAL_MS",
	"GATEWAY_LEASE_TTL_SECONDS",
	"GATEWAY_BATCH_ACK_TIMEOUT_MS",
] as const

export interface GatewaySettings {
	/** Sent to bots in HELLO; the cadence of their HEARTBEAT frames. */
	readonly heartbeatIntervalMs: number
	/** A client silent for this long is disconnected, freeing the bot for a new session. */
	readonly leaseTtlMs: number
	/** How long a DISPATCH batch may wait for its ACK before the session is told to reconnect. */
	readonly batchAckTimeoutMs: number
}

const positiveInt = (value: unknown, fallback: number): number => {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const readGatewaySettings = (env: Record<string, unknown>): GatewaySettings => ({
	heartbeatIntervalMs: positiveInt(env.GATEWAY_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS),
	leaseTtlMs: positiveInt(env.GATEWAY_LEASE_TTL_SECONDS, DEFAULT_LEASE_TTL_SECONDS) * 1000,
	batchAckTimeoutMs: positiveInt(env.GATEWAY_BATCH_ACK_TIMEOUT_MS, DEFAULT_BATCH_ACK_TIMEOUT_MS),
})
