/**
 * Log Context System for Bot SDK
 *
 * Provides correlation IDs and rich context for end-to-end request tracing.
 * Uses FiberRef for fiber-local context propagation across Effect operations.
 */

import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Context, type Tracer } from "effect"

type GatewayEventType = string
type GatewayEventOperation = string

/**
 * Unique identifier for correlating logs across a single request/event flow
 */
export type CorrelationId = string & { readonly _brand: unique symbol }

/**
 * Unique identifier for a specific event instance
 */
export type EventId = string & { readonly _brand: unique symbol }

/**
 * Core log context with all fields for comprehensive tracing
 */
export interface LogContext {
	/** Unique ID for correlating all logs in a single event/command flow */
	readonly correlationId: CorrelationId
	/** Bot's unique identifier */
	readonly botId: string
	/** Human-readable bot name */
	readonly botName: string
	/** Unique event identifier for traced inbound events */
	readonly eventId?: EventId
	/** Event type */
	readonly eventType?: GatewayEventType
	/** Optional event source grouping */
	readonly table?: string
	/** Optional operation name */
	readonly operation?: GatewayEventOperation
	/** Command name (for slash commands) */
	readonly commandName?: string
	/** Channel where event/command originated */
	readonly channelId?: ChannelId
	/** User who triggered the event/command */
	readonly userId?: UserId
	/** Organization context */
	readonly orgId?: OrganizationId
	/** Timestamp when the context was created (for duration calculations) */
	readonly startTime: number
}

/**
 * Reference for fiber-local context propagation
 * Allows context to flow through Effect operations without explicit passing
 */
export const currentLogContext = Context.Reference<LogContext | null>("@hazel/bot-sdk/CurrentLogContext", {
	defaultValue: () => null,
})

/**
 * Generate a unique correlation ID
 */
export const generateCorrelationId = (): CorrelationId => {
	const timestamp = Date.now().toString(36)
	const random = Math.random().toString(36).substring(2, 8)
	return `${timestamp}-${random}` as CorrelationId
}

/**
 * Generate a unique event ID
 */
export const generateEventId = (): EventId => {
	const timestamp = Date.now().toString(36)
	const random = Math.random().toString(36).substring(2, 6)
	return `evt-${timestamp}-${random}` as EventId
}

/**
 * Bot identity context (minimal context for bot-wide operations)
 */
export interface BotIdentity {
	readonly botId: string
	readonly botName: string
}

/**
 * Create a base log context with bot identity
 */
export const createBaseLogContext = (identity: BotIdentity): LogContext => ({
	correlationId: generateCorrelationId(),
	botId: identity.botId,
	botName: identity.botName,
	startTime: performance.now(),
})

/**
 * Options for creating an event log context
 */
export interface EventLogContextOptions extends BotIdentity {
	readonly eventId?: EventId
	readonly eventType: GatewayEventType
	readonly table: string
	readonly operation: GatewayEventOperation
}

/**
 * Create a log context for a generic inbound event.
 */
export const createEventLogContext = (options: EventLogContextOptions): LogContext => ({
	correlationId: generateCorrelationId(),
	botId: options.botId,
	botName: options.botName,
	eventId: options.eventId ?? generateEventId(),
	eventType: options.eventType,
	table: options.table,
	operation: options.operation,
	startTime: performance.now(),
})

/**
 * Options for creating a command log context
 */
export interface CommandLogContextOptions extends BotIdentity {
	readonly commandName: string
	readonly channelId: ChannelId
	readonly userId: UserId
	readonly orgId: OrganizationId
}

/**
 * Create a log context for slash commands
 */
export const createCommandLogContext = (options: CommandLogContextOptions): LogContext => ({
	correlationId: generateCorrelationId(),
	botId: options.botId,
	botName: options.botName,
	commandName: options.commandName,
	channelId: options.channelId,
	userId: options.userId,
	orgId: options.orgId,
	startTime: performance.now(),
})

/**
 * Extract log annotations from context for use with Effect.annotateLogs
 */
const contextToAnnotations = (ctx: LogContext): Record<string, unknown> => {
	const annotations: Record<string, unknown> = {
		correlationId: ctx.correlationId,
		botId: ctx.botId,
		botName: ctx.botName,
	}

	if (ctx.eventId) annotations.eventId = ctx.eventId
	if (ctx.eventType) annotations.eventType = ctx.eventType
	if (ctx.table) annotations.table = ctx.table
	if (ctx.operation) annotations.operation = ctx.operation
	if (ctx.commandName) annotations.commandName = ctx.commandName
	if (ctx.channelId) annotations.channelId = ctx.channelId
	if (ctx.userId) annotations.userId = ctx.userId
	if (ctx.orgId) annotations.orgId = ctx.orgId

	return annotations
}

/**
 * Extract span attributes from context
 */
const contextToSpanAttributes = (ctx: LogContext): Record<string, unknown> => {
	const attributes: Record<string, unknown> = {
		"bot.correlationId": ctx.correlationId,
		"bot.id": ctx.botId,
		"bot.name": ctx.botName,
	}

	if (ctx.eventId) attributes["event.id"] = ctx.eventId
	if (ctx.eventType) attributes["event.type"] = ctx.eventType
	if (ctx.table) attributes["event.table"] = ctx.table
	if (ctx.operation) attributes["event.operation"] = ctx.operation
	if (ctx.commandName) attributes["command.name"] = ctx.commandName
	if (ctx.channelId) attributes["channel.id"] = ctx.channelId
	if (ctx.userId) attributes["user.id"] = ctx.userId
	if (ctx.orgId) attributes["org.id"] = ctx.orgId

	return attributes
}

/**
 * Run an effect with log context
 *
 * This helper:
 * 1. Sets the FiberRef so context is available in nested effects
 * 2. Annotates all logs with context fields
 * 3. Creates a parent span with context attributes
 *
 * @param ctx - The log context to use
 * @param spanName - Name for the parent span
 * @param effect - The effect to run with context
 * @param options - Optional span options (e.g., parent span for trace propagation)
 */
export const withLogContext = <A, E, R>(
	ctx: LogContext,
	spanName: string,
	make: Effect.Effect<A, E, R>,
	options?: { readonly parent?: Tracer.AnySpan },
): Effect.Effect<A, E, R> =>
	make.pipe(
		Effect.annotateLogs(contextToAnnotations(ctx)),
		Effect.withSpan(spanName, { attributes: contextToSpanAttributes(ctx), ...options }),
		Effect.provideService(currentLogContext, ctx),
	)

/**
 * Get the current log context from the FiberRef
 * Returns null if no context is set
 */
export const getLogContext: Effect.Effect<LogContext | null> = Effect.gen(function* () {
	return yield* currentLogContext
})

/**
 * Get the current correlation ID from context
 * Returns undefined if no context is set
 */
export const getCorrelationId: Effect.Effect<CorrelationId | undefined> = Effect.map(
	getLogContext,
	(ctx) => ctx?.correlationId,
)

/**
 * Annotate the current span with duration from context start time
 */
export const annotateSpanDuration: Effect.Effect<void> = Effect.gen(function* () {
	const ctx = yield* getLogContext
	if (ctx) {
		const duration = performance.now() - ctx.startTime
		yield* Effect.annotateCurrentSpan("duration_ms", duration)
	}
})
