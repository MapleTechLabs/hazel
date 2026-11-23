/**
 * What an integration brings to the demo book and the lab (`docs/customers/integrations.md`): the
 * id shapes, links and sample config only it knows. Plain data and pure functions, so browser-safe.
 * One integration plays each role.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"

/** Whose sample links: the demo seed, the lab's fixtures, or a gallery. */
export type DemoScope = "seed" | "lab" | "gallery"

/** The accounts and people everything else links to by their shared id. */
export interface DirectoryDemo {
	readonly role: "directory"
	readonly accountId: (sequence: string) => string
	readonly contactId: (sequence: string) => string
	readonly adminRole: string
	readonly memberRole: string
	readonly accountUrl: (externalId: string, scope: DemoScope) => string
	readonly contactUrl: (externalId: string) => string
	readonly logoUrl: (externalId: string) => string
}

/** Subscriptions, metered usage and limits. */
export interface PlansDemo {
	readonly role: "plans"
}

/** Billing customers and their invoices. */
export interface InvoicesDemo {
	readonly role: "invoices"
	readonly customerId: (sequence: string) => string
	readonly invoiceId: (sequence: string) => string
	readonly customerUrl: (externalId: string) => string
	readonly invoiceUrl: (externalId: string, scope: Exclude<DemoScope, "gallery">) => string
}

/** Daily product activity per contact. */
export interface ActivityDemo {
	readonly role: "activity"
	readonly accountUrl: (externalId: string) => string
	/** A config with its settings filled in, for the settings page's fixtures. */
	readonly sampleConfig: ConnectionConfig
}

export type IntegrationDemo = DirectoryDemo | PlansDemo | InvoicesDemo | ActivityDemo
export type DemoRole = IntegrationDemo["role"]
