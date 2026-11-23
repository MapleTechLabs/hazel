/** The descriptor table the web app held before each entry moved to its integration, copied as it was. */
export const OLD_DESCRIPTORS = {
	clerk: {
		provider: "clerk",
		name: "Clerk",
		domain: "clerk.com",
		linkHosts: ["dashboard.clerk.com"],
		blurb: "Organizations become accounts, users become contacts, sign-ins feed activity. Source of truth for identity.",
		provides: ["Accounts", "Contacts", "Activity"],
		adds: [
			{
				title: "Accounts",
				detail: "one per Clerk organization",
			},
			{
				title: "Contacts",
				detail: "organization members with roles",
			},
			{
				title: "Activity",
				detail: "sign-ins and sessions per user per day",
			},
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
					{
						from: "id",
						to: "external ref (the shared id Stripe, Autumn and Maple match on)",
					},
					{
						from: "name",
						to: "account.name",
					},
					{
						from: "verified organization domains",
						to: "account.domains",
					},
					{
						from: "image_url",
						to: "account.logoUrl",
					},
					{
						from: "members_count",
						to: "account.seatsUsed",
					},
					{
						from: "max_allowed_memberships",
						to: "account.seatsLimit (0 = unlimited)",
					},
					{
						from: "slug",
						to: "account.attributes.slug",
					},
					{
						from: "created_at",
						to: "account.firstSeenAt",
					},
				],
			},
			{
				group: "Membership → Contact",
				fields: [
					{
						from: "public_user_data.user_id",
						to: "one contact per organization the user is in",
					},
					{
						from: "role_name (else role)",
						to: "contact.role",
					},
					{
						from: "membership created_at",
						to: "contact.joinedAt",
					},
				],
			},
			{
				group: "User → Contact",
				fields: [
					{
						from: "primary email",
						to: "contact.email",
					},
					{
						from: "first_name + last_name",
						to: "contact.name",
					},
					{
						from: "image_url",
						to: "contact.avatarUrl",
					},
					{
						from: "last_sign_in_at",
						to: "contact.lastSignInAt",
					},
					{
						from: "last_active_at",
						to: "contact.lastSeenAt",
					},
				],
			},
			{
				group: "Sign-ins → Activity",
				fields: [
					{
						from: "session.created",
						to: "activity_daily.signedIn (per user per day)",
					},
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
			{
				title: "MRR",
				detail: "from active subscriptions, normalized to monthly",
			},
			{
				title: "Invoices",
				detail: "payment failures and overdue balances",
			},
			{
				title: "Billing signals",
				detail: "payment failing, cancellation scheduled",
			},
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
			{
				resource: "Customers",
				access: "Read",
			},
			{
				resource: "Subscriptions",
				access: "Read",
			},
			{
				resource: "Invoices",
				access: "Read",
			},
			{
				resource: "Products",
				access: "Read",
			},
			{
				resource: "Prices",
				access: "Read",
			},
			{
				resource: "Payment methods",
				access: "Read",
			},
			{
				resource: "Events",
				access: "Read",
			},
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
					{
						from: "email domain",
						to: "domain match, without a shared id",
					},
					{
						from: "name",
						to: "account.name (after Clerk's)",
					},
					{
						from: "email",
						to: "contact.isBillingContact",
					},
				],
			},
			{
				group: "Subscription → Billing",
				fields: [
					{
						from: "items[].price × quantity ÷ interval",
						to: "subscription.mrr (monthly, minor units)",
					},
					{
						from: "coupons",
						to: "mrr after discount (list price kept)",
					},
					{
						from: "product name",
						to: "subscription.planName",
					},
					{
						from: "status",
						to: "subscription.status",
					},
					{
						from: "cancel_at_period_end, cancel_at / cancellation_details",
						to: "cancelAtPeriodEnd / reason",
					},
					{
						from: "trial_end",
						to: "subscription.trialEndsAt",
					},
					{
						from: "default payment method (else the customer's)",
						to: "card brand, last 4, expiry",
					},
				],
			},
			{
				group: "Invoice → Billing",
				fields: [
					{
						from: "amount_due / amount_paid",
						to: "invoice.amountDue / amountPaid",
					},
					{
						from: "due_date / next_payment_attempt",
						to: "invoice.dueAt / nextRetryAt",
					},
					{
						from: "attempt_count",
						to: "invoice.attemptCount",
					},
					{
						from: "hosted_invoice_url",
						to: "invoice.hostedUrl",
					},
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
		blurb: "Plans, metered features and limits. Customers match by Autumn customer id = Clerk org id. Owns the MRR of the accounts it bills.",
		provides: ["Billing", "Usage", "Limits"],
		adds: [
			{
				title: "MRR",
				detail: "from the plans customers hold and the units they prepay, normalized to monthly",
			},
			{
				title: "Feature usage",
				detail: "daily usage per feature as account metrics",
			},
			{
				title: "Plan limits",
				detail: "seats and metered limits, for the near-limit signal",
			},
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
					{
						from: "customer id",
						to: "shared id → the Clerk account",
					},
					{
						from: "email domain",
						to: "domain match, with the shared id off",
					},
					{
						from: "name",
						to: "account.name (after Clerk's)",
					},
					{
						from: "licenses granted / usage",
						to: "account.seatsLimit / seatsUsed",
					},
					{
						from: "created_at",
						to: "account.firstSeenAt",
					},
				],
			},
			{
				group: "Plan → Billing",
				fields: [
					{
						from: "plan price × quantity + prepaid units, per interval",
						to: "subscription.mrr (monthly, minor units)",
					},
					{
						from: "plan name",
						to: "subscription.planName",
					},
					{
						from: "past_due / trial_ends_at / expired",
						to: "subscription.status",
					},
					{
						from: "canceled_at (not on a scheduled downgrade)",
						to: "cancelAtPeriodEnd, canceledAt",
					},
					{
						from: "current_period_end (else expires_at)",
						to: "subscription.currentPeriodEnd",
					},
				],
			},
			{
				group: "Feature balance → Metrics",
				fields: [
					{
						from: "balance usage",
						to: "metric_daily.value (autumn.<feature>)",
					},
					{
						from: "balance granted (when overage is refused)",
						to: "metric_daily.limitValue",
					},
					{
						from: "balances.limit_reached",
						to: "timeline: usage.limit_reached",
					},
					{
						from: "balances.usage_alert_triggered",
						to: "timeline: usage.limit_approaching",
					},
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
			{
				title: "Activity",
				detail: "product events per user per day",
			},
			{
				title: "Usage metrics",
				detail: "event counts per account per day",
			},
			{
				title: "Usage signals",
				detail: "usage dropped, champion went quiet",
			},
		],
		accessNote:
			"Read-only. Hazel runs one counting query per day of product events and never writes to Maple.",
		isAvailable: true,
		apiKey: {
			label: "API key",
			placeholder: "maple_ak_…",
			createHref: "https://app.maple.dev/settings?tab=mcp",
			help: "Maple → Settings → MCP creates the narrowest key that works (it opens the MCP tools and nothing else); a key from Settings → Keys works too. An EU organization creates its key on app.eu.maple.dev. Hazel reads the organization from the key.",
		},
		permissions: [
			{
				resource: "MCP tools",
				access: "Read",
			},
		],
		webhook: null,
		syncMode: "Scheduled pull · hourly",
		configFields: [
			{
				_tag: "Select",
				key: "region",
				label: "Region",
				description:
					"Where the Maple organization lives. A key of one region is rejected by the other.",
				options: [
					{
						value: "us",
						label: "US",
					},
					{
						value: "eu",
						label: "EU",
					},
				],
			},
		],
		mapping: [
			{
				group: "Event → Account and contact",
				fields: [
					{
						from: "GroupId",
						to: "shared id → the Clerk account (never created here)",
					},
					{
						from: "UserId",
						to: "shared id → the Clerk contact (never created here)",
					},
					{
						from: "an unknown GroupId",
						to: "unmatched record, with its event count",
					},
				],
			},
			{
				group: "Event → Activity",
				fields: [
					{
						from: "events per day, per user",
						to: "activity_daily.eventCount",
					},
					{
						from: "distinct SessionId per day",
						to: "activity_daily.sessionCount",
					},
					{
						from: "a day with any event",
						to: "active users, usage trend, last active",
					},
				],
			},
			{
				group: "Event → Metrics",
				fields: [
					{
						from: "mapped event count per day",
						to: "metric_daily.value (maple.<key>)",
					},
					{
						from: "events sharing a key",
						to: "summed into it",
					},
				],
			},
		],
		docsHref: "https://maple.dev/docs/reference/mcp",
		dashboardHref: "https://app.maple.dev",
	},
} as const
