import type { PresentationOf } from "../kit/presentation"
import type { ClerkConnectionConfig } from "./config"

export const presentation: PresentationOf<ClerkConnectionConfig> = {
	name: "Clerk",
	accountNoun: "organization",
	domain: "clerk.com",
	linkHosts: ["dashboard.clerk.com"],
	blurb: "Organizations become accounts, users become contacts, sign-ins feed activity. Source of truth for identity.",
	setupSummary: "Your customer list: accounts and their contacts.",
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
	suggested: "start",
	activityLabel: { noun: "sign-ins", usageRank: 20 },
	impersonationNote:
		"Turn it on in the Clerk dashboard (Settings → User impersonation). Clerk allows 5 impersonations a month without the Administration add-on.",
}
