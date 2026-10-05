import { BunRuntime } from "@effect/platform-bun"
import { ProxyAuth } from "@hazel/auth/proxy"
import { Database } from "@hazel/db"
import { ConfigProvider, Effect, Layer, Logger, Metric } from "effect"
import { validateBotToken } from "./auth/bot-auth"
import { validateSession } from "./auth/user-auth"
import {
	type AccessContextCacheService,
	AccessContextCacheService as AccessContextCache,
	RedisPersistenceLive,
} from "./cache"
import { ProxyConfigService } from "./config"
import { proxyAuthFailures, proxyRequestDuration, proxyRequestsTotal } from "./observability/metrics"
import { TracerLive } from "./observability/tracer"
import { type ElectricProxyError, prepareElectricUrl, proxyElectricRequest } from "./proxy/electric-client"
import { type BotTableAccessError, getBotWhereClauseForTable, validateBotTable } from "./tables/bot-tables"
import { getWhereClauseForTable, type TableAccessError, validateTable } from "./tables/user-tables"
import { applyWhereToElectricUrl, getWhereClauseParamStats } from "./tables/where-clause-builder"

// =============================================================================
// CORS HELPERS
// =============================================================================

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Expose-Headers": "*",
}

const REQUEST_ID_HEADER_NAMES = ["x-request-id", "x-correlation-id", "cf-ray"] as const

function getRequestId(request: Request): string | undefined {
	for (const headerName of REQUEST_ID_HEADER_NAMES) {
		const value = request.headers.get(headerName)
		if (value) return value
	}
	return undefined
}

const annotateHandledError = Effect.fn("ElectricProxy.annotateHandledError")(function* (
	statusCode: number,
	errorType: string,
) {
	yield* Effect.annotateCurrentSpan("http.response.status_code", statusCode)
	yield* Effect.annotateCurrentSpan("error.type", errorType)
	yield* Effect.annotateCurrentSpan("error.handled", true)
})

// =============================================================================
// USER FLOW HANDLER
// =============================================================================

const handleUserRequest = (request: Request) => {
	const start = Date.now()
	const requestId = getRequestId(request)

	return Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan("http.method", request.method)
		yield* Effect.annotateCurrentSpan("http.request.method", request.method)
		yield* Effect.annotateCurrentSpan("http.route", "/v1/shape")
		yield* Effect.annotateCurrentSpan("proxy.auth_type", "user")
		if (requestId) {
			yield* Effect.annotateCurrentSpan("http.request_id", requestId)
		}

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS })
		}

		// Method check
		if (request.method !== "GET" && request.method !== "DELETE") {
			yield* Effect.annotateCurrentSpan("proxy.reject_reason", "method_not_allowed")
			yield* Effect.annotateCurrentSpan("http.response.status_code", 405)
			return new Response("Method not allowed", {
				status: 405,
				headers: { Allow: "GET, DELETE, OPTIONS", ...CORS_HEADERS },
			})
		}

		// Authenticate user
		const user = yield* validateSession(request)

		// Extract and validate table parameter
		const url = new URL(request.url)
		const tableParam = url.searchParams.get("table")
		const tableValidation = validateTable(tableParam)

		if (!tableValidation.valid) {
			yield* Effect.annotateCurrentSpan("proxy.reject_reason", "invalid_table")
			yield* Effect.annotateCurrentSpan("http.response.status_code", tableParam ? 403 : 400)
			return new Response(JSON.stringify({ error: tableValidation.error }), {
				status: tableParam ? 403 : 400,
				headers: { "Content-Type": "application/json", ...CORS_HEADERS },
			})
		}

		yield* Effect.annotateCurrentSpan("proxy.table", tableValidation.table!)

		// Prepare Electric URL
		const originUrl = yield* prepareElectricUrl(request.url)
		originUrl.searchParams.set("table", tableValidation.table!)

		// Generate WHERE clause
		const whereResult = yield* getWhereClauseForTable(tableValidation.table!, user)
		const whereStats = getWhereClauseParamStats(whereResult)
		const finalUrl = applyWhereToElectricUrl(originUrl, whereResult)
		yield* Effect.annotateCurrentSpan("proxy.where.params_count", whereStats.paramsCount)
		yield* Effect.annotateCurrentSpan(
			"proxy.where.unique_placeholder_count",
			whereStats.uniquePlaceholderCount,
		)
		yield* Effect.annotateCurrentSpan("proxy.where.max_placeholder_index", whereStats.maxPlaceholderIndex)
		yield* Effect.annotateCurrentSpan("proxy.where.starts_at_one", whereStats.startsAtOne)
		yield* Effect.annotateCurrentSpan("proxy.where.has_gaps", whereStats.hasGaps)
		yield* Effect.annotateCurrentSpan("proxy.where.length", whereResult.whereClause.length)
		yield* Effect.annotateCurrentSpan("proxy.electric_url.length", finalUrl.length)

		// Proxy request to Electric
		const response = yield* proxyElectricRequest(finalUrl)

		// Add CORS headers to response
		const headers = new Headers(response.headers)
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			headers.set(key, value)
		}

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		})
	}).pipe(
		// Auth errors → 401
		Effect.catchTag("ProxyAuthenticationError", (error) =>
			Effect.gen(function* () {
				yield* annotateHandledError(401, "ProxyAuthenticationError")
				yield* Effect.logInfo("Authentication failed", { detail: error.detail })
				yield* Metric.update(
					Metric.withAttributes(proxyAuthFailures, {
						auth_type: "user",
						error_tag: "ProxyAuthenticationError",
					}),
					1,
				)
				return new Response(
					JSON.stringify({
						error: error.message,
						detail: error.detail,
						timestamp: new Date().toISOString(),
						hint: "Check if Bearer token is present and valid",
					}),
					{
						status: 401,
						headers: { "Content-Type": "application/json", ...CORS_HEADERS },
					},
				)
			}),
		),
		// Access/table errors → 500
		Effect.catchTag("TableAccessError", (error: TableAccessError) =>
			Effect.gen(function* () {
				yield* annotateHandledError(500, "TableAccessError")
				yield* Effect.logError("Table access error", { error: error.message, table: error.table })
				return new Response(
					JSON.stringify({ error: error.message, detail: error.detail, table: error.table }),
					{
						status: 500,
						headers: { "Content-Type": "application/json", ...CORS_HEADERS },
					},
				)
			}),
		),
		// Upstream errors → 502
		Effect.catchTag("ElectricProxyError", (error: ElectricProxyError) =>
			Effect.gen(function* () {
				yield* annotateHandledError(502, "ElectricProxyError")
				yield* Effect.logError("Electric proxy error", { error: error.message })
				return new Response(JSON.stringify({ error: error.message, detail: error.detail }), {
					status: 502,
					headers: { "Content-Type": "application/json", ...CORS_HEADERS },
				})
			}),
		),
		// Fallback for any unhandled errors - returns error details to client for debugging
		Effect.catch((error: unknown) =>
			Effect.gen(function* () {
				const errorTag = (error as { _tag?: string })?._tag ?? "UnknownError"
				yield* annotateHandledError(500, errorTag)
				yield* Effect.logError("Unhandled error in user flow", {
					tag: errorTag,
					error: String(error),
				})
				return new Response(
					JSON.stringify({
						error: errorTag,
						detail: String(error),
						timestamp: new Date().toISOString(),
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json", ...CORS_HEADERS },
					},
				)
			}),
		),
		Effect.tap((response) =>
			Effect.gen(function* () {
				const duration = Date.now() - start
				yield* Effect.annotateCurrentSpan("http.status_code", response.status)
				yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
				yield* Metric.update(
					Metric.withAttributes(proxyRequestsTotal, {
						route: "/v1/shape",
						auth_type: "user",
						status_code: String(response.status),
					}),
					1,
				)
				yield* Metric.update(proxyRequestDuration, duration)
			}),
		),
		Effect.withSpan("proxy.handleUserRequest"),
		Effect.annotateLogs({
			route: "/v1/shape",
			auth_type: "user",
			...(requestId ? { request_id: requestId } : {}),
		}),
	)
}

// =============================================================================
// BOT FLOW HANDLER
// =============================================================================

const handleBotRequest = (request: Request) => {
	const start = Date.now()
	const requestId = getRequestId(request)

	return Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan("http.method", request.method)
		yield* Effect.annotateCurrentSpan("http.request.method", request.method)
		yield* Effect.annotateCurrentSpan("http.route", "/bot/v1/shape")
		yield* Effect.annotateCurrentSpan("proxy.auth_type", "bot")
		if (requestId) {
			yield* Effect.annotateCurrentSpan("http.request_id", requestId)
		}

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS })
		}

		// Method check
		if (request.method !== "GET" && request.method !== "DELETE") {
			yield* Effect.annotateCurrentSpan("proxy.reject_reason", "method_not_allowed")
			yield* Effect.annotateCurrentSpan("http.response.status_code", 405)
			return new Response("Method not allowed", {
				status: 405,
				headers: { Allow: "GET, DELETE, OPTIONS", ...CORS_HEADERS },
			})
		}

		// Authenticate bot
		const bot = yield* validateBotToken(request)

		// Extract and validate table parameter
		const url = new URL(request.url)
		const tableParam = url.searchParams.get("table")
		const tableValidation = validateBotTable(tableParam)

		if (!tableValidation.valid) {
			yield* Effect.annotateCurrentSpan("proxy.reject_reason", "invalid_table")
			yield* Effect.annotateCurrentSpan("http.response.status_code", tableParam ? 403 : 400)
			return new Response(JSON.stringify({ error: tableValidation.error }), {
				status: tableParam ? 403 : 400,
				headers: { "Content-Type": "application/json", ...CORS_HEADERS },
			})
		}

		yield* Effect.annotateCurrentSpan("proxy.table", tableValidation.table!)

		// Prepare Electric URL
		const originUrl = yield* prepareElectricUrl(request.url)
		originUrl.searchParams.set("table", tableValidation.table!)

		// Generate WHERE clause
		const whereResult = yield* getBotWhereClauseForTable(tableValidation.table!, bot)
		const whereStats = getWhereClauseParamStats(whereResult)
		const finalUrl = applyWhereToElectricUrl(originUrl, whereResult)
		yield* Effect.annotateCurrentSpan("proxy.where.params_count", whereStats.paramsCount)
		yield* Effect.annotateCurrentSpan(
			"proxy.where.unique_placeholder_count",
			whereStats.uniquePlaceholderCount,
		)
		yield* Effect.annotateCurrentSpan("proxy.where.max_placeholder_index", whereStats.maxPlaceholderIndex)
		yield* Effect.annotateCurrentSpan("proxy.where.starts_at_one", whereStats.startsAtOne)
		yield* Effect.annotateCurrentSpan("proxy.where.has_gaps", whereStats.hasGaps)
		yield* Effect.annotateCurrentSpan("proxy.where.length", whereResult.whereClause.length)
		yield* Effect.annotateCurrentSpan("proxy.electric_url.length", finalUrl.length)

		// Proxy request to Electric
		const response = yield* proxyElectricRequest(finalUrl)

		// Add CORS headers to response
		const headers = new Headers(response.headers)
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			headers.set(key, value)
		}

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		})
	}).pipe(
		// Auth errors → 401
		Effect.catchTag("BotAuthenticationError", (error) =>
			Effect.gen(function* () {
				yield* annotateHandledError(401, "BotAuthenticationError")
				yield* Effect.logInfo("Bot authentication failed", {
					detail: error.detail,
				})
				yield* Metric.update(
					Metric.withAttributes(proxyAuthFailures, {
						auth_type: "bot",
						error_tag: "BotAuthenticationError",
					}),
					1,
				)
				return new Response(
					JSON.stringify({
						error: error.message,
						detail: error.detail,
						timestamp: new Date().toISOString(),
						hint: "Check if Authorization header contains valid Bearer token",
					}),
					{
						status: 401,
						headers: { "Content-Type": "application/json", ...CORS_HEADERS },
					},
				)
			}),
		),
		Effect.catchTag("AccessContextLookupError", (error) =>
			Effect.gen(function* () {
				yield* annotateHandledError(500, "AccessContextLookupError")
				yield* Effect.logError("Bot access context lookup failed", {
					error: error.message,
					entityId: error.entityId,
					entityType: error.entityType,
				})
				return new Response(
					JSON.stringify({
						error: error.message,
						entityId: error.entityId,
						entityType: error.entityType,
					}),
					{ status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
				)
			}),
		),
		Effect.catchTag("BotTableAccessError", (error: BotTableAccessError) =>
			Effect.gen(function* () {
				yield* annotateHandledError(500, "BotTableAccessError")
				yield* Effect.logError("Bot table access error", { error: error.message, table: error.table })
				return new Response(
					JSON.stringify({ error: error.message, detail: error.detail, table: error.table }),
					{ status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
				)
			}),
		),
		Effect.catchTag("ElectricProxyError", (error: ElectricProxyError) =>
			Effect.gen(function* () {
				yield* annotateHandledError(502, "ElectricProxyError")
				yield* Effect.logError("Electric proxy error (bot)", { error: error.message })
				return new Response(JSON.stringify({ error: error.message, detail: error.detail }), {
					status: 502,
					headers: { "Content-Type": "application/json", ...CORS_HEADERS },
				})
			}),
		),
		// Fallback for any unhandled errors - returns error details to client for debugging
		Effect.catch((error: unknown) =>
			Effect.gen(function* () {
				const errorTag = (error as { _tag?: string })?._tag ?? "UnknownError"
				yield* annotateHandledError(500, errorTag)
				yield* Effect.logError("Unhandled error in bot flow", { tag: errorTag, error: String(error) })
				return new Response(
					JSON.stringify({
						error: errorTag,
						detail: String(error),
						timestamp: new Date().toISOString(),
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json", ...CORS_HEADERS },
					},
				)
			}),
		),
		Effect.tap((response) =>
			Effect.gen(function* () {
				const duration = Date.now() - start
				yield* Effect.annotateCurrentSpan("http.status_code", response.status)
				yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
				yield* Metric.update(
					Metric.withAttributes(proxyRequestsTotal, {
						route: "/bot/v1/shape",
						auth_type: "bot",
						status_code: String(response.status),
					}),
					1,
				)
				yield* Metric.update(proxyRequestDuration, duration)
			}),
		),
		Effect.withSpan("proxy.handleBotRequest"),
		Effect.annotateLogs({
			route: "/bot/v1/shape",
			auth_type: "bot",
			...(requestId ? { request_id: requestId } : {}),
		}),
	)
}

// =============================================================================
// LAYERS
// =============================================================================

const DatabaseLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService
		yield* Effect.log("Connecting to database", { isDev: config.isDev })
		return Database.layer({
			url: config.databaseUrl,
			ssl: !config.isDev,
		})
	}),
)

const LoggerLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService
		return config.isDev
			? Logger.layer([Logger.consolePretty()])
			: Logger.layer([Logger.withConsoleLog(Logger.formatStructured)])
	}),
).pipe(Layer.provide(ProxyConfigService.layer))

// Cache layer: AccessContextCache requires ResultPersistence and Database
const CacheLive = AccessContextCache.layer.pipe(
	Layer.provide(RedisPersistenceLive),
	Layer.provide(DatabaseLive),
	Layer.provide(ProxyConfigService.layer),
)

// ProxyAuth layer requires ResultPersistence for session caching and Database for user lookup
// ProxyAuth.layer includes SessionValidator.layer via dependencies
const ProxyAuthLive = ProxyAuth.layer.pipe(
	Layer.provide(RedisPersistenceLive),
	Layer.provide(DatabaseLive),
	Layer.provide(ProxyConfigService.layer),
)

const MainLive = DatabaseLive.pipe(
	Layer.provideMerge(ProxyConfigService.layer),
	Layer.provideMerge(LoggerLive),
	Layer.provideMerge(CacheLive),
	Layer.provideMerge(TracerLive),
	Layer.provideMerge(ProxyAuthLive),
)

// =============================================================================
// SERVER
// =============================================================================

const ServerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService

		yield* Effect.log("Starting Electric Proxy (Bun)", {
			port: config.port,
			electricUrl: config.electricUrl,
			allowedOrigin: config.allowedOrigin,
		})
		if (!config.isDev && (!config.electricSourceId || !config.electricSourceSecret)) {
			yield* Effect.logWarning("Electric source credentials missing; upstream requests may fail", {
				hasSourceId: !!config.electricSourceId,
				hasSecret: !!config.electricSourceSecret,
			})
		}

		const serviceMap = yield* Effect.context<
			ProxyConfigService | Database.Database | AccessContextCacheService | ProxyAuth
		>()
		const run = Effect.runPromiseWith(serviceMap)

		yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.serve({
					port: config.port,
					hostname: "::",
					idleTimeout: 120,
					routes: {
						"/health": new Response("OK"), // Static response - zero allocation
						"/v1/shape": (req) => run(handleUserRequest(req)),
						"/bot/v1/shape": (req) => run(handleBotRequest(req)),
					},
					fetch() {
						return new Response("Not Found", { status: 404 })
					},
				}),
			),
			(server) =>
				Effect.gen(function* () {
					yield* Effect.log("Shutting down server...")
					server.stop(true)
				}),
		)

		yield* Effect.log(`Server listening on port ${config.port}`)
	}),
)

Layer.launch(
	ServerLive.pipe(
		Layer.provide(MainLive),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))),
	),
).pipe(BunRuntime.runMain)
