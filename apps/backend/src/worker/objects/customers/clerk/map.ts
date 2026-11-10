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
 *   a per-day history, and not which organization the user was active in. A user record (the
 *   sweep, `user.updated`) moves the contact's `lastSignInAt` / `lastSeenAt` and credits the
 *   `last_active_at` day in *every* account the user is a member of (`signedIn` when it is also the
 *   `last_sign_in_at` day): a user in several organizations over-credits recency to the ones they
 *   were not active in, which beats every Clerk-only account reading as never active. The
 *   `session.created` webhook credits its day to one account. Clerk never reports how many
 *   sessions a day held, so it writes `sessionCount: 1` as a floor and owns `signedIn`; event
 *   counts stay Maple's.
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
	IngestOp,
	IsoTimestamp,
	ProviderRef,
	RecordActivity,
	RecordEvent,
	UpsertAccount,
	UpsertContact,
} from "@hazel/domain/customers"
import type { Types } from "effect"
import { addDays, dayOf } from "../time"
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

/** An account op that names only the organization: it places what names it, and sets no field. */
const accountRefOp = (
	organizationId: string,
	onNoMatch: OnNoMatch,
	observedAt: IsoTimestamp | undefined,
): Types.Mutable<UpsertAccount> => {
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: organizationId,
		sameAs: [],
		onNoMatch,
	}
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

/**
 * The organization's verified domains, merged into the account. Ingest only ever adds domains
 * (`UpsertAccount.domains`), so one Clerk unverifies or removes stays on the account.
 * They describe the account; they never match one (no `matchByDomain`).
 */
export const domainsAccountOp = (
	organizationId: string,
	domains: ReadonlyArray<string>,
	onNoMatch: OnNoMatch,
	observedAt?: IsoTimestamp,
): UpsertAccount => ({
	// A domain alone is no reason to invent a customer: the organization sweep creates those.
	...accountRefOp(organizationId, onNoMatch === "create" ? "unmatched" : onNoMatch, observedAt),
	domains,
})

/**
 * The organization is gone. `observedAt` (the event's time) dates the deletion, so a late delivery
 * observed before it leaves the account deleted.
 */
export const accountDeletedOp = (organizationId: string, observedAt?: IsoTimestamp): UpsertAccount => ({
	...accountRefOp(organizationId, "unmatched", observedAt),
	deleted: true,
})

/** A contact that only names the user and their account; every field it carries is left as it is. */
const bareContactOp = (
	userId: string,
	organizationId: string,
	observedAt: IsoTimestamp | undefined,
): Types.Mutable<UpsertContact> => {
	const op: Types.Mutable<UpsertContact> = {
		_tag: "contact",
		externalId: userId,
		account: clerkRef(organizationId),
		externalUrl: userUrlOf(userId),
	}
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

/**
 * A membership, with the user record behind it when we have one. Without it (a membership webhook
 * on its own) the member's name, email and avatar come from Clerk's `public_user_data`, which names
 * the user only partly: what it does not say (an identifier that is no email, no name, no
 * `has_image`) is left as it is rather than cleared, and so are the sign-in fields.
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
	const op = bareContactOp(userId, organizationId, input.observedAt)
	if (user !== undefined) {
		const email = primaryEmailOf(user)
		op.email = email !== null && email.includes("@") ? email : null
		op.name = fullNameOf(user) ?? user.username ?? null
		op.avatarUrl = imageUrlOf(user)
		op.lastSignInAt = isoOf(user.last_sign_in_at)
		op.lastSeenAt = isoOf(user.last_active_at)
	} else if (publicData !== undefined) {
		// An email-less identifier (a username or phone) is not an address: keep it out of `email`.
		if (publicData.identifier?.includes("@") === true) op.email = publicData.identifier
		const name = fullNameOf(publicData)
		if (name !== null) op.name = name
		if (publicData.has_image != null) op.avatarUrl = imageUrlOf(publicData)
	}
	const role = roleLabelOf(membership)
	if (role !== null) op.role = role
	const joinedAt = isoOf(membership.created_at) ?? isoOf(user?.created_at)
	if (joinedAt !== null) op.joinedAt = joinedAt
	if (input.removed === true) op.removed = true
	return op
}

/**
 * How long core keeps activity days (`compute.ts` `DAILY_RETENTION_DAYS`, not exported): an older
 * day would be written only for the next prune to delete it.
 */
const ACTIVITY_RETENTION_DAYS = 400

/**
 * The user's `last_active_at` day in one account (see the module doc on over-crediting), a sign-in
 * when it is also the `last_sign_in_at` day. Comes after the contact op: ingest parks activity for a
 * contact it does not know. None when the day was already past retention when the user was observed.
 */
const lastActiveOp = (
	user: ClerkUser,
	organizationId: string,
	observedAt: IsoTimestamp | undefined,
): RecordActivity | null => {
	const activeAt = isoOf(user.last_active_at)
	if (activeAt === null) return null
	const day = dayOf(new Date(activeAt))
	if (observedAt !== undefined && day < addDays(dayOf(new Date(observedAt)), -ACTIVITY_RETENTION_DAYS))
		return null
	const signInAt = isoOf(user.last_sign_in_at)
	const op: Types.Mutable<RecordActivity> = {
		_tag: "activity",
		contact: clerkRef(user.id),
		account: clerkRef(organizationId),
		day,
		sessionCount: 1,
	}
	if (signInAt !== null && dayOf(new Date(signInAt)) === day) op.signedIn = true
	return op
}

/**
 * A new session: the contact's `lastSignInAt` / `lastSeenAt` in each account given, and with
 * `credit` the day as a sign-in for them. An account comes with the membership Clerk listed for
 * it (the contact then carries its public user data, so a session that lands before its
 * membership webhook creates the contact the membership will name) or alone (the session's own
 * organization, which Clerk was not asked about).
 */
export const sessionOps = (input: {
	readonly session: ClerkSession
	readonly accounts: ReadonlyArray<{
		readonly organizationId: string
		readonly membership?: ClerkMembership
	}>
	readonly credit: boolean
	readonly observedAt?: IsoTimestamp | undefined
}): Array<IngestOp> => {
	const { session } = input
	const at = isoOf(session.created_at) ?? isoOf(session.last_active_at)
	if (at === null) return []
	const day = dayOf(new Date(at))
	return input.accounts.flatMap(({ organizationId, membership }): Array<IngestOp> => {
		const contact =
			membership === undefined
				? bareContactOp(session.user_id, organizationId, input.observedAt)
				: contactOp({ membership, organizationId, observedAt: input.observedAt })
		if (contact === null) return []
		const ops: Array<IngestOp> = [{ ...contact, lastSignInAt: at, lastSeenAt: at }]
		if (input.credit) {
			ops.push({
				_tag: "activity",
				contact: clerkRef(session.user_id),
				account: clerkRef(organizationId),
				day,
				sessionCount: 1,
				signedIn: true,
			})
		}
		return ops
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
 * before the contact that names it, and the contact before its activity day. The account op names
 * the organization only: the membership's copy of it may be older than what an
 * `organization.updated` already wrote, so it never sets the account's fields, and it never creates
 * one (an unknown organization parks with its contact until the organization's own event or the
 * sweep creates it, its name checked against ignore rules then). A removal writes only the contact:
 * its organization may be going too (a deleted organization's memberships go with it), and an
 * account op would revive it.
 */
export const membershipOps = (input: {
	readonly membership: ClerkMembership
	readonly user?: ClerkUser | undefined
	readonly removed?: boolean
	/** Skip the account op: a sweep already wrote the organization in this page, say. */
	readonly withAccount?: boolean
	readonly observedAt?: IsoTimestamp | undefined
}): Array<IngestOp> => {
	const organizationId = input.membership.organization?.id
	if (organizationId === undefined) return []
	const ops: Array<IngestOp> = []
	if (input.withAccount !== false && input.removed !== true) {
		ops.push({
			...accountRefOp(organizationId, "unmatched", input.observedAt),
			externalUrl: organizationUrlOf(organizationId),
		})
	}
	const contact = contactOp({
		membership: input.membership,
		organizationId,
		user: input.user,
		removed: input.removed === true,
		observedAt: input.observedAt,
	})
	if (contact === null) return ops
	ops.push(contact)
	const activity =
		input.user === undefined || input.removed === true
			? null
			: lastActiveOp(input.user, organizationId, input.observedAt)
	if (activity !== null) ops.push(activity)
	return ops
}
