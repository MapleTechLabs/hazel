import type { PresentationOf } from "../kit/presentation"
import type { StripeConnectionConfig } from "./config"

export const presentation: PresentationOf<StripeConnectionConfig> = {
	name: "Stripe",
	accountNoun: "customer",
	domain: "stripe.com",
	linkHosts: ["*.stripe.com"],
	blurb: "Subscriptions, invoices and MRR. Customers match by their Clerk organization id, then email domain.",
	setupSummary: "Subscriptions, invoices and MRR.",
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
	suggested: "billing",
	sharedIdLabel: "metadata.clerk_org_id",
}
