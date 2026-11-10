/**
 * The Clerk Backend API and webhook payloads Hazel reads, as loose schemas.
 *
 * Verified against Clerk's Backend API OpenAPI spec, version 2026-08-20
 * (https://github.com/clerk/openapi-specs/blob/main/bapi/2026-08-20.yml): `GET /instance`,
 * `/organizations`, `/organization_memberships`, `/organization_domains`, `/users`,
 * `/users/{id}/organization_memberships`.
 *
 * Every field Hazel does not need is left out, and everything beyond `id` is optional: Clerk adds
 * fields freely and ships new webhook event types, and a decode failure here would 400 a delivery
 * we could otherwise have handled. Timestamps are Unix **milliseconds**.
 */
import type { IsoTimestamp } from "@hazel/domain/customers"
import { Schema } from "effect"

const Nullable = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))

/** `GET /instance`: which Clerk instance the secret key opens. */
export const ClerkInstance = Schema.Struct({
	id: Schema.String,
	environment_type: Schema.optionalKey(Schema.String),
})
export type ClerkInstance = typeof ClerkInstance.Type

export const ClerkOrganization = Schema.Struct({
	id: Schema.String,
	name: Nullable(Schema.String),
	slug: Nullable(Schema.String),
	image_url: Nullable(Schema.String),
	has_image: Nullable(Schema.Boolean),
	members_count: Nullable(Schema.Number),
	/** Clerk's seat cap; `0` means unlimited. */
	max_allowed_memberships: Nullable(Schema.Number),
	created_at: Nullable(Schema.Number),
	updated_at: Nullable(Schema.Number),
})
export type ClerkOrganization = typeof ClerkOrganization.Type

export const ClerkPublicUserData = Schema.Struct({
	user_id: Schema.String,
	first_name: Nullable(Schema.String),
	last_name: Nullable(Schema.String),
	image_url: Nullable(Schema.String),
	has_image: Nullable(Schema.Boolean),
	/** The user's primary email, username or phone — whatever identifies them in Clerk. */
	identifier: Nullable(Schema.String),
})
export type ClerkPublicUserData = typeof ClerkPublicUserData.Type

/** A membership carries its whole organization, so one list gives accounts, contacts and roles. */
export const ClerkMembership = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	/** `org:admin`, `org:member`, or a custom role key. */
	role: Nullable(Schema.String),
	/** The role's display name ("Admin"), when Clerk sends it. */
	role_name: Nullable(Schema.String),
	organization: Schema.optionalKey(ClerkOrganization),
	public_user_data: Schema.optionalKey(ClerkPublicUserData),
	created_at: Nullable(Schema.Number),
	updated_at: Nullable(Schema.Number),
})
export type ClerkMembership = typeof ClerkMembership.Type

export const ClerkEmailAddress = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	email_address: Nullable(Schema.String),
})

export const ClerkUser = Schema.Struct({
	id: Schema.String,
	first_name: Nullable(Schema.String),
	last_name: Nullable(Schema.String),
	username: Nullable(Schema.String),
	image_url: Nullable(Schema.String),
	has_image: Nullable(Schema.Boolean),
	primary_email_address_id: Nullable(Schema.String),
	email_addresses: Schema.optionalKey(Schema.Array(ClerkEmailAddress)),
	/** Unix ms of the last sign-in. */
	last_sign_in_at: Nullable(Schema.Number),
	/** Unix ms of the latest session activity, with **day** precision (Clerk keeps only the latest). */
	last_active_at: Nullable(Schema.Number),
	created_at: Nullable(Schema.Number),
	updated_at: Nullable(Schema.Number),
})
export type ClerkUser = typeof ClerkUser.Type

export const ClerkOrganizationDomain = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	organization_id: Schema.String,
	name: Schema.String,
})
export type ClerkOrganizationDomain = typeof ClerkOrganizationDomain.Type

export const ClerkSession = Schema.Struct({
	id: Schema.String,
	user_id: Schema.String,
	/** The organization the session is scoped to; null until the user picks one. */
	last_active_organization_id: Nullable(Schema.String),
	created_at: Nullable(Schema.Number),
	last_active_at: Nullable(Schema.Number),
})
export type ClerkSession = typeof ClerkSession.Type

/** `organization.deleted`, `user.deleted`: Clerk's `DeletedObject` declares even `id` optional. */
export const ClerkDeletedObject = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	object: Schema.optionalKey(Schema.String),
	deleted: Schema.optionalKey(Schema.Boolean),
})
export type ClerkDeletedObject = typeof ClerkDeletedObject.Type

/** `{ data, total_count }`, the shape of every list endpoint Hazel pages through. */
export const ClerkPage = <S extends Schema.Top>(item: S) =>
	Schema.Struct({ data: Schema.Array(item), total_count: Schema.optionalKey(Schema.Number) })

export const ClerkOrganizationsPage = ClerkPage(ClerkOrganization)
export const ClerkMembershipsPage = ClerkPage(ClerkMembership)
export const ClerkDomainsPage = ClerkPage(ClerkOrganizationDomain)
/** `GET /users` answers a bare array, not a page document. */
export const ClerkUsersList = Schema.Array(ClerkUser)

/** Every delivery: `{ type, data, timestamp, instance_id }` plus fields Hazel ignores. */
export const ClerkWebhookEnvelope = Schema.Struct({
	type: Schema.String,
	data: Schema.Unknown,
	/** Unix ms Clerk stamped on the event. */
	timestamp: Nullable(Schema.Number),
	/** The Clerk instance the event happened in (`GET /instance`'s `id`). */
	instance_id: Nullable(Schema.String),
})
export type ClerkWebhookEnvelope = typeof ClerkWebhookEnvelope.Type

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** 10000-01-01: past it `toISOString` widens the year, which is no `Day` (and past ±8.64e15 it throws). */
const MAX_MILLIS = 253_402_300_800_000

/**
 * An ISO instant from a Clerk Unix-ms timestamp; null when Clerk sent none, or one outside
 * 1970–9999, so every instant (and its `dayOf`) passes ingest's `IsoTimestamp` / `Day` checks.
 */
export const isoOf = (millis: number | null | undefined): IsoTimestamp | null =>
	millis === null || millis === undefined || !(millis >= 0 && millis < MAX_MILLIS)
		? null
		: new Date(millis).toISOString()

/** The primary address when Clerk names one, else the first it sent. */
export const primaryEmailOf = (user: ClerkUser): string | null => {
	const addresses = user.email_addresses ?? []
	const primary = addresses.find((address) => address.id === user.primary_email_address_id)
	return (primary ?? addresses[0])?.email_address ?? null
}

export const fullNameOf = (person: {
	readonly first_name?: string | null
	readonly last_name?: string | null
}): string | null => {
	const name = [person.first_name, person.last_name].filter((part) => !!part?.trim()).join(" ")
	return name === "" ? null : name
}

/** An image only when Clerk has one: `image_url` otherwise points at a generated placeholder. */
export const imageUrlOf = (person: {
	readonly image_url?: string | null
	readonly has_image?: boolean | null
}): string | null => (person.has_image === true ? (person.image_url ?? null) : null)

/** "Admin" when Clerk sends a display name, else the role key without its `org:` prefix. */
export const roleLabelOf = (membership: ClerkMembership): string | null => {
	if (membership.role_name !== null && membership.role_name !== undefined) return membership.role_name
	const role = membership.role
	if (role === null || role === undefined) return null
	return role.startsWith("org:") ? role.slice("org:".length) : role
}

const DASHBOARD = "https://dashboard.clerk.com/last-active?path="

/** Deep links into whichever Clerk instance the signed-in dashboard user last opened. */
export const organizationUrlOf = (id: string): string => `${DASHBOARD}organizations/${id}`
export const userUrlOf = (id: string): string => `${DASHBOARD}users/${id}`
