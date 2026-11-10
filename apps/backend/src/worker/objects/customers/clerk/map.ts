/**
 * Clerk records → `IngestOp`s (`docs/customers/tech-design.md` §3). Pure: webhooks and pulls both
 * come through here, so one mapping is tested once.
 *
 * The shape of the mapping:
 *
 * - **Organization → account.** The Clerk organization id is the account's `(clerk, org_…)`
 *   external ref, and that ref is the shared id every other source matches on (Stripe
 *   `metadata.clerk_org_id`, the Autumn customer id, Maple's `GroupId`), so Clerk's own ops carry
 *   no `sameAs`. `createAccounts` decides whether an unmatched organization is created or parked.
 * - **Organization membership → contact.** A contact is a *user within an account*, so a user in
 *   three organizations is three contacts sharing the Clerk user id — which is exactly what
 *   `customer_external_refs` allows for contacts (`(provider, externalId, accountId)`). Role and
 *   `joinedAt` come from the membership, profile and activity from the user.
 * - **Activity.** Clerk keeps only the *latest* `last_sign_in_at` / `last_active_at` per user, not
 *   a per-day history, so a pull can mark only those one or two days; the continuous per-day signal
 *   is the `session.created` webhook. Clerk never reports how many sessions a day held, so it
 *   writes `sessionCount: 1` as a floor and owns `signedIn`; event counts stay Maple's.
 * - **Events.** Ingest raises `contact.joined` / `contact.removed` itself when a contact appears or
 *   is removed, so the only timeline entry Clerk adds is `account.created` for an organization it
 *   watched being created, keyed on the organization so a redelivery dedupes.
 */
import type {
	ConnectionConfig,
	Day,
	IngestOp,
	ProviderRef,
	RecordActivity,
	UpsertAccount,
	UpsertContact,
} from "@hazel/domain/customers"
import { dayOf } from "../time"
import {
	type ClerkMembership,
	type ClerkOrganization,
	type ClerkSession,
	type ClerkUser,
	fullNameOf,
	imageUrlOf,
	isoOf,
	organizationUrlOf,
	primaryEmailOf,
	roleLabelOf,
	userUrlOf,
} from "./wire"

export const clerkRef = (externalId: string): ProviderRef => ({ provider: "clerk", externalId })

/** The UTC day of a Clerk Unix-ms timestamp. */
const dayFrom = (millis: number | null | undefined): Day | null => {
	const iso = isoOf(millis)
	return iso === null ? null : dayOf(new Date(iso))
}

/** `create` while the connection may create accounts (the default: Clerk is the identity source). */
export type OnNoMatch = UpsertAccount["onNoMatch"]

export const onNoMatchOf = (config: ConnectionConfig): OnNoMatch =>
	config._tag === "clerk" && !config.createAccounts ? "unmatched" : "create"

/** Clerk's seat cap, where `0` means unlimited. */
const seatsLimitOf = (max: number | null | undefined): number | null =>
	max === null || max === undefined || max <= 0 ? null : Math.trunc(max)

/**
 * An organization. Domains are not on the organization record — they come from
 * `/organization_domains` through {@link domainsAccountOp} and merge into the account.
 */
export const accountOp = (org: ClerkOrganization, onNoMatch: OnNoMatch): UpsertAccount => {
	const createdAt = isoOf(org.created_at)
	return {
		_tag: "account",
		externalId: org.id,
		externalUrl: organizationUrlOf(org.id),
		...(org.name === null || org.name === undefined ? {} : { name: org.name }),
		logoUrl: imageUrlOf(org),
		// Absent (a webhook payload without counts) must not clear what a pull established.
		...(org.members_count === null || org.members_count === undefined
			? {}
			: { seatsUsed: Math.trunc(org.members_count) }),
		...(org.max_allowed_memberships === undefined
			? {}
			: { seatsLimit: seatsLimitOf(org.max_allowed_memberships) }),
		...(org.slug === null || org.slug === undefined ? {} : { attributes: { slug: org.slug } }),
		...(createdAt === null ? {} : { createdAt }),
		sameAs: [],
		onNoMatch,
	}
}

/** The organization's verified domains, merged into the account (ingest never removes a domain). */
export const domainsAccountOp = (
	organizationId: string,
	domains: ReadonlyArray<string>,
	onNoMatch: OnNoMatch,
): UpsertAccount => ({
	_tag: "account",
	externalId: organizationId,
	domains,
	sameAs: [],
	// A domain alone is no reason to invent a customer: the organization sweep creates those.
	onNoMatch: onNoMatch === "create" ? "unmatched" : onNoMatch,
})

export const accountDeletedOp = (organizationId: string): UpsertAccount => ({
	_tag: "account",
	externalId: organizationId,
	sameAs: [],
	onNoMatch: "unmatched",
	deleted: true,
})

/**
 * A membership, with the user record behind it when we have one. Without it (a membership webhook
 * on its own) the member's name, email and avatar come from Clerk's `public_user_data`, and the
 * sign-in fields are left untouched rather than cleared.
 */
export const contactOp = (input: {
	readonly membership: ClerkMembership
	readonly organizationId: string
	readonly user?: ClerkUser | undefined
	readonly removed?: boolean
}): UpsertContact | null => {
	const { membership, organizationId, user } = input
	const publicData = membership.public_user_data
	const userId = user?.id ?? publicData?.user_id
	if (userId === undefined) return null
	const email = user === undefined ? (publicData?.identifier ?? null) : primaryEmailOf(user)
	const name =
		user === undefined ? fullNameOf(publicData ?? {}) : (fullNameOf(user) ?? user.username ?? null)
	const avatarUrl = user === undefined ? imageUrlOf(publicData ?? {}) : imageUrlOf(user)
	const joinedAt = isoOf(membership.created_at) ?? isoOf(user?.created_at)
	const role = roleLabelOf(membership)
	return {
		_tag: "contact",
		externalId: userId,
		account: clerkRef(organizationId),
		externalUrl: userUrlOf(userId),
		// An email-less identifier (a username or phone) is not an address: keep it out of `email`.
		email: email !== null && email.includes("@") ? email : null,
		name,
		avatarUrl,
		...(role === null ? {} : { role }),
		...(joinedAt === null ? {} : { joinedAt }),
		...(user === undefined
			? {}
			: { lastSignInAt: isoOf(user.last_sign_in_at), lastSeenAt: isoOf(user.last_active_at) }),
		...(input.removed === true ? { removed: true } : {}),
	}
}

/**
 * The activity days a user record proves: the day they last signed in, and the day they were last
 * active. One row each, for every account they belong to.
 */
export const activityOps = (user: ClerkUser, organizationId: string): Array<RecordActivity> => {
	const signInDay = dayFrom(user.last_sign_in_at)
	const activeDay = dayFrom(user.last_active_at)
	const base = { _tag: "activity", contact: clerkRef(user.id), account: clerkRef(organizationId) } as const
	const ops: Array<RecordActivity> = []
	if (signInDay !== null) ops.push({ ...base, day: signInDay, sessionCount: 1, signedIn: true })
	if (activeDay !== null && activeDay !== signInDay) {
		ops.push({ ...base, day: activeDay, sessionCount: 1 })
	}
	return ops
}

/** A new session: the day is a sign-in for every account the user belongs to. */
export const sessionOps = (
	session: ClerkSession,
	organizationIds: ReadonlyArray<string>,
): Array<IngestOp> => {
	const at = isoOf(session.created_at) ?? isoOf(session.last_active_at)
	if (at === null) return []
	const day = dayOf(new Date(at))
	return organizationIds.flatMap((organizationId): Array<IngestOp> => [
		{
			_tag: "activity",
			contact: clerkRef(session.user_id),
			account: clerkRef(organizationId),
			day,
			sessionCount: 1,
			signedIn: true,
		},
		{
			_tag: "contact",
			externalId: session.user_id,
			account: clerkRef(organizationId),
			lastSignInAt: at,
			lastSeenAt: at,
		},
	])
}

/** The one timeline entry Clerk adds; ingest raises the contact ones itself. */
export const accountCreatedEvent = (org: ClerkOrganization, occurredAt: string): IngestOp => ({
	_tag: "event",
	externalId: `clerk:organization.created:${org.id}`,
	account: clerkRef(org.id),
	type: "account.created",
	title: `${org.name ?? "An organization"} was created in Clerk`,
	...(org.slug === null || org.slug === undefined ? {} : { data: { slug: org.slug } }),
	occurredAt,
})

/**
 * A membership, its organization and its user, in the order ingest needs: the account exists
 * before the contact that names it, and the contact before its activity.
 */
export const membershipOps = (input: {
	readonly membership: ClerkMembership
	readonly user?: ClerkUser | undefined
	readonly onNoMatch: OnNoMatch
	readonly removed?: boolean
	/** Skip the account op when a sweep already wrote the organization in this page. */
	readonly withAccount?: boolean
}): Array<IngestOp> => {
	const org = input.membership.organization
	const organizationId = org?.id
	if (organizationId === undefined) return []
	const ops: Array<IngestOp> = []
	if (input.withAccount !== false && org !== undefined) ops.push(accountOp(org, input.onNoMatch))
	const contact = contactOp({
		membership: input.membership,
		organizationId,
		user: input.user,
		...(input.removed === true ? { removed: true } : {}),
	})
	if (contact === null) return ops
	ops.push(contact)
	if (input.user !== undefined && input.removed !== true) {
		ops.push(...activityOps(input.user, organizationId))
	}
	return ops
}
