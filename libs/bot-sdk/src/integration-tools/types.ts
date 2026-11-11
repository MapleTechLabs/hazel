/**
 * Integration Tool Factory Types
 *
 * Provides a standardized pattern for creating tools that are conditionally
 * available based on enabled integrations.
 */

import type { IntegrationConnection } from "@hazel/domain/models"
import type { Effect } from "effect"

/**
 * Result of getting an access token
 */
export type TokenResult = { ok: true; accessToken: string } | { ok: false; error: string }

/**
 * Options passed to tool factories when building tools
 */
export interface ToolFactoryOptions {
	/**
	 * Run an Effect and return a Promise of the result.
	 * Used for executing Effect-based operations in async tool handlers.
	 */
	runPromise: <A>(effect: Effect.Effect<A, any, any>) => Promise<A>

	/**
	 * Get an access token for a specific integration provider.
	 * Returns a result object indicating success or failure.
	 */
	getAccessToken: (provider: IntegrationConnection.IntegrationProvider) => Promise<TokenResult>
}

/**
 * A factory that creates tools for a specific integration provider.
 * The TTools type is intentionally generic to allow any tool implementation
 * (e.g., Vercel AI SDK tools, LangChain tools, etc.)
 *
 * @example
 * ```typescript
 * // Using with Vercel AI SDK
 * import { tool } from "ai"
 *
 * export const LinearToolFactory: IntegrationToolFactory = {
 *   provider: "linear",
 *   makeTools: (options) => ({
 *     linear_create_issue: tool({ ... }),
 *     linear_list_issues: tool({ ... }),
 *   }),
 * }
 * ```
 */
export interface IntegrationToolFactory<TTools = Record<string, unknown>> {
	/**
	 * The integration provider this factory creates tools for
	 */
	provider: IntegrationConnection.IntegrationProvider

	/**
	 * Create the tools for this integration.
	 * Only called when the integration is enabled for the organization.
	 */
	makeTools: (options: ToolFactoryOptions) => TTools
}
