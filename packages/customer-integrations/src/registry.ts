/**
 * The one place integrations are registered, and every lookup derived from them
 * (`docs/customers/integrations.md`). To add one: a new folder, and its entry in `integrations`.
 */
import type {
	AttentionSettings,
	ConnectionConfig,
	CustomerProvider,
	CustomerSource,
	SignalTemplate,
	SourceCapability,
} from "@hazel/domain/customers"
import { AttentionStage, PRECEDENCE_FIELDS, TEMPLATES } from "@hazel/domain/customers"
import { Option, Schema } from "effect"
import { autumn } from "./autumn"
import { clerk } from "./clerk"
import type { DemoRole, IntegrationDemo } from "./kit/demo"
import type { IngestPolicy, IntegrationDefinition } from "./kit/define"
import { maple } from "./maple"
import { stripe } from "./stripe"

/** In the order sources are listed. */
export const integrations = [clerk, stripe, autumn, maple] as const

type Registered = (typeof integrations)[number]

/** A registered provider id, for what must refuse any other. */
export const IntegrationId = Schema.Literals(integrations.map((integration) => integration.id))
export type IntegrationId = Registered["id"]

/** A config of any registered integration, decoded. */
export const IntegrationConfig = Schema.Union(integrations.map((integration) => integration.config.schema))
export type IntegrationConfig = typeof IntegrationConfig.Type

const byId: ReadonlyMap<string, IntegrationDefinition> = new Map(
	integrations.map((integration) => [integration.id, integration]),
)

export const integrationOf = (provider: CustomerProvider): IntegrationDefinition | undefined =>
	byId.get(provider)

export const isIntegrationId = (provider: CustomerProvider): provider is IntegrationId => byId.has(provider)

/** A provider id from outside (a URL, a route param): any string the registry knows. */
export const RegisteredProvider = Schema.String.check(
	Schema.makeFilter((provider: string) => (byId.has(provider) ? undefined : "Unknown provider")),
)

/** Each integration's default config, by id. */
export const DEFAULT_CONNECTION_CONFIG = Object.fromEntries(
	integrations.map((integration) => [integration.id, integration.config.default]),
) as { readonly [I in Registered as I["id"]]: I["config"]["default"] }

/** A provider's default config; for an id this build does not know, a config holding nothing. */
export const defaultConfigOf = (provider: CustomerProvider): ConnectionConfig =>
	byId.get(provider)?.config.default ?? { _tag: provider }

const OPEN_POLICY: IngestPolicy = { matchByDomain: true, createAccounts: true }

/** What the connection's current config allows; read when an op is applied, parked ops included. */
export const ingestPolicyOf = (config: ConnectionConfig | null): IngestPolicy => {
	if (config === null) return OPEN_POLICY
	const integration = byId.get(config._tag)
	if (integration === undefined) return OPEN_POLICY
	const decoded = integration.config.decode(config)
	return Option.isNone(decoded) ? OPEN_POLICY : (integration.ingest.policy?.(decoded.value) ?? OPEN_POLICY)
}

const idsWhere = (test: (integration: Registered) => boolean): ReadonlyArray<CustomerProvider> =>
	integrations.filter(test).map((integration) => integration.id)

export const activityProviders = idsWhere((integration) => integration.capabilities.activity === true)

/** In registry order; `billingPreferenceOrder` is the order MRR picks a source in. */
export const billingProviders = idsWhere((integration) => integration.capabilities.billing !== undefined)

const billingOf = (integration: Registered) => integration.capabilities.billing

/** Best first: `billingProviderOf` walks these. */
export const billingPreferenceOrder: ReadonlyArray<{
	readonly provider: CustomerProvider
	readonly requiresFirstImport: boolean
}> = integrations
	.flatMap((integration) => {
		const billing = billingOf(integration)
		return billing === undefined ? [] : [{ provider: integration.id, billing }]
	})
	.sort((a, b) => a.billing.preference - b.billing.preference)
	.map(({ provider, billing }) => ({
		provider,
		requiresFirstImport: billing.requiresFirstImport === true,
	}))

export const firstImportProviders = billingPreferenceOrder
	.filter((entry) => entry.requiresFirstImport)
	.map((entry) => entry.provider)

/** The sources whose invoices core reads. */
export const invoiceProviders = idsWhere((integration) => billingOf(integration)?.invoices === true)

/** The sources whose paid invoices carry usage billing on top of the plan. */
export const usageInvoiceProviders = idsWhere(
	(integration) => billingOf(integration)?.usageFromInvoices === true,
)

export const featureFlagsIntegration: IntegrationDefinition | undefined = integrations.find(
	(integration) => integration.capabilities.featureFlags,
)

/** The sources with metered features and plan limits. */
export const meteredProviders = idsWhere((integration) => integration.capabilities.meteredLimits === true)

export const impersonationIntegration: IntegrationDefinition | undefined = integrations.find(
	(integration) => integration.capabilities.impersonation,
)

const suggestedIntegration = (kind: "start" | "billing"): IntegrationDefinition =>
	integrations.find((integration) => integration.presentation.suggested === kind) ?? integrations[0]

/** Where first-run copy tells a new organization to start. */
export const startingIntegration = suggestedIntegration("start")

/** The billing source first-run copy suggests adding, and the primary of the connect buttons. */
export const suggestedBillingIntegration = suggestedIntegration("billing")

type DemoOf<Role extends DemoRole> = Extract<IntegrationDemo, { readonly role: Role }>

const plays = <Role extends DemoRole>(demo: IntegrationDemo | undefined, role: Role): demo is DemoOf<Role> =>
	demo?.role === role

/** The integration playing `role` in the demo book and the lab. */
export const demoSource = <Role extends DemoRole>(
	role: Role,
): { readonly id: IntegrationId; readonly name: string; readonly demo: DemoOf<Role> } => {
	for (const integration of integrations) {
		const demo: IntegrationDemo | undefined = integration.demo
		if (plays(demo, role)) return { id: integration.id, name: integration.presentation.name, demo }
	}
	throw new Error(`No integration plays the demo role "${role}"`)
}

const providersFor = {
	activity: activityProviders,
	billing: billingProviders,
	meteredLimits: meteredProviders,
} satisfies Record<SourceCapability, ReadonlyArray<CustomerProvider>>

/** The sources a template needs at least one of; none for a template that reads no source. */
export const requiredSourcesOf = (template: SignalTemplate): ReadonlyArray<CustomerProvider> => {
	const capability = TEMPLATES[template].requiredCapability
	return capability === null ? [] : providersFor[capability]
}

/** Customers that have not churned and have a record in a default attention source. */
export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = {
	stages: AttentionStage.literals,
	requiredSources: idsWhere((integration) => integration.capabilities.attentionDefault === true),
}

/**
 * Who may set an account or contact field, best first. A source writes a field only when no better
 * source set it (`fieldSources`); `hazel` (a manual edit) leads the fields it can edit. Fields not
 * listed are written by any source.
 */
export const FIELD_PRECEDENCE: ReadonlyMap<string, ReadonlyArray<CustomerSource>> = new Map(
	PRECEDENCE_FIELDS.map(({ field, manual }) => {
		const ranked = integrations
			.flatMap((integration) => {
				const rank = integration.precedence[field]
				return rank === undefined ? [] : [{ id: integration.id, rank }]
			})
			.sort((a, b) => a.rank - b.rank)
			.map(({ id }): CustomerSource => id)
		return [field, manual ? ["hazel", ...ranked] : ranked]
	}),
)
