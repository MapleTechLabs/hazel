import type { SyncSourceKind } from "@hazel/domain/sync"

/** A source object, `<kind>:<id>`: `org:<organizationId>`, `channel:<channelId>`, `user:<userId>`. */
export type SourceKey = `${SyncSourceKind}:${string}`

export const sourceKey = (kind: SyncSourceKind, id: string): SourceKey => `${kind}:${id}`

export const parseSourceKey = (key: SourceKey): { readonly kind: SyncSourceKind; readonly id: string } => {
	const at = key.indexOf(":")
	return { kind: key.slice(0, at) as SyncSourceKind, id: key.slice(at + 1) }
}

/**
 * Result of the app's token reader: a token; `null` when there is no session; `"unavailable"` when
 * the API did not answer (says nothing about the session).
 */
export type SyncTokenResult = string | null | "unavailable"

/** The subset of the DOM `WebSocket` the connection uses, so tests can inject a fake. */
export interface WebSocketLike {
	readonly readyState: number
	onopen: ((event: unknown) => void) | null
	onmessage: ((event: { readonly data: unknown }) => void) | null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null
	onerror: ((event: unknown) => void) | null
	send(data: string): void
	close(code?: number, reason?: string): void
}

export type WebSocketConstructor = new (url: string, protocols: string | Array<string>) => WebSocketLike

export type SyncLogLevel = "debug" | "warning" | "error"

/** Where the hub and collections log. Defaults to the console. */
export type SyncLogger = (level: SyncLogLevel, message: string, annotations: Record<string, unknown>) => void

export const consoleLogger: SyncLogger = (level, message, annotations) => {
	const log = level === "error" ? console.error : level === "warning" ? console.warn : console.debug
	log(message, annotations)
}

/**
 * Configuration for exponential backoff on connection errors
 */
export interface BackoffConfig {
	/**
	 * Initial delay in milliseconds before first retry
	 * @default 1000
	 */
	initialDelayMs?: number

	/**
	 * Maximum delay in milliseconds between retries
	 * @default 30000
	 */
	maxDelayMs?: number

	/**
	 * Multiplier for exponential backoff (delay = delay * multiplier)
	 * @default 2
	 */
	multiplier?: number

	/**
	 * Whether to add random jitter to delays (helps prevent thundering herd)
	 * @default true
	 */
	jitter?: boolean
}

export const DEFAULT_BACKOFF: Required<BackoffConfig> = {
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	multiplier: 2,
	jitter: true,
}

/** Delay before retry number `attempt` (1-based); jitter spreads it over 50-150%. */
export const backoffDelay = (config: Required<BackoffConfig>, attempt: number): number => {
	const base = Math.min(
		config.initialDelayMs * config.multiplier ** Math.max(0, attempt - 1),
		config.maxDelayMs,
	)
	return config.jitter ? Math.min(base * (0.5 + Math.random()), config.maxDelayMs) : base
}
