/**
 * What the Customers pages say about each data source (`docs/customers/tech-design.md` §5): its
 * name, what it writes into the customer model, how it connects (API key, webhook, required
 * permissions), which of its `ConnectionConfig` fields the connect form shows, and how its records
 * map to Hazel fields. The pages render these generically; a provider integration PR fills in its
 * entry (and flips `isAvailable`) instead of touching page code.
 */
import {
	type ConnectionConfig,
	type CustomerProvider,
	type CustomerSource,
	DEFAULT_CONNECTION_CONFIG,
	type SignalTemplate,
	TEMPLATES,
} from "@hazel/domain/customers"
import type { CustomerConnectionId, OrganizationId } from "@hazel/schema"

/** A boolean or text field of the provider's `ConnectionConfig`, shown in the connect form. */
export type ConfigField<P extends CustomerProvider> =
	| Readonly<{
			_tag: "Toggle"
			key: BooleanKeys<ConfigOf<P>>
			label: string
			description: string
	  }>
	| Readonly<{
			_tag: "Text"
			key: StringKeys<ConfigOf<P>>
			label: string
			description: string
			placeholder: string
			/** Shown in a monospace input (ids, keys). */
			isCode: boolean
	  }>

export type ConfigOf<P extends CustomerProvider> = Extract<ConnectionConfig, { readonly _tag: P }>
type BooleanKeys<C> = { [K in keyof C]: C[K] extends boolean ? K : never }[keyof C] & string
type StringKeys<C> = {
	[K in keyof C]: C[K] extends string ? (K extends "_tag" ? never : K) : never
}[keyof C] &
	string

/** One permission the API key needs, e.g. Stripe `Invoices: Read`. */
export interface ProviderPermission {
	readonly resource: string
	readonly access: string
}

/** A row of the source detail's field mapping preview. */
export interface FieldMapping {
	readonly from: string
	readonly to: string
}

export interface ProviderDescriptor<P extends CustomerProvider = CustomerProvider> {
	readonly provider: P
	readonly name: string
	/** Brandfetch domain for the logo (the kit's `sourceMark` uses the same). */
	readonly domain: string
	/** The hosts its record and invoice links may point to (`*.` takes any subdomain): see `safeSourceUrl`. */
	readonly linkHosts: ReadonlyArray<string>
	/** One line under the name. */
	readonly blurb: string
	/** Chips on the source card: what it writes. */
	readonly provides: ReadonlyArray<string>
	/** The not-connected card's "Adds to the model" list. */
	readonly adds: ReadonlyArray<Readonly<{ title: string; detail: string }>>
	/** The connect modal's subtitle, e.g. "Read-only. Hazel reads … and never writes to Stripe." */
	readonly accessNote: string
	/**
	 * Whether the backend has an adapter (`CustomerProviders.layer`). While false the pages show
	 * "Coming soon" and Connect still answers `CustomerProviderUnavailableError` if tried.
	 */
	readonly isAvailable: boolean
	readonly apiKey: Readonly<{
		label: string
		placeholder: string
		/** Where to create the key. */
		createHref: string
		help: string
	}>
	/** The key's required scopes; the connect modal lists them, the failure state highlights the missing one. */
	readonly permissions: ReadonlyArray<ProviderPermission>
	/** Null: no webhooks (pulled on a schedule only). */
	readonly webhook: Readonly<{
		/** Where in the provider to add the endpoint. */
		instructions: string
		/** Event types to subscribe. */
		events: ReadonlyArray<string>
		secretLabel: string
		secretPlaceholder: string
	}> | null
	/** "Webhooks + hourly sync", "Scheduled pull · hourly". */
	readonly syncMode: string
	/** The connect form's matching / identity options, in order. */
	readonly configFields: ReadonlyArray<ConfigField<P>>
	/** The source detail's mapping preview, grouped ("Organization → Account"). */
	readonly mapping: ReadonlyArray<Readonly<{ group: string; fields: ReadonlyArray<FieldMapping> }>>
	readonly docsHref: string
	/** Link to a record in the provider's dashboard, when it has one. */
	readonly dashboardHref: string
}

type Descriptors = { readonly [P in CustomerProvider]: ProviderDescriptor<P> }

export const PROVIDERS: Descriptors = {
	clerk: {
		provider: "clerk",
		name: "Clerk",
		domain: "clerk.com",
		linkHosts: ["dashboard.clerk.com"],
		blurb: "Organizations become accounts, users become contacts, sign-ins feed activity. Source of truth for identity.",
		provides: ["Accounts", "Contacts", "Activity"],
		adds: [
			{ title: "Accounts", detail: "one per Clerk organization" },
			{ title: "Contacts", detail: "organization members with roles" },
			{ title: "Activity", detail: "sign-ins and sessions per user per day" },
		],
		accessNote:
			"Read-only. Hazel reads organizations, memberships, domains and sessions and never writes to Clerk.",
		isAvailable: true,
		apiKey: {
			label: "Secret key",
			placeholder: "sk_live_…",
			createHref: "https://dashboard.clerk.com/last-active?path=api-keys",
			help: "Clerk Dashboard → Configure → API keys → Secret keys. Copy the key of the instance whose customers you track: an sk_test_… key reads your development instance, sk_live_… your production one.",
		},
		// Clerk secret keys are not scoped, so there is nothing to tick: the key reads the instance.
		permissions: [],
		webhook: {
			instructions:
				"In Clerk Dashboard → Configure → Webhooks, add an endpoint with this URL, subscribe the events below, then copy its signing secret here. Without it Hazel still syncs, but only every few hours.",
			events: [
				"organization.created",
				"organization.updated",
				"organization.deleted",
				"organizationMembership.created",
				"organizationMembership.updated",
				"organizationMembership.deleted",
				"user.created",
				"user.updated",
				"user.deleted",
				"session.created",
			],
			secretLabel: "Signing secret",
			secretPlaceholder: "whsec_…",
		},
		syncMode: "Webhooks + full sync every 6 hours",
		configFields: [
			{
				_tag: "Toggle",
				key: "createAccounts",
				label: "Create accounts for new organizations",
				description:
					"Every Clerk organization becomes an account. Off: organizations wait under unmatched records until someone links them.",
			},
		],
		mapping: [
			{
				group: "Organization → Account",
				fields: [
					{ from: "id", to: "external ref (the shared id Stripe, Autumn and Maple match on)" },
					{ from: "name", to: "account.name" },
					{ from: "verified organization domains", to: "account.domains" },
					{ from: "image_url", to: "account.logoUrl" },
					{ from: "members_count", to: "account.seatsUsed" },
					{ from: "max_allowed_memberships", to: "account.seatsLimit (0 = unlimited)" },
					{ from: "slug", to: "account.attributes.slug" },
					{ from: "created_at", to: "account.firstSeenAt" },
				],
			},
			{
				group: "Membership → Contact",
				fields: [
					{ from: "public_user_data.user_id", to: "one contact per organization the user is in" },
					{ from: "role_name (else role)", to: "contact.role" },
					{ from: "membership created_at", to: "contact.joinedAt" },
				],
			},
			{
				group: "User → Contact",
				fields: [
					{ from: "primary email", to: "contact.email" },
					{ from: "first_name + last_name", to: "contact.name" },
					{ from: "image_url", to: "contact.avatarUrl" },
					{ from: "last_sign_in_at", to: "contact.lastSignInAt" },
					{ from: "last_active_at", to: "contact.lastSeenAt" },
				],
			},
			{
				group: "Sign-ins → Activity",
				fields: [
					{ from: "session.created", to: "activity_daily.signedIn (per user per day)" },
					{
						from: "last_sign_in_at / last_active_at",
						to: "activity_daily (the days a sync can see)",
					},
				],
			},
		],
		docsHref: "https://clerk.com/docs/webhooks/overview",
		dashboardHref: "https://dashboard.clerk.com",
	},
	stripe: {
		provider: "stripe",
		name: "Stripe",
		domain: "stripe.com",
		linkHosts: ["*.stripe.com"],
		blurb: "Subscriptions, invoices and MRR. Customers match by their Clerk organization id, then email domain.",
		provides: ["Billing", "Account links"],
		adds: [
			{ title: "MRR", detail: "from active subscriptions, normalized to monthly" },
			{ title: "Invoices", detail: "payment failures and overdue balances" },
			{ title: "Billing signals", detail: "payment failing, cancellation scheduled" },
		],
		accessNote:
			"Read-only. Hazel reads customers, products, subscriptions, invoices and events and never writes to Stripe.",
		isAvailable: true,
		apiKey: {
			label: "Restricted API key",
			placeholder: "rk_live_…",
			createHref: "https://dashboard.stripe.com/apikeys/create",
			help: "Stripe Dashboard → Developers → API keys → Create restricted key. Give it Read access to the resources below and leave everything else None, and enter your account id below. A secret key works too; a restricted one is safer. Connecting reads one record of each resource, so a missing permission is named right away.",
		},
		permissions: [
			{ resource: "Customers", access: "Read" },
			{ resource: "Subscriptions", access: "Read" },
			{ resource: "Invoices", access: "Read" },
			{ resource: "Products", access: "Read" },
			{ resource: "Prices", access: "Read" },
			{ resource: "Payment methods", access: "Read" },
			{ resource: "Events", access: "Read" },
		],
		webhook: {
			instructions:
				"In Stripe Dashboard → Developers → Webhooks, add an endpoint with this URL, subscribe the events below, then copy its signing secret here. Without it every change still arrives, but up to 6 hours late: a failed payment or a cancellation shows on the next sync.",
			events: [
				"customer.created",
				"customer.updated",
				"customer.deleted",
				"customer.subscription.created",
				"customer.subscription.updated",
				"customer.subscription.deleted",
				"customer.subscription.paused",
				"customer.subscription.resumed",
				"invoice.finalized",
				"invoice.paid",
				"invoice.payment_failed",
				"invoice.payment_action_required",
				"invoice.voided",
				"invoice.marked_uncollectible",
				"payment_method.attached",
				"payment_method.updated",
				"payment_method.automatically_updated",
				"payment_method.detached",
			],
			secretLabel: "Signing secret",
			secretPlaceholder: "whsec_…",
		},
		syncMode: "Webhooks, plus every change since the last sync every 6 hours",
		configFields: [
			{
				_tag: "Text",
				key: "accountId",
				label: "Account id",
				description:
					"Stripe Dashboard → Settings → Business → Account details. Required with a restricted key, which cannot read its own account.",
				placeholder: "acct_…",
				isCode: true,
			},
			{
				_tag: "Text",
				key: "clerkOrgMetadataKey",
				label: "Metadata key",
				description:
					"The customer metadata key whose value is the Clerk organization id. A customer with no value under it falls back to Autumn's autumn_id when that is one (org_…), so an Autumn-managed account needs no setting.",
				placeholder: "clerk_org_id",
				isCode: true,
			},
			{
				_tag: "Toggle",
				key: "matchByDomain",
				label: "Email domain",
				description:
					"Customer email domain = account domain. Skips gmail.com, outlook.com and other free providers. Off: customers with no shared id wait under unmatched records.",
			},
		],
		mapping: [
			{
				group: "Customer → Account link",
				fields: [
					{
						from: "metadata.clerk_org_id (else an org_… autumn_id)",
						to: "shared id → the Clerk account",
					},
					{ from: "email domain", to: "domain match, without a shared id" },
					{ from: "name", to: "account.name (after Clerk's)" },
					{ from: "email", to: "contact.isBillingContact" },
				],
			},
			{
				group: "Subscription → Billing",
				fields: [
					{
						from: "items[].price × quantity ÷ interval",
						to: "subscription.mrr (monthly, minor units)",
					},
					{ from: "coupons", to: "mrr after discount (list price kept)" },
					{ from: "product name", to: "subscription.planName" },
					{ from: "status", to: "subscription.status" },
					{
						from: "cancel_at_period_end, cancel_at / cancellation_details",
						to: "cancelAtPeriodEnd / reason",
					},
					{ from: "trial_end", to: "subscription.trialEndsAt" },
					{
						from: "default payment method (else the customer's)",
						to: "card brand, last 4, expiry",
					},
				],
			},
			{
				group: "Invoice → Billing",
				fields: [
					{ from: "amount_due / amount_paid", to: "invoice.amountDue / amountPaid" },
					{ from: "due_date / next_payment_attempt", to: "invoice.dueAt / nextRetryAt" },
					{ from: "attempt_count", to: "invoice.attemptCount" },
					{ from: "hosted_invoice_url", to: "invoice.hostedUrl" },
				],
			},
		],
		docsHref: "https://docs.stripe.com/keys#limit-access",
		dashboardHref: "https://dashboard.stripe.com",
	},
	autumn: {
		provider: "autumn",
		name: "Autumn",
		domain: "useautumn.com",
		linkHosts: ["*.useautumn.com"],
		blurb: "Plans, metered features and limits. Customers match by Autumn customer id = Clerk org id. Owns the MRR while connected.",
		provides: ["Billing", "Usage", "Limits"],
		adds: [
			{ title: "MRR", detail: "from the plans customers hold, normalized to monthly" },
			{ title: "Feature usage", detail: "daily usage per feature as account metrics" },
			{ title: "Plan limits", detail: "seats and metered limits, for the near-limit signal" },
		],
		accessNote:
			"Read-only. Hazel reads your organization, plans, features, customers and their plans, and never writes to Autumn.",
		isAvailable: true,
		apiKey: {
			label: "Secret key",
			placeholder: "am_sk_live_…",
			createHref: "https://app.useautumn.com/dev",
			help: "Autumn → Developer → Keys. Copy the key of the environment whose customers you track: an am_sk_test_… key reads your sandbox, am_sk_live_… your live data. Connecting reads one record of each resource, so a key that cannot read one is named right away.",
		},
		// Autumn secret keys are not scoped per resource: the key reads its organization's environment.
		permissions: [],
		webhook: {
			instructions:
				"In Autumn → Developer → Webhooks, add an endpoint with this URL, subscribe the events below, then copy its signing secret here. Without it every change still arrives, but up to 6 hours late: a plan change or a limit reached shows on the next sync.",
			events: ["billing.updated", "balances.limit_reached", "balances.usage_alert_triggered"],
			secretLabel: "Signing secret",
			secretPlaceholder: "whsec_…",
		},
		syncMode: "Webhooks + full sync every 6 hours",
		configFields: [
			{
				_tag: "Toggle",
				key: "customerIdIsClerkOrgId",
				label: "Customer id is the Clerk organization id",
				description:
					"Link Autumn customers to accounts by id, which is how an app that creates its Autumn customer per organization keys them. Off: customers are matched by their email domain instead, and the rest wait under unmatched records.",
			},
		],
		mapping: [
			{
				group: "Customer → Account link",
				fields: [
					{ from: "customer id", to: "shared id → the Clerk account" },
					{ from: "email domain", to: "domain match, with the shared id off" },
					{ from: "name", to: "account.name (after Clerk's)" },
					{ from: "licenses granted / usage", to: "account.seatsLimit / seatsUsed" },
					{ from: "created_at", to: "account.firstSeenAt" },
				],
			},
			{
				group: "Plan → Billing",
				fields: [
					{
						from: "plan price × quantity ÷ interval",
						to: "subscription.mrr (monthly, minor units)",
					},
					{ from: "plan name", to: "subscription.planName" },
					{ from: "past_due / trial_ends_at / expired", to: "subscription.status" },
					{ from: "canceled_at", to: "cancelAtPeriodEnd, canceledAt" },
					{ from: "current_period_end (else expires_at)", to: "subscription.currentPeriodEnd" },
				],
			},
			{
				group: "Feature balance → Metrics",
				fields: [
					{ from: "balance usage", to: "metric_daily.value (autumn.<feature>)" },
					{ from: "balance granted", to: "metric_daily.limitValue" },
					{ from: "balances.limit_reached", to: "timeline: usage.limit_reached" },
					{ from: "balances.usage_alert_triggered", to: "timeline: usage.limit_approaching" },
				],
			},
		],
		docsHref: "https://docs.useautumn.com/documentation/webhooks",
		dashboardHref: "https://app.useautumn.com",
	},
	maple: {
		provider: "maple",
		name: "Maple",
		domain: "maple.dev",
		linkHosts: ["*.maple.dev"],
		blurb: "Product events by GroupId and UserId. Drives active users, usage trends and per-account metrics.",
		provides: ["Usage", "Activity"],
		adds: [
			{ title: "Activity", detail: "product events per user per day" },
			{ title: "Usage metrics", detail: "event counts per account per day" },
			{ title: "Usage signals", detail: "usage dropped, champion went quiet" },
		],
		accessNote: "Read-only key with the events:read scope. Hazel queries Maple; Maple never calls Hazel.",
		isAvailable: false,
		apiKey: {
			label: "API key",
			placeholder: "mpl_live_…",
			createHref: "https://app.maple.dev/settings/api-keys",
			help: "Settings → API keys in Maple, with the events:read scope.",
		},
		permissions: [{ resource: "Events", access: "Read" }],
		webhook: null,
		syncMode: "Scheduled pull · hourly",
		configFields: [
			{
				_tag: "Text",
				key: "mapleOrgId",
				label: "Maple organization",
				description: "The organization whose product events Hazel reads.",
				placeholder: "org_…",
				isCode: true,
			},
			{
				_tag: "Text",
				key: "accountKey",
				label: "Account key",
				description: "The event property that names the account (a Clerk org id).",
				placeholder: "GroupId",
				isCode: true,
			},
			{
				_tag: "Text",
				key: "userKey",
				label: "User key",
				description: "The event property that names the user (a Clerk user id).",
				placeholder: "UserId",
				isCode: true,
			},
		],
		mapping: [
			{
				group: "Event → Activity",
				fields: [
					{ from: "GroupId", to: "account (Clerk org id)" },
					{ from: "UserId", to: "contact (Clerk user id)" },
					{ from: "timestamp (day)", to: "activity_daily.eventCount" },
				],
			},
			{
				group: "Event → Metric",
				fields: [{ from: "mapped event count", to: "metric_daily.value" }],
			},
		],
		docsHref: "https://maple.dev/docs",
		dashboardHref: "https://app.maple.dev",
	},
}

export const PROVIDER_ORDER: ReadonlyArray<CustomerProvider> = ["clerk", "stripe", "autumn", "maple"]

export const providerOf = <P extends CustomerProvider>(provider: P): ProviderDescriptor<P> =>
	PROVIDERS[provider] as ProviderDescriptor<P>

/**
 * `url` (provider data: a record's or an invoice's page) if it is https on one of `source`'s
 * `linkHosts`; anything else gets no link.
 */
export const safeSourceUrl = (source: CustomerSource, url: string | null): string | null => {
	if (url === null || source === "hazel") return null
	try {
		const { protocol, hostname } = new URL(url)
		const isOwnHost = PROVIDERS[source].linkHosts.some((host) =>
			host.startsWith("*.") ? hostname.endsWith(host.slice(1)) : hostname === host,
		)
		return protocol === "https:" && isOwnHost ? url : null
	} catch {
		return null
	}
}

/** The config a new connection starts from. */
export const defaultConfigOf = <P extends CustomerProvider>(provider: P): ConnectionConfig & { _tag: P } =>
	DEFAULT_CONNECTION_CONFIG[provider]

/**
 * The endpoint a provider posts webhooks to (`routes/customers-webhooks.http.ts`): the org and
 * connection ids are in the path, the signature is the auth. Known once the connection exists.
 */
export const webhookUrlOf = (
	backendUrl: string,
	provider: CustomerProvider,
	organizationId: OrganizationId,
	connectionId: CustomerConnectionId,
): string => `${backendUrl}/webhooks/customers/${provider}/${organizationId}/${connectionId}`

/** "Clerk or Maple", "Stripe or Autumn", "Autumn"; empty: built in (needs no source). */
export const sourcesLabel = (sources: ReadonlyArray<CustomerSource>): string =>
	sources.map((source) => (source === "hazel" ? "Hazel" : PROVIDERS[source].name)).join(" or ")

/** A template can match with any one of its sources connected; none listed = always available. */
export const isTemplateAvailable = (
	template: SignalTemplate,
	connected: ReadonlyArray<CustomerProvider>,
): boolean => {
	const required = TEMPLATES[template].requiredSources
	return required.length === 0 || required.some((provider) => connected.includes(provider))
}
