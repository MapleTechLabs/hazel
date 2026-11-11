import type { BotStateStore, GatewaySessionStore } from "./gateway.ts"

/**
 * Bot client runtime configuration
 */
export interface BotConfig {
	readonly backendUrl: string
	readonly botToken: string
	readonly gatewayUrl?: string
	readonly resumeOffset?: string
	readonly sessionStore?: GatewaySessionStore
	readonly stateStore?: BotStateStore
	readonly maxConcurrentPartitions?: number
	readonly heartbeatIntervalMs?: number
	/** Service name for tracing (defaults to "bot") */
	readonly serviceName?: string
}
