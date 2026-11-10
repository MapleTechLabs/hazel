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
 * - **Ordering.** Account and contact ops carry `observedAt`, so a late delivery cannot revive a
 *   record deleted since: a webhook's is the record's `updated_at` (else the event's time), a
 *   pull's the time it asked Clerk (a listing proves the record live then). Identity ops never set
 *   `matchByDomain`: two organizations sharing a domain stay two customers.
 * - **Events.** Ingest raises `contact.joined` / `contact.removed` itself when a contact appears or
 *   is removed, so the only timeline entry Clerk adds is `account.created` for an organization it
 *   watched being created, keyed on the organization so a redelivery dedupes.
 */
import type {
	ConnectionConfig,
	Day,
	IngestOp,
	IsoTimestamp,
	ProviderRef,
	RecordActivity,
	RecordEvent,
	UpsertAccount,
	UpsertContact,
} from "@hazel/domain/customers"
import type { Types } from "effect"
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
export const accountOp = (
	org: ClerkOrganization,
	onNoMatch: OnNoMatch,
	observedAt?: IsoTimestamp,
): UpsertAccount => {
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: org.id,
		externalUrl: organizationUrlOf(org.id),
		logoUrl: imageUrlOf(org),
		sameAs: [],
		onNoMatch,
	}
	if (org.name != null) op.name = org.name
	// Absent (a webhook payload without counts) must not clear what a pull established.
	if (org.members_count != null) op.seatsUsed = Math.trunc(org.members_count)
	if (org.max_allowed_memberships !== undefined) op.seatsLimit = seatsLimitOf(org.max_allowed_memberships)
	if (org.slug != null) op.attributes = { slug: org.slug }
	const createdAt = isoOf(org.created_at)
	if (createdAt !== null) op.createdAt = createdAt
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

/**
 * The organization's verified domains, merged into the account (ingest never removes a domain).
 * They describe the account; they never match one (no `matchByDomain`).
 */
export const domainsAccountOp = (
	organizationId: string,
	domains: ReadonlyArray<string>,
	onNoMatch: OnNoMatch,
	observedAt?: IsoTimestamp,
): UpsertAccount => {
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: organizationId,
		domains,
		sameAs: [],
		// A domain alone is no reason to invent a customer: the organization sweep creates those.
		onNoMatch: onNoMatch === "create" ? "unmatched" : onNoMatch,
	}
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

/**
 * The organization is gone. `observedAt` (the event's time) dates the deletion, so a late delivery
 * observed before it leaves the account deleted.
 */
export const accountDeletedOp = (organizationId: string, observedAt?: IsoTimestamp): UpsertAccount => {
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: organizationId,
		sameAs: [],
		onNoMatch: "unmatched",
		deleted: true,
	}
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

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
	readonly observedAt?: IsoTimestamp | undefined
}): UpsertContact | null => {
	const { membership, organizationId, user } = input
	const publicData = membership.public_user_data
	const userId = user?.id ?? publicData?.user_id
	if (userId === undefined) return null
	const email = user === undefined ? (publicData?.identifier ?? null) : primaryEmailOf(user)
	const name =
		user === undefined ? fullNameOf(publicData ?? {}) : (fullNameOf(user) ?? user.username ?? null)
	const avatarUrl = user === undefined ? imageUrlOf(publicData ?? {}) : imageUrlOf(user)
	const op: Types.Mutable<UpsertContact> = {
		_tag: "contact",
		externalId: userId,
		account: clerkRef(organizationId),
		externalUrl: userUrlOf(userId),
		// An email-less identifier (a username or phone) is not an address: keep it out of `email`.
		email: email !== null && email.includes("@") ? email : null,
		name,
		avatarUrl,
	}
	const role = roleLabelOf(membership)
	if (role !== null) op.role = role
	const joinedAt = isoOf(membership.created_at) ?? isoOf(user?.created_at)
	if (joinedAt !== null) op.joinedAt = joinedAt
	if (user !== undefined) {
		op.lastSignInAt = isoOf(user.last_sign_in_at)
		op.lastSeenAt = isoOf(user.last_active_at)
	}
	if (input.removed === true) op.removed = true
	if (input.observedAt !== undefined) op.observedAt = input.observedAt
	return op
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

/** A sign-in day on its own, for when the user's memberships could not be listed. */
export const sessionActivityOp = (userId: string, organizationId: string, day: Day): RecordActivity => ({
	_tag: "activity",
	contact: clerkRef(userId),
	account: clerkRef(organizationId),
	day,
	sessionCount: 1,
	signedIn: true,
})

/**
 * A new session: the day is a sign-in for each account the user belongs to, `memberships` being
 * the user's memberships Clerk lists. The contact comes first, built from the membership's public
 * user data (email, name), so a session that lands before its membership webhook creates the
 * contact its activity belongs to, the same contact the membership will name.
 */
export const sessionOps = (
	session: ClerkSession,
	memberships: ReadonlyArray<ClerkMembership>,
	observedAt?: IsoTimestamp,
): Array<IngestOp> => {
	const at = isoOf(session.created_at) ?? isoOf(session.last_active_at)
	if (at === null) return []
	const day = dayOf(new Date(at))
	return memberships.flatMap((membership): Array<IngestOp> => {
		const organizationId = membership.organization?.id
		if (organizationId === undefined) return []
		const contact = contactOp({ membership, organizationId, observedAt })
		if (contact === null) return []
		return [
			{ ...contact, lastSignInAt: at, lastSeenAt: at },
			sessionActivityOp(session.user_id, organizationId, day),
		]
	})
}

/** The one timeline entry Clerk adds; ingest raises the contact ones itself. */
export const accountCreatedEvent = (org: ClerkOrganization, occurredAt: IsoTimestamp): RecordEvent => {
	const event: Types.Mutable<RecordEvent> = {
		_tag: "event",
		externalId: `clerk:organization.created:${org.id}`,
		account: clerkRef(org.id),
		type: "account.created",
		title: `${org.name ?? "An organization"} was created in Clerk`,
		occurredAt,
	}
	if (org.slug != null) event.data = { slug: org.slug }
	return event
}

/**
 * A membership, its organization and its user, in the order ingest needs: the account exists
 * before the contact that names it, and the contact before its activity. A removal writes only the
 * contact: its organization may be going too (a deleted organization's memberships go with it), and
 * an account op would revive it.
 */
export const membershipOps = (input: {
	readonly membership: ClerkMembership
	readonly user?: ClerkUser | undefined
	readonly onNoMatch: OnNoMatch
	readonly removed?: boolean
	/** Skip the account op: a sweep already wrote the organization in this page, say. */
	readonly withAccount?: boolean
	readonly observedAt?: IsoTimestamp | undefined
}): Array<IngestOp> => {
	const org = input.membership.organization
	const organizationId = org?.id
	if (organizationId === undefined) return []
	const ops: Array<IngestOp> = []
	if (input.withAccount !== false && input.removed !== true && org !== undefined)
		ops.push(accountOp(org, input.onNoMatch, input.observedAt))
	const contact = contactOp({
		membership: input.membership,
		organizationId,
		user: input.user,
		removed: input.removed === true,
		observedAt: input.observedAt,
	})
	if (contact === null) return ops
	ops.push(contact)
	if (input.user !== undefined && input.removed !== true) {
		ops.push(...activityOps(input.user, organizationId))
	}
	return ops
}
