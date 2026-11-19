/**
 * The wire shapes the extension reads (the JSON encoding of `@hazel/domain/customers`): synced rows
 * trimmed to the fields it shows, and `customers.account.detail`. Kept here rather than imported so
 * the extension builds on its own.
 */

export type HealthStatus = "healthy" | "at_risk" | "critical" | "unknown"
export type LifecycleStage = "lead" | "trialing" | "active" | "past_due" | "churned"
export type CustomerSource = "clerk" | "stripe" | "autumn" | "maple" | "hazel"

export interface Organization {
	readonly id: string
	readonly name: string
	readonly slug: string | null
}

/** A `customer_accounts` row. */
export interface Account {
	readonly id: string
	readonly name: string
	readonly domains: ReadonlyArray<string>
	readonly logoUrl: string | null
	readonly lifecycleStage: LifecycleStage
	readonly planName: string | null
	readonly mrrMinor: number
	readonly currency: string
	readonly trialEndsAt: string | null
	readonly healthScore: number | null
	readonly healthStatus: HealthStatus
	readonly seatsUsed: number | null
	readonly seatsLimit: number | null
	readonly contactCount: number
	readonly activeUsers30d: number
	readonly activeUsersTrendPct: number | null
	readonly openRiskHigh: number
	readonly openRiskMedium: number
	readonly openRiskLow: number
	readonly openOpportunities: number
	readonly lastActiveAt: string | null
	readonly firstSeenAt: string
	readonly churnedAt: string | null
	readonly tags: ReadonlyArray<string>
}

/** A `customer_signals` row (open ones are what the list counts). */
export interface Signal {
	readonly id: string
	readonly accountId: string
	readonly kind: "risk" | "opportunity"
	readonly severity: "low" | "medium" | "high"
	readonly status: "open" | "snoozed" | "done" | "dismissed" | "auto_resolved"
	readonly title: string
	readonly reason: string
	readonly openedAt: string
}

/** A `customer_channel_links` row: the account's channel in the org (Hazel, Slack, Discord or Connect). */
export interface ChannelLink {
	readonly id: string
	readonly accountId: string
	readonly channelId: string
}

export interface ExternalRef {
	readonly provider: Exclude<CustomerSource, "hazel">
	readonly entityType: "account" | "contact"
	readonly externalId: string
	/** What the team calls the record (`Production`), set in Hazel. */
	readonly environment: string | null
	readonly externalUrl: string | null
}

export interface Subscription {
	readonly id: string
	readonly provider: string
	readonly planName: string | null
	readonly status: string
	readonly mrrMinor: number
	readonly currency: string
	readonly interval: "month" | "year" | "other"
	readonly quantity: number
	readonly currentPeriodEnd: string | null
	readonly cancelAtPeriodEnd: boolean
	readonly trialEndsAt: string | null
}

export interface Invoice {
	readonly id: string
	readonly number: string | null
	readonly status: string
	readonly amountDueMinor: number
	readonly currency: string
	readonly dueAt: string | null
	readonly attemptCount: number
	readonly declineReason: string | null
	readonly hostedUrl: string | null
}

export interface ContactRow {
	readonly contact: {
		readonly id: string
		readonly name: string | null
		readonly email: string | null
		readonly title: string | null
		readonly role: string | null
		readonly lastSeenAt: string | null
	}
	readonly status: "active" | "dormant" | "never_active"
}

export interface HealthComponent {
	readonly key: "usage" | "engagement" | "billing" | "signals"
	readonly score: number | null
	readonly excluded: boolean
	readonly why: string
}

export interface TimelineEvent {
	readonly id: string
	readonly provider: CustomerSource
	readonly title: string
	readonly occurredAt: string
}

/** `customers.account.detail`. */
export interface AccountDetail {
	readonly account: Account
	readonly refs: ReadonlyArray<ExternalRef>
	readonly subscriptions: ReadonlyArray<Subscription>
	readonly upcomingInvoice: Invoice | null
	readonly openInvoices: ReadonlyArray<Invoice>
	readonly health: {
		readonly score: number | null
		readonly status: HealthStatus
		readonly components: ReadonlyArray<HealthComponent>
	} | null
	readonly contactsToReach: ReadonlyArray<ContactRow>
	readonly recentEvents: ReadonlyArray<TimelineEvent>
}
