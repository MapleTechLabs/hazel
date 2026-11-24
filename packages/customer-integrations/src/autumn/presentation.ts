import type { PresentationOf } from "../kit/presentation"
import type { AutumnConnectionConfig } from "./config"

export const presentation: PresentationOf<AutumnConnectionConfig> = {
	name: "Autumn",
	accountNoun: "customer",
	domain: "useautumn.com",
	linkHosts: ["*.useautumn.com"],
	blurb: "Plans, metered features and limits. Customers match by Autumn customer id = Clerk org id. Owns the MRR of the accounts it bills.",
	setupSummary: "Plans, metered features and limits.",
	provides: ["Billing", "Usage", "Limits"],
	adds: [
		{
			title: "MRR",
			detail: "from the plans customers hold and the units they prepay, normalized to monthly",
		},
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
					from: "plan price × quantity + prepaid units, per interval",
					to: "subscription.mrr (monthly, minor units)",
				},
				{ from: "plan name", to: "subscription.planName" },
				{ from: "past_due / trial_ends_at / expired", to: "subscription.status" },
				{
					from: "canceled_at (not on a scheduled downgrade)",
					to: "cancelAtPeriodEnd, canceledAt",
				},
				{ from: "current_period_end (else expires_at)", to: "subscription.currentPeriodEnd" },
			],
		},
		{
			group: "Feature balance → Metrics",
			fields: [
				{ from: "balance usage", to: "metric_daily.value (autumn.<feature>)" },
				{ from: "balance granted (when overage is refused)", to: "metric_daily.limitValue" },
				{ from: "balances.limit_reached", to: "timeline: usage.limit_reached" },
				{ from: "balances.usage_alert_triggered", to: "timeline: usage.limit_approaching" },
			],
		},
	],
	docsHref: "https://docs.useautumn.com/documentation/webhooks",
	dashboardHref: "https://app.useautumn.com",
	sharedIdLabel: "customer ID",
}
