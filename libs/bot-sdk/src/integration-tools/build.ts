/**
 * Integration Tools Builder
 *
 * Dynamically builds tools based on enabled integrations.
 */

import type { IntegrationConnection } from "@hazel/domain/models"
import type { IntegrationToolFactory, ToolFactoryOptions } from "./types.ts"

/**
 * Build integration tools based on enabled providers.
 * Only includes tools for integrations that are both:
 * 1. Enabled for the organization
 * 2. Have a registered factory in the factories array
 *
 * @param enabledProviders - Set of enabled integration providers for the org
 * @param factories - Array of tool factories to consider
 * @param options - Options passed to each factory's makeTools function
 * @returns Combined tools from all enabled integration factories
 *
 * @example
 * ```typescript
 * const enabledIntegrations = yield* bot.integration.getEnabled(ctx.orgId)
 *
 * const integrationTools = buildIntegrationTools(
 *   enabledIntegrations,
 *   [LinearToolFactory, GitHubToolFactory],
 *   {
 *     runPromise,
 *     getAccessToken: (provider) => getTokenForProvider(provider),
 *   }
 * )
 *
 * const agent = new ToolLoopAgent({
 *   tools: { ...baseTools, ...integrationTools },
 *   ...
 * })
 * ```
 */
export const buildIntegrationTools = <TTools extends Record<string, unknown>>(
	enabledProviders: Set<IntegrationConnection.IntegrationProvider>,
	factories: IntegrationToolFactory<TTools>[],
	options: ToolFactoryOptions,
): TTools => {
	const tools = {} as TTools

	for (const factory of factories) {
		if (enabledProviders.has(factory.provider)) {
			const factoryTools = factory.makeTools(options)
			Object.assign(tools, factoryTools)
		}
	}

	return tools
}

/**
 * Generate dynamic system prompt instructions based on enabled integrations.
 * Use this to inform the AI about which integrations are available.
 *
 * @param enabledProviders - Set of enabled integration providers
 * @param integrationDescriptions - Map of provider to description of capabilities
 * @returns String describing available integration capabilities
 *
 * @example
 * ```typescript
 * const instructions = generateIntegrationInstructions(enabledIntegrations, {
 *   linear: `
 *     - Manage Linear issues: create, update, fetch, list, search
 *     - List teams and workflow states
 *     - Before creating/updating, confirm with user first
 *   `,
 *   github: `
 *     - Manage GitHub issues and pull requests
 *     - Search repositories and code
 *   `,
 * })
 * ```
 */
export const generateIntegrationInstructions = (
	enabledProviders: Set<IntegrationConnection.IntegrationProvider>,
	integrationDescriptions: Partial<Record<IntegrationConnection.IntegrationProvider, string>>,
): string => {
	const sections: string[] = []

	for (const provider of enabledProviders) {
		const description = integrationDescriptions[provider]
		if (description) {
			sections.push(`## ${capitalize(provider)} Integration\n${description.trim()}`)
		}
	}

	if (sections.length === 0) {
		return ""
	}

	return `\n\n# Available Integrations\n\n${sections.join("\n\n")}`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
