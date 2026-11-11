/**
 * Integration Tools
 *
 * Provides a pattern for conditionally including AI tools based on enabled integrations.
 *
 * @example
 * ```typescript
 * import {
 *   buildIntegrationTools,
 *   generateIntegrationInstructions,
 *   type IntegrationToolFactory,
 *   type ToolFactoryOptions,
 * } from "@hazel-chat/bot-sdk"
 *
 * // Define your tool factory (specific to your AI SDK)
 * const LinearToolFactory: IntegrationToolFactory = {
 *   provider: "linear",
 *   makeTools: (options) => ({
 *     linear_create_issue: tool({ ... }),
 *   }),
 * }
 *
 * // Get enabled integrations for the org
 * const enabled = yield* bot.integration.getEnabled(ctx.orgId)
 *
 * // Build tools for enabled integrations only
 * const tools = buildIntegrationTools(enabled, [LinearToolFactory], {
 *   runPromise,
 *   getAccessToken: (provider) => getToken(provider),
 * })
 *
 * // Generate dynamic instructions
 * const instructions = generateIntegrationInstructions(enabled, {
 *   linear: "Manage Linear issues...",
 * })
 * ```
 */

export * from "./types.ts"
export * from "./build.ts"
