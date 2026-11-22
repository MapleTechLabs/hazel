/**
 * An integration's definition (`docs/customers/integrations.md`): the facts core reads about a tool.
 * Browser-safe; the adapter stays behind the dynamic import in `server`.
 */
import type { ConnectionConfig, PrecedenceField } from "@hazel/domain/customers"
import { type Effect, type Option, Schema } from "effect"
import type { HttpClient } from "effect/http"
import type { CustomerProviderAdapter } from "./contract"

/** What a config lets the store do with this integration's account ops, read when an op is applied. */
export interface IngestPolicy {
	readonly matchByDomain: boolean
	readonly createAccounts: boolean
}

export interface BillingCapability {
	/** Lower wins when several bill one account (`billingProviderOf`). */
	readonly preference: number
	/** Its subscriptions count for MRR only once its first import is done. */
	readonly requiresFirstImport?: true
	/** Its invoices are the ones core reads. */
	readonly invoices?: true
	/** Usage billing is read from what its paid invoices charged above the plan. */
	readonly usageFromInvoices?: true
}

export interface IntegrationCapabilities {
	readonly activity?: true
	readonly billing?: BillingCapability
	readonly meteredLimits?: true
	readonly featureFlags?: true
	readonly impersonation?: true
	/** Needs attention covers only customers with a record here by default. */
	readonly attentionDefault?: true
}

export interface IntegrationPresentation {
	readonly name: string
	/** What the tool calls an account record, singular: "organization", "customer". */
	readonly accountNoun: string
}

/** The server half, loaded on demand so the definition stays browser-safe. */
export interface IntegrationServer {
	readonly makeAdapter: Effect.Effect<CustomerProviderAdapter, never, HttpClient.HttpClient>
}

/** `problem`, `changeProblem` and `policy` are methods so a definition widens into the registry's list. */
export interface IntegrationDefinition<
	Id extends string = string,
	Config extends ConnectionConfig = ConnectionConfig,
> {
	readonly id: Id
	readonly config: {
		readonly default: Config
		/** A stored or submitted config through the integration's schema (defaults, dropped keys). */
		readonly decode: (config: ConnectionConfig) => Option.Option<Config>
		/** What the schema cannot say: why this config cannot be saved. */
		problem?(config: Config): string | null
		/** Why this config cannot be saved without a new key, given the account the stored key opened. */
		changeProblem?(config: Config, stored: { readonly externalAccountId: string | null }): string | null
	}
	readonly ingest: {
		/** The hosts its links may point to, subdomains included. */
		readonly linkHosts: ReadonlyArray<string>
		policy?(config: Config): IngestPolicy
	}
	/** Per field, lower wins. A field left out is one this integration never sets first. */
	readonly precedence: Readonly<Partial<Record<PrecedenceField, number>>>
	readonly capabilities: IntegrationCapabilities
	readonly presentation: IntegrationPresentation
	readonly server: () => Promise<IntegrationServer>
}

export const defineIntegration = <
	const Id extends string,
	S extends Schema.Codec<ConnectionConfig & { readonly _tag: Id }, unknown>,
>(definition: {
	readonly id: Id
	readonly config: {
		readonly schema: S
		readonly default: S["Type"]
		problem?(config: S["Type"]): string | null
		changeProblem?(
			config: S["Type"],
			stored: { readonly externalAccountId: string | null },
		): string | null
	}
	readonly ingest: {
		readonly linkHosts: ReadonlyArray<string>
		policy?(config: S["Type"]): IngestPolicy
	}
	readonly precedence: IntegrationDefinition["precedence"]
	readonly capabilities: IntegrationCapabilities
	readonly presentation: IntegrationPresentation
	readonly server: () => Promise<IntegrationServer>
}): IntegrationDefinition<Id, S["Type"]> & { readonly config: { readonly schema: S } } => ({
	...definition,
	config: { ...definition.config, decode: Schema.decodeUnknownOption(definition.config.schema) },
})
