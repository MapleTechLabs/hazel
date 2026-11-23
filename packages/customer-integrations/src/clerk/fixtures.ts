/**
 * Clerk payloads as Clerk actually sends them, trimmed to the fields Hazel reads plus a few it
 * ignores (so the loose schemas are exercised against real noise). Shapes follow Clerk's Backend
 * API spec 2026-08-20 and its webhook `data` objects; the data is modelled on Maple, whose
 * customers *are* Clerk organizations.
 *
 * Timestamps are Unix milliseconds, as Clerk sends them.
 */

export const MS = (iso: string): number => new Date(iso).getTime()

export const ORG_ACME = {
	object: "organization",
	id: "org_2acme000000000000000000",
	name: "Acme Analytics",
	slug: "acme-analytics",
	image_url: "https://img.clerk.com/acme.png",
	has_image: true,
	members_count: 12,
	pending_invitations_count: 2,
	max_allowed_memberships: 25,
	admin_delete_enabled: true,
	public_metadata: { regions: ["eu"] },
	private_metadata: {},
	created_by: "user_2ada000000000000000000",
	created_at: MS("2026-01-14T09:12:00.000Z"),
	updated_at: MS("2026-11-02T17:40:00.000Z"),
}

/** No logo, no seat cap (`0` is Clerk's "unlimited"), no counts: the sparse end of the shape. */
export const ORG_GLOBEX = {
	object: "organization",
	id: "org_2globex00000000000000000",
	name: "Globex",
	slug: null,
	image_url: "https://img.clerk.com/placeholder.png",
	has_image: false,
	max_allowed_memberships: 0,
	admin_delete_enabled: true,
	public_metadata: {},
	created_at: MS("2026-09-30T11:00:00.000Z"),
	updated_at: MS("2026-09-30T11:00:00.000Z"),
}

export const USER_ADA = {
	object: "user",
	id: "user_2ada000000000000000000",
	first_name: "Ada",
	last_name: "Lovelace",
	username: null,
	image_url: "https://img.clerk.com/ada.png",
	has_image: true,
	primary_email_address_id: "idn_2ada000000000000000001",
	email_addresses: [
		{ object: "email_address", id: "idn_2ada000000000000000000", email_address: "old@acme.com" },
		{ object: "email_address", id: "idn_2ada000000000000000001", email_address: "ada@acme.com" },
	],
	last_sign_in_at: MS("2026-11-09T08:21:00.000Z"),
	last_active_at: MS("2026-11-10T00:00:00.000Z"),
	created_at: MS("2026-01-14T09:12:00.000Z"),
	updated_at: MS("2026-11-10T08:21:00.000Z"),
	banned: false,
	locked: false,
}

/** Signed up, never signed in, no avatar: a contact that must not look active. */
export const USER_GRACE = {
	object: "user",
	id: "user_2grace00000000000000000",
	first_name: "Grace",
	last_name: null,
	username: "ghopper",
	image_url: "https://img.clerk.com/placeholder.png",
	has_image: false,
	primary_email_address_id: null,
	email_addresses: [],
	last_sign_in_at: null,
	last_active_at: null,
	created_at: MS("2026-11-01T10:00:00.000Z"),
	updated_at: MS("2026-11-01T10:00:00.000Z"),
}

export const membership = (options: {
	readonly id: string
	readonly organization: unknown
	readonly userId: string
	readonly role?: string
	readonly roleName?: string | null
	readonly identifier?: string | null
	readonly firstName?: string | null
	readonly lastName?: string | null
	readonly createdAt: number
}) => ({
	object: "organization_membership",
	id: options.id,
	role: options.role ?? "org:member",
	role_name: options.roleName === undefined ? "Member" : options.roleName,
	permissions: ["org:sys_profile:read"],
	public_metadata: {},
	organization: options.organization,
	public_user_data: {
		user_id: options.userId,
		first_name: options.firstName ?? null,
		last_name: options.lastName ?? null,
		image_url: "https://img.clerk.com/placeholder.png",
		has_image: false,
		identifier: options.identifier === undefined ? "member@acme.com" : options.identifier,
	},
	created_at: options.createdAt,
	updated_at: options.createdAt,
})

export const MEMBERSHIP_ADA_ADMIN = membership({
	id: "orgmem_2ada00000000000000000",
	organization: ORG_ACME,
	userId: USER_ADA.id,
	role: "org:admin",
	roleName: "Admin",
	identifier: "ada@acme.com",
	firstName: "Ada",
	lastName: "Lovelace",
	createdAt: MS("2026-01-14T09:12:00.000Z"),
})

export const MEMBERSHIP_GRACE_MEMBER = membership({
	id: "orgmem_2grace000000000000000",
	organization: ORG_ACME,
	userId: USER_GRACE.id,
	identifier: "grace@acme.com",
	firstName: "Grace",
	createdAt: MS("2026-11-01T10:05:00.000Z"),
})

/** The same user in a second organization: two contacts, one Clerk user id. */
export const MEMBERSHIP_ADA_GLOBEX = membership({
	id: "orgmem_2adaglobex00000000000",
	organization: ORG_GLOBEX,
	userId: USER_ADA.id,
	role: "org:billing_manager",
	roleName: null,
	identifier: "ada@acme.com",
	firstName: "Ada",
	lastName: "Lovelace",
	createdAt: MS("2026-10-02T14:00:00.000Z"),
})

export const DOMAIN_ACME = {
	object: "organization_domain",
	id: "orgdmn_2acme00000000000000000",
	organization_id: ORG_ACME.id,
	name: "acme.com",
	enrollment_mode: "automatic_invitation",
	verification: { status: "verified", strategy: "email_code", attempts: 1, expire_at: null },
}

export const DOMAIN_ACME_EU = {
	object: "organization_domain",
	id: "orgdmn_2acmeeu000000000000000",
	organization_id: ORG_ACME.id,
	name: "acme.eu",
	enrollment_mode: "automatic_suggestion",
	verification: { status: "verified", strategy: "dns", attempts: 1, expire_at: null },
}

export const SESSION_ADA = {
	object: "session",
	id: "sess_2ada00000000000000000",
	user_id: USER_ADA.id,
	client_id: "client_2ada0000000000000000",
	status: "active",
	last_active_organization_id: ORG_ACME.id,
	last_active_at: MS("2026-11-10T08:21:00.000Z"),
	created_at: MS("2026-11-10T08:21:00.000Z"),
	expire_at: MS("2026-11-17T08:21:00.000Z"),
	abandon_at: MS("2026-12-10T08:21:00.000Z"),
	updated_at: MS("2026-11-10T08:21:00.000Z"),
}

/** Signed in but has not picked an organization yet: the account has to be resolved from Clerk. */
export const SESSION_ADA_NO_ORG = { ...SESSION_ADA, last_active_organization_id: null }

export const INSTANCE = {
	object: "instance",
	id: "ins_2hazel0000000000000000",
	environment_type: "production",
}

/** A webhook delivery body. */
export const envelope = (type: string, data: unknown, timestampMs = MS("2026-11-10T08:21:01.000Z")) =>
	JSON.stringify({
		object: "event",
		type,
		data,
		timestamp: timestampMs,
		instance_id: INSTANCE.id,
		event_attributes: { http_request: { client_ip: "203.0.113.4" } },
	})
