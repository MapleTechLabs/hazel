/**
 * Log Configuration for Bot SDK
 *
 * Provides configurable log levels and formats for bot logging.
 */

import { Layer, Logger, LogLevel, References } from "effect"

/**
 * Log output format options
 */
export type LogFormat = "pretty" | "structured"

/**
 * Bot logging configuration
 */
export interface BotLogConfig {
	/**
	 * Minimum log level to output
	 * @default LogLevel.Info
	 *
	 * Log Level Guidelines:
	 *
	 * DEBUG (internal SDK plumbing - use LOG_LEVEL=debug to see):
	 * - Handler start/complete with timing
	 * - Gateway websocket session lifecycle
	 * - Gateway dispatch and ACK details
	 * - Internal state changes
	 * - Health server listening
	 *
	 * INFO (business-relevant events only):
	 * - Bot authenticated
	 * - Command received (name only)
	 *
	 * WARNING:
	 * - No handler for command
	 * - Retry attempts
	 * - Gateway reconnects
	 *
	 * ERROR:
	 * - Handler failed after retries
	 * - Fatal, unrecoverable SDK failures
	 * - Authentication failed
	 *
	 * Note:
	 * - Gateway reconnect loops are logged at WARNING.
	 *   This indicates degraded connectivity, not a terminal bot failure.
	 * - Set LOG_LEVEL=debug env var to see all startup/lifecycle logs.
	 */
	readonly level: LogLevel.LogLevel

	/**
	 * Output format
	 * - "pretty": Human-readable colored output for development
	 * - "structured": JSON output for production/log aggregation
	 * @default "pretty" in development, "structured" in production
	 */
	readonly format: LogFormat

	/**
	 * Services to enable DEBUG level for (overrides global level)
	 * Useful for debugging specific services while keeping others at INFO
	 * @example ["HazelBotClient", "BotHealthServer"]
	 */
	readonly debugServices?: readonly string[]
}

/**
 * Default log configuration
 */
export const defaultLogConfig: BotLogConfig = {
	level: "Info",
	format: "pretty",
}

/**
 * Production log configuration
 */
export const productionLogConfig: BotLogConfig = {
	level: "Info",
	format: "structured",
}

/**
 * Debug log configuration (all DEBUG output)
 */
export const debugLogConfig: BotLogConfig = {
	level: "Debug",
	format: "pretty",
}

/**
 * Create a logger layer from log configuration
 */
export const createLoggerLayer = (config: BotLogConfig): Layer.Layer<never> => {
	const logger = config.format === "structured" ? Logger.consoleStructured : Logger.consolePretty()

	return Layer.mergeAll(Logger.layer([logger]), Layer.succeed(References.MinimumLogLevel, config.level))
}

/**
 * Log level from string (useful for environment variables)
 */
export const logLevelFromString = (level: string): LogLevel.LogLevel => {
	switch (level.toLowerCase()) {
		case "all":
			return "All"
		case "trace":
			return "Trace"
		case "debug":
			return "Debug"
		case "info":
			return "Info"
		case "warning":
		case "warn":
			return "Warn"
		case "error":
			return "Error"
		case "fatal":
			return "Fatal"
		case "none":
			return "None"
		default:
			return "Info"
	}
}
